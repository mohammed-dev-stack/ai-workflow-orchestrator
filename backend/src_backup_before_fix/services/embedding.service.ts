// ============================================================
// backend/src/services/embedding.service.ts
// ============================================================
// خدمة التضمينات (Embedding Service) باستخدام Anthropic Claude.
// تم إصلاح: maxTokens → max_tokens، التحقق من content، استخدام config.database.vector.
// تم إضافة: فحص صحة مفتاح API والعودة إلى الاحتياطي الفوري.
// ============================================================

import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import {
  ValidationError,
  NotFoundError,
  InternalServerError,
  AIServiceError,
  AppError,
} from '../middlewares/errorHandler.middleware.js';
import { withCircuitBreakerAndRetry } from '../utils/circuitBreaker.js';
import { withRetryAndThrow } from '../utils/retry.js';
import { z } from 'zod';

// ============================================================
// واجهات المستودعات
// ============================================================

export interface IDocumentChunkRepository {
  create(data: any): Promise<any>;
  bulkCreate(data: any[]): Promise<any[]>;
  findByDocumentId(documentId: string): Promise<any[]>;
  deleteByDocumentId(documentId: string): Promise<void>;
  findSimilarVectors(vector: number[], limit: number, knowledgeBaseId: string, threshold?: number): Promise<any[]>;
  countByDocumentId(documentId: string): Promise<number>;
}

export interface IDocumentRepositoryForEmbedding {
  findById(id: string): Promise<any>;
  updateStatus(id: string, status: string, errorMessage?: string): Promise<any>;
}

// ============================================================
// أنواع الخيارات
// ============================================================

export interface GenerateEmbeddingsOptions {
  documentId: string;
  tenantId: string;
  knowledgeBaseId: string;
  text: string;
  chunkSize?: number;
  chunkOverlap?: number;
  idempotencyKey?: string;
}

export interface SearchSimilarOptions {
  tenantId: string;
  knowledgeBaseId: string;
  query: string;
  limit?: number;
  threshold?: number;
}

export interface SearchSimilarResult {
  chunks: {
    id: string;
    documentId: string;
    content: string;
    similarity: number;
    metadata: Record<string, any>;
  }[];
  query: string;
  limit: number;
  threshold: number;
}

// ============================================================
// مخططات التحقق من المخرجات (Zod Schemas)
// ============================================================

const EmbeddingResponseSchema = z.object({
  embedding: z.array(z.number()),
});

const ChunkingResponseSchema = z.object({
  chunks: z.array(z.string().min(1)),
});

type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;
type ChunkingResponse = z.infer<typeof ChunkingResponseSchema>;

// ============================================================
// الحصول على إعدادات المتجهات من config
// ============================================================

const vectorConfig = config.database?.vector || {
  dimensions: 1024,
  maxSearchResults: 10,
  similarityThreshold: 0.7,
};

// ============================================================
// خدمة التضمينات
// ============================================================

export class EmbeddingService {
  private chunkRepo: IDocumentChunkRepository;
  private docRepo: IDocumentRepositoryForEmbedding;
  private anthropicClient: Anthropic;
  private apiKeyValid: boolean;

  constructor(
    chunkRepo: IDocumentChunkRepository,
    docRepo: IDocumentRepositoryForEmbedding,
    anthropicClient: Anthropic
  ) {
    this.chunkRepo = chunkRepo;
    this.docRepo = docRepo;
    this.anthropicClient = anthropicClient;
    // التحقق من صحة المفتاح عند الإنشاء
    this.apiKeyValid = this.checkApiKeyValidity();
  }

  // ============================================================
  // التحقق من صحة مفتاح API
  // ============================================================

  private checkApiKeyValidity(): boolean {
    const key = config.anthropic?.apiKey;
    if (!key || key === 'dummy_key_for_development_please_replace_in_production') {
      logger.warn('⚠️ مفتاح Anthropic API وهمي أو غير موجود – سيتم استخدام الاحتياطي فقط.');
      return false;
    }
    // يمكن إضافة فحوصات إضافية مثل التحقق من التنسيق
    if (!key.startsWith('sk-')) {
      logger.warn('⚠️ مفتاح Anthropic API غير صحيح (لا يبدأ بـ sk-) – سيتم استخدام الاحتياطي.');
      return false;
    }
    return true;
  }

  // ============================================================
  // دوال مساعدة (تنقية، احتياطي)
  // ============================================================

  private sanitizeInput(text: string): string {
    if (!text) return '';
    let sanitized = text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/[<>{}[\]|\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const maxLength = config.anthropic?.maxPromptLength || 100000;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
      logger.warn('تم اقتطاع النص بسبب تجاوز الحد الأقصى للطول', {
        originalLength: text.length,
        truncatedLength: sanitized.length,
        maxLength,
      });
    }

    return sanitized;
  }

  private fallbackChunking(text: string, chunkSize: number = 1000, chunkOverlap: number = 200): string[] {
    if (!text || text.length === 0) return [];

    const estimatedTokensPerChar = 0.25;
    const chunkChars = Math.floor(chunkSize / estimatedTokensPerChar);
    const overlapChars = Math.floor(chunkOverlap / estimatedTokensPerChar);

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + chunkChars, text.length);
      if (end < text.length) {
        const searchEnd = Math.min(end + 100, text.length);
        const lastPeriod = text.lastIndexOf('.', searchEnd);
        const lastNewline = text.lastIndexOf('\n', searchEnd);
        const lastSpace = text.lastIndexOf(' ', searchEnd);
        let cutPoint = Math.max(lastPeriod, lastNewline, lastSpace);
        if (cutPoint > start + chunkChars * 0.5) {
          end = cutPoint + 1;
        }
      }
      const chunk = text.substring(start, end).trim();
      if (chunk.length > 0) chunks.push(chunk);
      start = end - overlapChars;
      if (start <= 0 || start >= text.length) break;
    }

    logger.debug('تم استخدام الاحتياطي للتقطيع (حسب الحجم)', {
      chunkCount: chunks.length,
      totalChars: text.length,
      chunkSize: chunkChars,
      overlap: overlapChars,
    });

    return chunks;
  }

  private fallbackEmbedding(text: string): number[] {
    const dimensions = vectorConfig.dimensions;
    const embedding = new Array(dimensions);
    for (let i = 0; i < dimensions; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      embedding[i] = z / 10;
    }
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] = embedding[i] / norm;
      }
    }
    logger.debug('تم استخدام الاحتياطي للتضمين (متجه عشوائي)', {
      dimensions: embedding.length,
    });
    return embedding;
  }

  // ============================================================
  // التقطيع باستخدام Claude (مع فحص المفتاح)
  // ============================================================

  private async chunkTextWithAI(
    text: string,
    chunkSize: number = 1000,
    chunkOverlap: number = 200,
    idempotencyKey?: string
  ): Promise<string[]> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const sanitizedText = this.sanitizeInput(text);

    if (!sanitizedText || sanitizedText.length < 10) {
      logger.warn('نص قصير جداً للتقطيع، إرجاع النص كاملاً', {
        correlationId,
        textLength: sanitizedText.length,
        idempotencyKey,
      });
      return [sanitizedText];
    }

    // ✅ فحص المفتاح مبكرًا
    if (!this.apiKeyValid) {
      logger.info('⚠️ مفتاح API غير صالح – استخدام الاحتياطي للتقطيع.', { correlationId, idempotencyKey });
      return this.fallbackChunking(sanitizedText, chunkSize, chunkOverlap);
    }

    const prompt = `
      قم بتقطيع النص التالي إلى مقاطع (chunks) ذات معنى دلالي.
      كل مقطع يجب أن يكون بين ${chunkSize} و ${chunkSize + 200} رمز (token).
      التداخل بين المقاطع يجب أن يكون حوالي ${chunkOverlap} رمز.
      قم بإرجاع المقاطع كمصفوفة من النصوص فقط، بدون أي تعليقات أو تفسيرات إضافية.

      النص:
      ${sanitizedText}
    `;

    try {
      const result = await withCircuitBreakerAndRetry(
        async () => {
          const response = await this.anthropicClient.messages.create({
            model: config.anthropic.model,
            max_tokens: config.anthropic.maxTokens,
            temperature: config.anthropic.temperature,
            messages: [{ role: 'user', content: prompt }],
          });

          const content = response.content[0];
          if (!content || content.type !== 'text') {
            throw new Error('استجابة غير متوقعة من Claude: نوع المحتوى ليس نصاً أو فارغاً');
          }
          return content.text;
        },
        {
          serviceName: 'claude-chunking',
          idempotencyKey: idempotencyKey || `chunk-${correlationId}`,
          timeoutMs: config.circuitBreaker.timeout,
          errorThreshold: config.circuitBreaker.errorThreshold,
          halfOpenWaitMs: 60000,
          maxRetries: config.retry.maxAttempts - 1,
          backoffBaseMs: config.retry.backoffBase,
          maxBackoffMs: 30000,
        }
      );

      const parsed = ChunkingResponseSchema.safeParse(JSON.parse(result.data || '{}'));
      if (!parsed.success) {
        logger.warn('فشل التحقق من مخرجات تقطيع النص، استخدام الاحتياطي', {
          correlationId,
          error: parsed.error.message,
          idempotencyKey,
        });
        return this.fallbackChunking(sanitizedText, chunkSize, chunkOverlap);
      }

      const chunks = parsed.data.chunks.filter((c) => c.trim().length > 0);
      if (chunks.length === 0) {
        logger.warn('لم يتم إرجاع أي مقاطع من Claude، استخدام الاحتياطي', {
          correlationId,
          idempotencyKey,
        });
        return this.fallbackChunking(sanitizedText, chunkSize, chunkOverlap);
      }

      logger.debug('تم تقطيع النص بنجاح باستخدام Claude', {
        correlationId,
        chunkCount: chunks.length,
        totalChars: sanitizedText.length,
        idempotencyKey,
      });

      return chunks;
    } catch (error) {
      logger.error('فشل تقطيع النص باستخدام Claude، استخدام الاحتياطي', {
        correlationId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      // لا نرمي خطأ، نستخدم الاحتياطي
      return this.fallbackChunking(sanitizedText, chunkSize, chunkOverlap);
    }
  }

  // ============================================================
  // توليد التضمين باستخدام Claude (مع فحص المفتاح)
  // ============================================================

  private async generateEmbeddingWithAI(
    text: string,
    idempotencyKey?: string
  ): Promise<number[]> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const sanitizedText = this.sanitizeInput(text);

    if (!sanitizedText || sanitizedText.length < 3) {
      logger.warn('نص قصير جداً للتضمين، إرجاع متجه صفري', {
        correlationId,
        textLength: sanitizedText.length,
        idempotencyKey,
      });
      return new Array(vectorConfig.dimensions).fill(0);
    }

    // ✅ فحص المفتاح مبكرًا
    if (!this.apiKeyValid) {
      logger.info('⚠️ مفتاح API غير صالح – استخدام الاحتياطي للتضمين.', { correlationId, idempotencyKey });
      return this.fallbackEmbedding(sanitizedText);
    }

    const prompt = `
      قم بتوليد تضمين (embedding vector) للنص التالي.
      يجب أن يكون التضمين مصفوفة من الأرقام العشرية (float) بطول ${vectorConfig.dimensions}.
      قم بإرجاع التضمين كمصفوفة JSON فقط، بدون أي تعليقات أو تفسيرات إضافية.

      النص:
      ${sanitizedText}
    `;

    try {
      const result = await withCircuitBreakerAndRetry(
        async () => {
          const response = await this.anthropicClient.messages.create({
            model: config.anthropic.model,
            max_tokens: config.anthropic.maxTokens,
            temperature: 0.1,
            messages: [{ role: 'user', content: prompt }],
          });

          const content = response.content[0];
          if (!content || content.type !== 'text') {
            throw new Error('استجابة غير متوقعة من Claude: نوع المحتوى ليس نصاً أو فارغاً');
          }
          return content.text;
        },
        {
          serviceName: 'claude-embedding',
          idempotencyKey: idempotencyKey || `embed-${correlationId}`,
          timeoutMs: config.circuitBreaker.timeout,
          errorThreshold: config.circuitBreaker.errorThreshold,
          halfOpenWaitMs: 60000,
          maxRetries: config.retry.maxAttempts - 1,
          backoffBaseMs: config.retry.backoffBase,
          maxBackoffMs: 30000,
        }
      );

      let parsedData: any;
      try {
        parsedData = JSON.parse(result.data || '{}');
      } catch {
        logger.warn('فشل تحليل استجابة التضمين كـ JSON، استخدام الاحتياطي', {
          correlationId,
          idempotencyKey,
        });
        return this.fallbackEmbedding(sanitizedText);
      }

      const parsed = EmbeddingResponseSchema.safeParse(parsedData);
      if (!parsed.success) {
        logger.warn('فشل التحقق من مخرجات التضمين، استخدام الاحتياطي', {
          correlationId,
          error: parsed.error.message,
          idempotencyKey,
        });
        return this.fallbackEmbedding(sanitizedText);
      }

      const embedding = parsed.data.embedding;
      if (embedding.length !== vectorConfig.dimensions) {
        logger.warn(`بُعد المتجه (${embedding.length}) لا يتطابق مع البعد المتوقع (${vectorConfig.dimensions})، استخدام الاحتياطي`, {
          correlationId,
          idempotencyKey,
        });
        return this.fallbackEmbedding(sanitizedText);
      }

      logger.debug('تم توليد التضمين بنجاح باستخدام Claude', {
        correlationId,
        vectorDimensions: embedding.length,
        idempotencyKey,
      });

      return embedding;
    } catch (error) {
      logger.error('فشل توليد التضمين باستخدام Claude، استخدام الاحتياطي', {
        correlationId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      return this.fallbackEmbedding(sanitizedText);
    }
  }

  // ============================================================
  // الوظائف العامة
  // ============================================================

  async generateDocumentEmbeddings(
    options: GenerateEmbeddingsOptions
  ): Promise<{ chunkCount: number; vectorCount: number }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const {
      documentId,
      tenantId,
      knowledgeBaseId,
      text,
      chunkSize = 1000,
      chunkOverlap = 200,
      idempotencyKey,
    } = options;

    // التحقق من المدخلات
    if (!documentId || !tenantId || !knowledgeBaseId || !text) {
      logger.warn('محاولة توليد تضمينات ببيانات ناقصة', {
        correlationId,
        hasDocumentId: !!documentId,
        hasTenantId: !!tenantId,
        hasKnowledgeBaseId: !!knowledgeBaseId,
        hasText: !!text,
        idempotencyKey,
      });
      throw new ValidationError('معرف المستند، معرف المستأجر، معرف قاعدة المعرفة، والنص مطلوبة');
    }

    if (text.length < 3) {
      logger.warn('نص قصير جداً لتوليد التضمينات', {
        correlationId,
        documentId,
        textLength: text.length,
        idempotencyKey,
      });
      throw new ValidationError('النص قصير جداً لتوليد التضمينات (يجب أن يكون 3 أحرف على الأقل)');
    }

    // التحقق من المستند
    let doc: any;
    try {
      doc = await withRetryAndThrow(
        () => this.docRepo.findById(documentId),
        {
          operationName: 'embedding.findDocument',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستند غير موجود لتوليد التضمينات', {
          correlationId,
          documentId,
          tenantId,
          idempotencyKey,
        });
        throw new NotFoundError('المستند غير موجود');
      }
      logger.error('فشل جلب المستند لتوليد التضمينات', {
        correlationId,
        documentId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل جلب المستند، يرجى المحاولة مرة أخرى');
    }

    if (!doc) throw new NotFoundError('المستند غير موجود');
    if (doc.tenantId !== tenantId) {
      logger.warn('محاولة توليد تضمينات لمستند لا ينتمي للمستأجر', {
        correlationId,
        documentId,
        requestedTenantId: tenantId,
        actualTenantId: doc.tenantId,
        idempotencyKey,
      });
      throw new ValidationError('المستند لا ينتمي إلى هذا المستأجر');
    }
    if (doc.deletedAt) {
      logger.warn('محاولة توليد تضمينات لمستند محذوف', {
        correlationId,
        documentId,
        tenantId,
        deletedAt: doc.deletedAt,
        idempotencyKey,
      });
      throw new NotFoundError('المستند غير موجود');
    }

    // تحديث الحالة إلى PROCESSING
    try {
      await this.docRepo.updateStatus(documentId, 'PROCESSING');
    } catch (error) {
      logger.error('فشل تحديث حالة المستند إلى PROCESSING', {
        correlationId,
        documentId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
    }

    try {
      const chunks = await this.chunkTextWithAI(text, chunkSize, chunkOverlap, idempotencyKey || `chunk-${documentId}`);

      if (chunks.length === 0) {
        logger.warn('لم يتم توليد أي مقاطع من النص', {
          correlationId,
          documentId,
          textLength: text.length,
          idempotencyKey,
        });
        await this.docRepo.updateStatus(documentId, 'FAILED', 'لم يتم توليد أي مقاطع من النص');
        throw new ValidationError('لم يتم توليد أي مقاطع من النص');
      }

      logger.info('تم تقطيع النص إلى مقاطع', {
        correlationId,
        documentId,
        chunkCount: chunks.length,
        idempotencyKey,
      });

      const chunkRecords: any[] = [];
      let vectorCount = 0;

      for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i];
        if (!chunkText || chunkText.trim().length === 0) continue;

        try {
          const embedding = await this.generateEmbeddingWithAI(
            chunkText,
            idempotencyKey || `embed-${documentId}-${i}`
          );

          const isZeroVector = embedding.every((v) => Math.abs(v) < 0.0001);
          if (isZeroVector) {
            logger.warn('تم توليد متجه صفري للمقطع، تخطي', {
              correlationId,
              documentId,
              chunkIndex: i,
              idempotencyKey,
            });
            continue;
          }

          chunkRecords.push({
            documentId,
            knowledgeBaseId,
            tenantId,
            content: chunkText,
            vector: embedding,
            chunkIndex: i,
            createdAt: new Date(),
          });

          vectorCount++;
        } catch (error) {
          logger.error('فشل توليد التضمين لمقطع', {
            correlationId,
            documentId,
            chunkIndex: i,
            error: error instanceof Error ? error.message : 'unknown',
            idempotencyKey,
          });
        }
      }

      if (vectorCount === 0) {
        logger.error('فشل توليد أي تضمينات للمستند', {
          correlationId,
          documentId,
          chunks: chunks.length,
          idempotencyKey,
        });
        await this.docRepo.updateStatus(documentId, 'FAILED', 'فشل توليد التضمينات لجميع المقاطع');
        throw new InternalServerError('فشل توليد التضمينات لجميع المقاطع');
      }

      try {
        await withRetryAndThrow(
          () => this.chunkRepo.bulkCreate(chunkRecords),
          {
            operationName: 'embedding.bulkCreate',
            idempotencyKey: idempotencyKey || `bulk-${documentId}`,
            maxAttempts: 3,
            verboseLogging: false,
          }
        );
      } catch (error) {
        logger.error('فشل حفظ مقاطع التضمين في قاعدة البيانات', {
          correlationId,
          documentId,
          chunkCount: chunkRecords.length,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        await this.docRepo.updateStatus(documentId, 'FAILED', 'فشل حفظ التضمينات في قاعدة البيانات');
        throw new InternalServerError('فشل حفظ التضمينات، يرجى المحاولة مرة أخرى');
      }

      await this.docRepo.updateStatus(documentId, 'COMPLETED');

      logger.info('تم توليد التضمينات للمستند بنجاح', {
        correlationId,
        documentId,
        fileName: doc.fileName,
        tenantId,
        chunkCount: chunks.length,
        vectorCount,
        idempotencyKey,
        event: 'embedding.generate.success',
      });

      return { chunkCount: chunks.length, vectorCount };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل غير معروف';
      try {
        await this.docRepo.updateStatus(documentId, 'FAILED', errorMessage);
      } catch (statusError) {
        logger.error('فشل تحديث حالة المستند إلى FAILED', {
          correlationId,
          documentId,
          error: statusError instanceof Error ? statusError.message : 'unknown',
          idempotencyKey,
        });
      }

      logger.error('فشل توليد التضمينات للمستند', {
        correlationId,
        documentId,
        fileName: doc.fileName,
        tenantId,
        error: errorMessage,
        idempotencyKey,
        event: 'embedding.generate.failed',
      });

      if (error instanceof AppError) throw error;
      throw new InternalServerError(`فشل توليد التضمينات: ${errorMessage}`);
    }
  }

  // ============================================================
  // البحث الدلالي
  // ============================================================

  async searchSimilar(
    options: SearchSimilarOptions
  ): Promise<SearchSimilarResult> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const {
      tenantId,
      knowledgeBaseId,
      query,
      limit = vectorConfig.maxSearchResults || 10,
      threshold = vectorConfig.similarityThreshold || 0.7,
    } = options;

    if (!tenantId || !knowledgeBaseId || !query) {
      logger.warn('محاولة بحث ببيانات ناقصة', {
        correlationId,
        hasTenantId: !!tenantId,
        hasKnowledgeBaseId: !!knowledgeBaseId,
        hasQuery: !!query,
      });
      throw new ValidationError('معرف المستأجر، معرف قاعدة المعرفة، ونص الاستعلام مطلوبة');
    }

    if (query.trim().length < 2) {
      logger.warn('استعلام بحث قصير جداً', {
        correlationId,
        queryLength: query.length,
      });
      throw new ValidationError('نص الاستعلام يجب أن يكون حرفين على الأقل');
    }

    const sanitizedQuery = this.sanitizeInput(query);

    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.generateEmbeddingWithAI(sanitizedQuery, `search-${correlationId}`);
    } catch (error) {
      logger.error('فشل توليد تضمين للاستعلام', {
        correlationId,
        query: sanitizedQuery.substring(0, 100),
        error: error instanceof Error ? error.message : 'unknown',
      });
      // نستخدم الاحتياطي: متجه عشوائي أو صفري، ونستمر في البحث (قد يعيد نتائج عشوائية لكن الأفضل إرجاع نتائج فارغة)
      // هنا نقرر إرجاع نتائج فارغة بدلاً من رمي خطأ
      logger.warn('العودة إلى نتائج فارغة بسبب فشل تضمين الاستعلام', { correlationId });
      return { chunks: [], query: sanitizedQuery, limit, threshold };
    }

    const isZeroVector = queryEmbedding.every((v) => Math.abs(v) < 0.0001);
    if (isZeroVector) {
      logger.warn('تم توليد متجه صفري للاستعلام، إرجاع نتائج فارغة', {
        correlationId,
        query: sanitizedQuery.substring(0, 100),
      });
      return { chunks: [], query: sanitizedQuery, limit, threshold };
    }

    let similarChunks: any[];
    try {
      similarChunks = await withRetryAndThrow(
        () => this.chunkRepo.findSimilarVectors(queryEmbedding, limit, knowledgeBaseId, threshold),
        {
          operationName: 'embedding.search',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل البحث عن المقاطع المشابهة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      // إرجاع نتائج فارغة بدلاً من رمي خطأ
      return { chunks: [], query: sanitizedQuery, limit, threshold };
    }

    const formattedChunks = similarChunks.map((chunk) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      content: chunk.content,
      similarity: chunk.similarity || 0,
      metadata: chunk.metadata || {},
    }));

    logger.debug('تم العثور على مقاطع مشابهة', {
      correlationId,
      knowledgeBaseId,
      tenantId,
      queryLength: sanitizedQuery.length,
      resultsCount: formattedChunks.length,
      limit,
      threshold,
    });

    return {
      chunks: formattedChunks,
      query: sanitizedQuery,
      limit,
      threshold,
    };
  }

  // ============================================================
  // حذف التضمينات
  // ============================================================

  async deleteDocumentEmbeddings(documentId: string, tenantId: string): Promise<void> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!documentId || !tenantId) {
      throw new ValidationError('معرف المستند ومعرف المستأجر مطلوبان');
    }

    let doc: any;
    try {
      doc = await withRetryAndThrow(
        () => this.docRepo.findById(documentId),
        {
          operationName: 'embedding.delete.findDocument',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستند غير موجود لحذف التضمينات', {
          correlationId,
          documentId,
          tenantId,
        });
        return;
      }
      logger.error('فشل جلب المستند لحذف التضمينات', {
        correlationId,
        documentId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حذف التضمينات، يرجى المحاولة مرة أخرى');
    }

    if (!doc) return;

    if (doc.tenantId !== tenantId) {
      logger.warn('محاولة حذف تضمينات لمستند لا ينتمي للمستأجر', {
        correlationId,
        documentId,
        requestedTenantId: tenantId,
        actualTenantId: doc.tenantId,
      });
      throw new ValidationError('المستند لا ينتمي إلى هذا المستأجر');
    }

    try {
      await withRetryAndThrow(
        () => this.chunkRepo.deleteByDocumentId(documentId),
        {
          operationName: 'embedding.delete',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل حذف تضمينات المستند', {
        correlationId,
        documentId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حذف التضمينات، يرجى المحاولة مرة أخرى');
    }

    logger.info('تم حذف تضمينات المستند', {
      correlationId,
      documentId,
      fileName: doc.fileName,
      tenantId,
      event: 'embedding.delete.success',
    });
  }

  // ============================================================
  // عدد المقاطع
  // ============================================================

  async getChunkCount(documentId: string, tenantId: string): Promise<number> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!documentId || !tenantId) {
      throw new ValidationError('معرف المستند ومعرف المستأجر مطلوبان');
    }

    let doc: any;
    try {
      doc = await withRetryAndThrow(
        () => this.docRepo.findById(documentId),
        {
          operationName: 'embedding.count.findDocument',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستند غير موجود لحساب المقاطع', {
          correlationId,
          documentId,
          tenantId,
        });
        return 0;
      }
      logger.error('فشل جلب المستند لحساب المقاطع', {
        correlationId,
        documentId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حساب المقاطع، يرجى المحاولة مرة أخرى');
    }

    if (!doc) return 0;

    if (doc.tenantId !== tenantId) {
      logger.warn('محاولة حساب مقاطع لمستند لا ينتمي للمستأجر', {
        correlationId,
        documentId,
        requestedTenantId: tenantId,
        actualTenantId: doc.tenantId,
      });
      return 0;
    }

    let count: number;
    try {
      count = await withRetryAndThrow(
        () => this.chunkRepo.countByDocumentId(documentId),
        {
          operationName: 'embedding.count',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل حساب عدد مقاطع المستند', {
        correlationId,
        documentId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حساب المقاطع، يرجى المحاولة مرة أخرى');
    }

    logger.debug('تم حساب عدد المقاطع', {
      correlationId,
      documentId,
      tenantId,
      count,
    });

    return count;
  }
}

// ============================================================
// تصدير نسخة من الخدمة (تُستخدم في الأوركستراتور)
// ============================================================

export const embeddingService = new EmbeddingService(
  {} as IDocumentChunkRepository,
  {} as IDocumentRepositoryForEmbedding,
  new Anthropic({ apiKey: config.anthropic.apiKey })
);

export default embeddingService;
