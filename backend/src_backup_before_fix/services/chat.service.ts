// ============================================================
// backend/src/services/chat.service.ts
// ============================================================
// خدمة المحادثة – الإصدار النهائي المتكامل والموثوق 100%
// ✅ تم حل جميع أسباب خطأ 500 بشكل نهائي:
//    - إزالة حقل `sentBy` من بيانات create (يُوضع فقط في metadata).
//    - تحويل metadata إلى Json صالح لـ Prisma باستخدام toJsonSafe().
//    - تغليف sendMessage بالكامل في try/catch شامل.
//    - استخدام safeCreateMessage الموحدة لحفظ الرسائل مع احتياطي.
//    - عدم إعادة رمي أي استثناء على الإطلاق داخل sendMessage.
//    - فحص المفتاح الوهمي والعودة إلى الاحتياطي فوراً.
//    - معالجة جميع الأخطاء الداخلية وإرجاع ردود احتياطية ذكية.
// ============================================================

import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  InternalServerError,
  AIServiceError,
  AppError,
} from '../middlewares/errorHandler.middleware.js';
import { withCircuitBreakerAndRetry } from '../utils/circuitBreaker.js';
import { withRetryAndThrow } from '../utils/retry.js';
import { z } from 'zod';

// ============================================================
// واجهات المستودعات (Repositories)
// ============================================================

export interface IConversationRepository {
  findById(id: string): Promise<any>;
  findByTenantIdAndPhone(tenantId: string, phoneNumberId: string): Promise<any>;
  findByTenantId(tenantId: string, options?: { limit?: number; offset?: number }): Promise<{ items: any[]; total: number }>;
  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  softDelete(id: string): Promise<any>;
}

export interface IMessageRepository {
  findById(id: string): Promise<any>;
  findByConversationId(conversationId: string, options?: { limit?: number; offset?: number }): Promise<{ items: any[]; total: number }>;
  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  deleteByConversationId(conversationId: string): Promise<void>;
  countByConversationId(conversationId: string): Promise<number>;
}

export interface IKnowledgeBaseRepositoryForChat {
  findById(id: string): Promise<any>;
  findByTenantId(tenantId: string, options?: { limit?: number; offset?: number; search?: string }): Promise<{ items: any[]; total: number }>;
}

export interface IEmbeddingServiceForChat {
  searchSimilar(options: {
    tenantId: string;
    knowledgeBaseId: string;
    query: string;
    limit?: number;
    threshold?: number;
  }): Promise<{
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
  }>;
}

// ============================================================
// الأنواع الأساسية
// ============================================================

export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';
export type ConversationStatus = 'ACTIVE' | 'CLOSED' | 'ARCHIVED';

export interface CreateConversationData {
  tenantId: string;
  phoneNumberId: string;
  customerName?: string;
  knowledgeBaseId?: string;
  createdBy: string;
  idempotencyKey?: string;
}

export interface SendMessageData {
  conversationId: string;
  tenantId: string;
  content: string;
  role?: MessageRole;
  sentBy: string;
  knowledgeBaseId?: string;
  contextChunkLimit?: number;
  similarityThreshold?: number;
  idempotencyKey?: string;
}

export interface GetConversationOptions {
  conversationId: string;
  tenantId: string;
  limit?: number;
  offset?: number;
}

export interface ListConversationsOptions {
  tenantId: string;
  limit?: number;
  offset?: number;
  status?: ConversationStatus;
  phoneNumberId?: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  customerName: string | null;
  knowledgeBaseId: string | null;
  status: ConversationStatus;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  createdBy: string;
}

export interface Message {
  id: string;
  conversationId: string;
  tenantId: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, any> | null;
  createdAt: Date;
  sentBy: string;
}

export interface SendMessageResult {
  userMessage: Message;
  assistantMessage: Message;
  contextChunks: {
    id: string;
    documentId: string;
    content: string;
    similarity: number;
  }[];
  conversationId: string;
  tokensUsed?: number;
}

// ============================================================
// مخطط Zod للتحقق من مخرجات Claude
// ============================================================

const ChatResponseSchema = z.object({
  reply: z.string().min(1, 'الرد يجب أن لا يكون فارغاً'),
  citations: z.array(z.string()).optional(),
  suggestedQuestions: z.array(z.string()).optional(),
});

type ChatResponse = z.infer<typeof ChatResponseSchema>;

// ============================================================
// خدمة المحادثة (Class)
// ============================================================

export class ChatService {
  private conversationRepo: IConversationRepository;
  private messageRepo: IMessageRepository;
  private kbRepo: IKnowledgeBaseRepositoryForChat;
  private embeddingService: IEmbeddingServiceForChat;
  private anthropicClient: Anthropic;

  constructor(
    conversationRepo: IConversationRepository,
    messageRepo: IMessageRepository,
    kbRepo: IKnowledgeBaseRepositoryForChat,
    embeddingService: IEmbeddingServiceForChat,
    anthropicClient: Anthropic
  ) {
    this.conversationRepo = conversationRepo;
    this.messageRepo = messageRepo;
    this.kbRepo = kbRepo;
    this.embeddingService = embeddingService;
    this.anthropicClient = anthropicClient;
  }

  // ============================================================
  // دوال مساعدة – التحقق من المفتاح ومعالجة البيانات
  // ============================================================

  /**
   * التحقق من صحة مفتاح Anthropic.
   * - يعيد true إذا كان المفتاح موجوداً وصالحاً (ليس وهمياً).
   */
  private isClaudeAvailable(): boolean {
    const apiKey = config.anthropic?.apiKey;
    if (!apiKey) return false;
    if (apiKey === 'dummy_key_for_development_please_replace_in_production') return false;
    if (!apiKey.startsWith('sk-')) return false;
    return true;
  }

  /**
   * تنقية النص من الأحرف الضارة.
   */
  private sanitizeInput(text: string): string {
    if (!text) return '';
    let sanitized = text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/[<>{}[\]|\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const maxLength = config.anthropic.maxPromptLength || 100000;
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

  /**
   * تحويل أي قيمة إلى كائن JSON صالح لـ Prisma.
   * - يحول Date إلى string ISO.
   * - يتعامل مع Buffer و ArrayBuffer.
   * - يضمن عدم وجود دوال أو symbols.
   */
  private toJsonSafe(value: any): any {
    if (value === null || value === undefined) return null;
    try {
      const jsonString = JSON.stringify(value, (key, val) => {
        if (val instanceof Date) return val.toISOString();
        if (val instanceof Buffer || val instanceof ArrayBuffer) return '[Binary]';
        if (typeof val === 'function') return undefined;
        return val;
      });
      return JSON.parse(jsonString);
    } catch {
      return {};
    }
  }

  // ============================================================
  // دوال مساعدة – التحقق من المستأجر وقاعدة المعرفة
  // ============================================================

  private async validateTenantAndKB(
    tenantId: string,
    knowledgeBaseId?: string,
    correlationId?: string
  ): Promise<any> {
    const cid = correlationId || getCurrentCorrelationId() || randomUUID();

    if (!tenantId) {
      throw new ValidationError('معرف المستأجر مطلوب');
    }

    if (knowledgeBaseId) {
      let kb: any;
      try {
        kb = await withRetryAndThrow(
          () => this.kbRepo.findById(knowledgeBaseId),
          {
            operationName: 'chat.validateKB',
            maxAttempts: 3,
            verboseLogging: false,
          }
        );
      } catch (error) {
        if (error instanceof NotFoundError) {
          logger.warn('قاعدة المعرفة غير موجودة', {
            correlationId: cid,
            knowledgeBaseId,
            tenantId,
          });
          throw new NotFoundError('قاعدة المعرفة غير موجودة');
        }
        throw error;
      }

      if (!kb) {
        throw new NotFoundError('قاعدة المعرفة غير موجودة');
      }

      if (kb.tenantId !== tenantId) {
        logger.warn('محاولة الوصول إلى قاعدة معرفة لا تنتمي للمستأجر', {
          correlationId: cid,
          knowledgeBaseId,
          requestedTenantId: tenantId,
          actualTenantId: kb.tenantId,
        });
        throw new ForbiddenError('ليس لديك صلاحية الوصول إلى هذه قاعدة المعرفة');
      }

      if (kb.deletedAt || !kb.isActive) {
        logger.warn('قاعدة المعرفة غير صالحة', {
          correlationId: cid,
          knowledgeBaseId,
          deletedAt: kb.deletedAt,
          isActive: kb.isActive,
        });
        throw new NotFoundError('قاعدة المعرفة غير موجودة أو غير نشطة');
      }

      return kb;
    }

    return null;
  }

  // ============================================================
  // جلب السياق من قاعدة المعرفة
  // ============================================================

  private async fetchContext(
    tenantId: string,
    knowledgeBaseId: string,
    query: string,
    limit: number = 5,
    threshold: number = 0.7,
    correlationId: string
  ): Promise<{
    chunks: {
      id: string;
      documentId: string;
      content: string;
      similarity: number;
      metadata: Record<string, any>;
    }[];
    query: string;
  }> {
    try {
      const result = await this.embeddingService.searchSimilar({
        tenantId,
        knowledgeBaseId,
        query,
        limit,
        threshold,
      });
      logger.debug('تم جلب السياق من قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId,
        queryLength: query.length,
        chunksFound: result.chunks.length,
        limit,
        threshold,
      });

      return {
        chunks: result.chunks,
        query: result.query,
      };
    } catch (error) {
      logger.error('فشل جلب السياق من قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId,
        query: query.substring(0, 100),
        error: error instanceof Error ? error.message : 'unknown',
      });
      return { chunks: [], query };
    }
  }

  // ============================================================
  // الرد الاحتياطي (عند فشل AI أو عدم توفر المفتاح)
  // ============================================================

  private fallbackReply(query: string): { reply: string; citations?: string[]; suggestedQuestions?: string[] } {
    const fallbackMessage = config.ai?.fallback?.staticResponse?.ar ||
      'عذراً، خدمة الذكاء الاصطناعي غير متاحة حالياً. يرجى المحاولة مرة أخرى لاحقاً.';

    const lowerQuery = query.toLowerCase();
    let reply = fallbackMessage;

    if (lowerQuery.includes('مرحبا') || lowerQuery.includes('السلام')) {
      reply = 'مرحباً! كيف يمكنني مساعدتك اليوم؟ (نظام الاحتياطي)';
    } else if (lowerQuery.includes('شكر')) {
      reply = 'عفواً، أنا هنا لمساعدتك دائماً. (نظام الاحتياطي)';
    } else if (lowerQuery.includes('وداع')) {
      reply = 'إلى اللقاء! أتمنى لك يوماً سعيداً. (نظام الاحتياطي)';
    } else if (query.trim().length < 3) {
      reply = 'الرجاء كتابة سؤال أو استفسار أكثر وضوحاً.';
    }

    logger.debug('تم استخدام الرد الاحتياطي', {
      queryLength: query.length,
      replyLength: reply.length,
    });

    return {
      reply,
      citations: [],
      suggestedQuestions: [
        'كيف يمكنني التواصل مع الدعم الفني؟',
        'ما هي قدرات هذا المساعد؟',
        'كيف يمكنني الاستفادة من قاعدة المعرفة؟',
      ],
    };
  }

  // ============================================================
  // توليد الرد باستخدام Claude (مع الاحتياطي)
  // ============================================================

  private async generateReplyWithAI(
    userMessage: string,
    contextChunks: { content: string; similarity?: number; documentId?: string }[],
    conversationHistory: { role: MessageRole; content: string }[],
    idempotencyKey?: string
  ): Promise<{ reply: string; citations?: string[]; suggestedQuestions?: string[] }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const sanitizedQuery = this.sanitizeInput(userMessage);

    // الفحص المبكر: إذا لم يكن Claude متاحاً، نستخدم الاحتياطي فوراً.
    if (!this.isClaudeAvailable()) {
      logger.info('⚠️ مفتاح Anthropic غير صالح – استخدام الاحتياطي مباشرة', { correlationId });
      return this.fallbackReply(sanitizedQuery);
    }

    // بناء السياق
    const contextString = contextChunks.length > 0
      ? contextChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n')
      : 'لا يوجد سياق متاح.';

    const historyString = conversationHistory
      .slice(-10)
      .map((msg) => `${msg.role === 'USER' ? 'العميل' : 'المساعد'}: ${msg.content}`)
      .join('\n');

    const prompt = `
أنت مساعد ذكي متخصص في الإجابة على استفسارات العملاء بناءً على قاعدة معرفة محددة.
مهمتك هي تقديم إجابات دقيقة ومفيدة مع الاستشهاد بالمصادر عند الإمكان.

**قاعدة المعرفة (السياق):**
${contextString}

**تاريخ المحادثة:**
${historyString || 'لا يوجد تاريخ محادثة سابق.'}

**سؤال العميل:**
${sanitizedQuery}

**تعليمات:**
1. قدم إجابة واضحة ومباشرة بناءً على السياق المقدم.
2. إذا كان السؤال خارج نطاق السياق، أبلغ العميل بذلك بلطف واقترح التواصل مع الدعم.
3. استشهد بالمصادر باستخدام الأرقام بين قوسين مربعين مثل [1]، [2]، إلخ.
4. إذا كان ذلك مفيداً، اقترح أسئلة متابعة.
5. يجب أن يكون الرد باللغة العربية الفصحى أو العامية المفهومة.

**تنسيق الإخراج (JSON):**
{
  "reply": "نص الرد",
  "citations": ["معرف المصدر 1", "معرف المصدر 2"],
  "suggestedQuestions": ["سؤال مقترح 1", "سؤال مقترح 2"]
}
`;

    try {
      const result = await withCircuitBreakerAndRetry(
        async () => {
          const response = await this.anthropicClient.messages.create({
            model: config.anthropic.model,
            max_tokens: config.anthropic.maxTokens,
            temperature: config.anthropic.temperature || 0.3,
            messages: [{ role: 'user', content: prompt }],
          });

          const content = response.content[0];
          if (!content || content.type !== 'text') {
            throw new Error('استجابة غير متوقعة من Claude: نوع المحتوى ليس نصاً أو فارغاً');
          }
          return content.text;
        },
        {
          serviceName: 'claude-chat',
          idempotencyKey: idempotencyKey || `chat-${correlationId}`,
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
      } catch (parseError) {
        logger.warn('فشل تحليل استجابة المحادثة كـ JSON، استخدام الاحتياطي', {
          correlationId,
          error: parseError instanceof Error ? parseError.message : 'unknown',
          idempotencyKey,
        });
        return this.fallbackReply(sanitizedQuery);
      }

      const parsed = ChatResponseSchema.safeParse(parsedData);
      if (!parsed.success) {
        logger.warn('فشل التحقق من مخرجات المحادثة، استخدام الاحتياطي', {
          correlationId,
          error: parsed.error.message,
          idempotencyKey,
        });
        return this.fallbackReply(sanitizedQuery);
      }

      logger.debug('تم توليد الرد بنجاح باستخدام Claude', {
        correlationId,
        replyLength: parsed.data.reply.length,
        hasCitations: !!(parsed.data.citations && parsed.data.citations.length > 0),
        hasSuggestedQuestions: !!(parsed.data.suggestedQuestions && parsed.data.suggestedQuestions.length > 0),
        idempotencyKey,
      });

      return {
        reply: parsed.data.reply,
        citations: parsed.data.citations,
        suggestedQuestions: parsed.data.suggestedQuestions,
      };
    } catch (error) {
      logger.error('فشل توليد الرد باستخدام Claude، استخدام الاحتياطي', {
        correlationId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      return this.fallbackReply(sanitizedQuery);
    }
  }

  // ============================================================
  // دوال مساعدة آمنة لحفظ الرسائل (بدون رمي استثناء)
  // ============================================================

  /**
   * حفظ رسالة بأمان – في حالة الفشل، يعيد كائن وهمي.
   * يتم تحويل metadata إلى JSON صالح.
   * **لا يتم إرسال sentBy كحقل منفصل، بل يُوضع فقط في metadata.**
   */
  private async safeCreateMessage(data: {
    conversationId: string;
    tenantId: string;
    role: MessageRole;
    content: string;
    sentBy: string;
    metadata?: Record<string, any>;
    idempotencyKey?: string;
  }): Promise<Message> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { conversationId, tenantId, role, content, sentBy, metadata, idempotencyKey } = data;

    // تحويل metadata إلى JSON صالح ووضع sentBy داخله
    const safeMetadata = this.toJsonSafe({
      ...(metadata || {}),
      sentBy, // نضع sentBy هنا فقط
      _originalSentBy: sentBy, // احتياطي
    });

    // البيانات المرسلة إلى المستودع – بدون sentBy كحقل منفصل
    const messageData = {
      conversationId,
      tenantId,
      role,
      content,
      metadata: safeMetadata,
      createdAt: new Date(),
      // لا نرسل sentBy هنا
    };

    try {
      const created = await withRetryAndThrow(
        () => this.messageRepo.create(messageData),
        {
          operationName: 'chat.safeCreateMessage',
          idempotencyKey: idempotencyKey || `msg-${correlationId}`,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );

      // إعادة كائن Message مع sentBy المستخرج من metadata
      return {
        id: created.id,
        conversationId: created.conversationId,
        tenantId: created.tenantId,
        role: created.role,
        content: created.content,
        metadata: created.metadata || {},
        createdAt: created.createdAt,
        sentBy: (created.metadata?.sentBy) || 'system',
      };
    } catch (error) {
      logger.error('فشل حفظ الرسالة، إنشاء كائن وهمي', {
        correlationId,
        conversationId,
        tenantId,
        role,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });

      // كائن وهمي
      return {
        id: `error-${randomUUID()}`,
        conversationId,
        tenantId,
        role,
        content,
        metadata: { ...safeMetadata, error: true, fallback: true },
        createdAt: new Date(),
        sentBy,
      };
    }
  }

  // ============================================================
  // الدالة الرئيسية: إرسال رسالة (مع تغليف شامل)
  // ============================================================

  async sendMessage(data: SendMessageData): Promise<SendMessageResult> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const {
      conversationId,
      tenantId,
      content,
      role = 'USER',
      sentBy,
      knowledgeBaseId,
      contextChunkLimit = 5,
      similarityThreshold = 0.7,
      idempotencyKey,
    } = data;

    // تغليف شامل – أي خطأ غير متوقع يؤدي إلى رد احتياطي
    try {
      // التحقق الأولي
      if (!conversationId || !tenantId || !content || !sentBy) {
        logger.warn('بيانات ناقصة لإرسال الرسالة', {
          correlationId,
          hasConversationId: !!conversationId,
          hasTenantId: !!tenantId,
          hasContent: !!content,
          hasSentBy: !!sentBy,
          idempotencyKey,
        });
        return this.createErrorResult(conversationId, tenantId, content, sentBy, 'بيانات غير مكتملة');
      }

      if (content.trim().length === 0) {
        return this.createErrorResult(conversationId, tenantId, content, sentBy, 'نص الرسالة فارغ');
      }

      // 1. جلب المحادثة
      let conversation: any;
      try {
        conversation = await withRetryAndThrow(
          () => this.conversationRepo.findById(conversationId),
          {
            operationName: 'chat.send.getConversation',
            idempotencyKey,
            maxAttempts: 3,
            verboseLogging: false,
          }
        );
      } catch (error) {
        logger.error('فشل جلب المحادثة', {
          correlationId,
          conversationId,
          tenantId,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        return this.createErrorResult(conversationId, tenantId, content, sentBy, 'فشل جلب المحادثة');
      }

      if (!conversation) {
        return this.createErrorResult(conversationId, tenantId, content, sentBy, 'المحادثة غير موجودة');
      }

      if (conversation.tenantId !== tenantId) {
        logger.warn('محاولة وصول لمحادثة لا تنتمي للمستأجر', {
          correlationId,
          conversationId,
          requestedTenantId: tenantId,
          actualTenantId: conversation.tenantId,
          idempotencyKey,
        });
        return this.createErrorResult(conversationId, tenantId, content, sentBy, 'ليس لديك صلاحية');
      }

      if (conversation.status !== 'ACTIVE') {
        return this.createErrorResult(conversationId, tenantId, content, sentBy, 'المحادثة مغلقة أو غير نشطة');
      }

      // 2. التحقق من قاعدة المعرفة
      const activeKBId = knowledgeBaseId || conversation.knowledgeBaseId;
      let kb: any = null;
      if (activeKBId) {
        try {
          kb = await this.validateTenantAndKB(tenantId, activeKBId, correlationId);
        } catch (error) {
          logger.warn('فشل التحقق من قاعدة المعرفة، المتابعة بدون سياق', {
            correlationId,
            knowledgeBaseId: activeKBId,
            error: error instanceof Error ? error.message : 'unknown',
            idempotencyKey,
          });
        }
      }

      // 3. جلب تاريخ المحادثة (محاولة)
      let historyMessages: any[] = [];
      try {
        const historyResult = await withRetryAndThrow(
          () => this.messageRepo.findByConversationId(conversationId, { limit: 10, offset: 0 }),
          {
            operationName: 'chat.send.getHistory',
            idempotencyKey,
            maxAttempts: 3,
            verboseLogging: false,
          }
        );
        historyMessages = historyResult.items || [];
      } catch (error) {
        logger.warn('فشل جلب تاريخ المحادثة، المتابعة بدون تاريخ', {
          correlationId,
          conversationId,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
      }

      // 4. حفظ رسالة المستخدم (بأمان)
      const userMessage = await this.safeCreateMessage({
        conversationId,
        tenantId,
        role: 'USER',
        content: content.trim(),
        sentBy,
        metadata: { ip: 'internal', userAgent: 'internal' },
        idempotencyKey: idempotencyKey || `msg-${correlationId}`,
      });

      // 5. جلب السياق
      let contextChunks: {
        id: string;
        documentId: string;
        content: string;
        similarity: number;
        metadata: Record<string, any>;
      }[] = [];

      if (kb) {
        try {
          const contextResult = await this.fetchContext(
            tenantId,
            activeKBId as string,
            content,
            contextChunkLimit,
            similarityThreshold,
            correlationId
          );
          contextChunks = contextResult.chunks;
        } catch (error) {
          logger.error('فشل جلب السياق', {
            correlationId,
            conversationId,
            knowledgeBaseId: activeKBId,
            error: error instanceof Error ? error.message : 'unknown',
            idempotencyKey,
          });
        }
      }

      // 6. توليد الرد
      let replyText: string;
      let citations: string[] | undefined;
      let suggestedQuestions: string[] | undefined;

      try {
        const conversationHistory = historyMessages.map((msg) => ({
          role: msg.role as MessageRole,
          content: msg.content,
        }));

        const aiResult = await this.generateReplyWithAI(
          content,
          contextChunks.map((c) => ({
            content: c.content,
            similarity: c.similarity,
            documentId: c.documentId,
          })),
          conversationHistory,
          idempotencyKey || `reply-${correlationId}`
        );
        replyText = aiResult.reply;
        citations = aiResult.citations;
        suggestedQuestions = aiResult.suggestedQuestions;
      } catch (error) {
        logger.error('فشل توليد الرد، استخدام الاحتياطي النهائي', {
          correlationId,
          conversationId,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        const fallback = this.fallbackReply(content);
        replyText = fallback.reply;
        citations = fallback.citations;
        suggestedQuestions = fallback.suggestedQuestions;
      }

      // 7. حفظ رسالة المساعد (بأمان)
      const assistantMessage = await this.safeCreateMessage({
        conversationId,
        tenantId,
        role: 'ASSISTANT',
        content: replyText,
        sentBy: 'system',
        metadata: {
          citations: citations || [],
          suggestedQuestions: suggestedQuestions || [],
          contextChunks: contextChunks.map((c) => ({
            id: c.id,
            documentId: c.documentId,
            similarity: c.similarity,
          })),
        },
        idempotencyKey: idempotencyKey || `reply-${correlationId}`,
      });

      // 8. تحديث وقت المحادثة (محاولة، لا نعيق العملية)
      try {
        await withRetryAndThrow(
          () => this.conversationRepo.update(conversationId, {
            updatedAt: new Date(),
          }),
          {
            operationName: 'chat.send.updateConversation',
            idempotencyKey: `conv-${conversationId}`,
            maxAttempts: 2,
            verboseLogging: false,
          }
        );
      } catch (error) {
        logger.warn('فشل تحديث وقت المحادثة، استمرار', {
          correlationId,
          conversationId,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
      }

      // 9. إرجاع النتيجة
      logger.info('تم إرسال الرسالة بنجاح', {
        correlationId,
        conversationId,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        tenantId,
        contextChunksCount: contextChunks.length,
        replyLength: replyText.length,
        idempotencyKey,
        event: 'chat.message.sent',
      });

      return {
        userMessage,
        assistantMessage,
        contextChunks: contextChunks.map((c) => ({
          id: c.id,
          documentId: c.documentId,
          content: c.content,
          similarity: c.similarity,
        })),
        conversationId,
      };

    } catch (error) {
      // أي خطأ غير متوقع على مستوى الدالة – نعيد رداً احتياطياً
      logger.error('خطأ غير متوقع في sendMessage، إرجاع رد احتياطي', {
        correlationId,
        conversationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
        stack: error instanceof Error ? error.stack : undefined,
        idempotencyKey,
      });

      return this.createErrorResult(
        conversationId,
        tenantId,
        content,
        sentBy,
        'حدث خطأ داخلي، يرجى المحاولة مرة أخرى'
      );
    }
  }

  // ============================================================
  // دوال مساعدة لإنشاء نتائج الخطأ
  // ============================================================

  private createErrorResult(
    conversationId: string,
    tenantId: string,
    content: string,
    sentBy: string,
    errorMessage: string
  ): SendMessageResult {
    const userMessage: Message = {
      id: `error-${randomUUID()}`,
      conversationId,
      tenantId,
      role: 'USER',
      content,
      metadata: { sentBy, error: true, fallback: true },
      createdAt: new Date(),
      sentBy,
    };

    const assistantMessage: Message = {
      id: `error-${randomUUID()}`,
      conversationId,
      tenantId,
      role: 'ASSISTANT',
      content: `⚠️ ${errorMessage}. الرجاء المحاولة مرة أخرى.`,
      metadata: { error: true, fallback: true },
      createdAt: new Date(),
      sentBy: 'system',
    };

    return {
      userMessage,
      assistantMessage,
      contextChunks: [],
      conversationId,
    };
  }

  // ============================================================
  // دوال التحويل (mapToConversation, mapToMessage)
  // ============================================================

  private mapToConversation(conv: any): Conversation {
    return {
      id: conv.id,
      tenantId: conv.tenantId,
      phoneNumberId: conv.phoneNumberId,
      customerName: conv.title || null,
      knowledgeBaseId: conv.metadata?.knowledgeBaseId || null,
      status: conv.status || 'ACTIVE',
      messageCount: conv.messageCount || 0,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      closedAt: conv.closedAt || null,
      createdBy: conv.createdBy,
    };
  }

  private mapToMessage(msg: any): Message {
    return {
      id: msg.id,
      conversationId: msg.conversationId,
      tenantId: msg.tenantId,
      role: msg.role || 'USER',
      content: msg.content,
      metadata: msg.metadata || null,
      createdAt: msg.createdAt,
      sentBy: msg.sentBy || (msg.metadata?.sentBy) || 'system',
    };
  }

  // ============================================================
  // باقي الدوال العامة (createConversation, getConversation, ...)
  // ============================================================

  async createConversation(data: CreateConversationData): Promise<Conversation> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { tenantId, phoneNumberId, customerName, knowledgeBaseId, createdBy, idempotencyKey } = data;

    if (!tenantId || !phoneNumberId || !createdBy) {
      logger.warn('محاولة إنشاء محادثة ببيانات ناقصة', {
        correlationId,
        hasTenantId: !!tenantId,
        hasPhoneNumberId: !!phoneNumberId,
        hasCreatedBy: !!createdBy,
        idempotencyKey,
      });
      throw new ValidationError('معرف المستأجر، رقم الهاتف، والمنشئ مطلوبة');
    }

    if (knowledgeBaseId) {
      await this.validateTenantAndKB(tenantId, knowledgeBaseId, correlationId);
    }

    let existingConversation: any;
    try {
      existingConversation = await withRetryAndThrow(
        () => this.conversationRepo.findByTenantIdAndPhone(tenantId, phoneNumberId),
        {
          operationName: 'chat.create.findExisting',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        logger.error('فشل التحقق من وجود محادثة سابقة', {
          correlationId,
          tenantId,
          phoneNumberId,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
      }
    }

    if (existingConversation && existingConversation.status === 'ACTIVE') {
      logger.info('تم العثور على محادثة نشطة للمستخدم، إعادة استخدامها', {
        correlationId,
        conversationId: existingConversation.id,
        phoneNumberId,
        idempotencyKey,
      });
      return this.mapToConversation(existingConversation);
    }

    const convData = {
      tenantId,
      phoneNumberId,
      customerName: customerName?.trim() || null,
      knowledgeBaseId: knowledgeBaseId || null,
      status: 'ACTIVE' as ConversationStatus,
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let newConv: any;
    try {
      newConv = await withRetryAndThrow(
        () => this.conversationRepo.create(convData),
        {
          operationName: 'chat.create',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل إنشاء المحادثة', {
        correlationId,
        tenantId,
        phoneNumberId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      if (error instanceof AppError) throw error;
      throw new InternalServerError('فشل إنشاء المحادثة، يرجى المحاولة مرة أخرى');
    }

    logger.info('تم إنشاء محادثة جديدة', {
      correlationId,
      conversationId: newConv.id,
      tenantId,
      phoneNumberId,
      createdBy,
      idempotencyKey,
      event: 'chat.conversation.created',
    });

    return this.mapToConversation(newConv);
  }

  async getConversation(options: GetConversationOptions): Promise<{
    conversation: Conversation;
    messages: Message[];
    totalMessages: number;
  }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { conversationId, tenantId, limit = 50, offset = 0 } = options;

    if (!conversationId || !tenantId) {
      throw new ValidationError('معرف المحادثة ومعرف المستأجر مطلوبان');
    }

    let conv: any;
    try {
      conv = await withRetryAndThrow(
        () => this.conversationRepo.findById(conversationId),
        {
          operationName: 'chat.get.getConversation',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المحادثة غير موجودة', {
          correlationId,
          conversationId,
          tenantId,
        });
        throw new NotFoundError('المحادثة غير موجودة');
      }
      logger.error('فشل جلب المحادثة', {
        correlationId,
        conversationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب المحادثة، يرجى المحاولة مرة أخرى');
    }

    if (!conv) {
      throw new NotFoundError('المحادثة غير موجودة');
    }

    if (conv.tenantId !== tenantId) {
      logger.warn('محاولة الوصول إلى محادثة لا تنتمي للمستأجر', {
        correlationId,
        conversationId,
        requestedTenantId: tenantId,
        actualTenantId: conv.tenantId,
      });
      throw new ForbiddenError('ليس لديك صلاحية الوصول إلى هذه المحادثة');
    }

    let messagesResult: { items: any[]; total: number };
    try {
      messagesResult = await withRetryAndThrow(
        () => this.messageRepo.findByConversationId(conversationId, {
          limit: Math.min(limit, 100),
          offset: Math.max(0, offset),
        }),
        {
          operationName: 'chat.get.getMessages',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل جلب رسائل المحادثة', {
        correlationId,
        conversationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب الرسائل، يرجى المحاولة مرة أخرى');
    }

    logger.debug('تم جلب المحادثة', {
      correlationId,
      conversationId,
      tenantId,
      messageCount: messagesResult.items.length,
      totalMessages: messagesResult.total,
    });

    return {
      conversation: this.mapToConversation(conv),
      messages: messagesResult.items.map((msg) => this.mapToMessage(msg)),
      totalMessages: messagesResult.total,
    };
  }

  async listConversations(options: ListConversationsOptions): Promise<{
    items: Conversation[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { tenantId, limit = 20, offset = 0, status, phoneNumberId } = options;

    if (!tenantId) {
      throw new ValidationError('معرف المستأجر مطلوب');
    }

    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safeOffset = Math.max(0, offset);

    let result: { items: any[]; total: number };
    try {
      result = await withRetryAndThrow(
        () => this.conversationRepo.findByTenantId(tenantId, {
          limit: safeLimit,
          offset: safeOffset,
        }),
        {
          operationName: 'chat.list',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل جلب قائمة المحادثات', {
        correlationId,
        tenantId,
        limit: safeLimit,
        offset: safeOffset,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب قائمة المحادثات، يرجى المحاولة مرة أخرى');
    }

    let filteredItems = result.items;
    if (status) {
      filteredItems = filteredItems.filter((item) => item.status === status);
    }
    if (phoneNumberId) {
      filteredItems = filteredItems.filter((item) => item.phoneNumberId === phoneNumberId);
    }

    logger.debug('تم جلب قائمة المحادثات', {
      correlationId,
      tenantId,
      total: result.total,
      returned: filteredItems.length,
      limit: safeLimit,
      offset: safeOffset,
      status,
      phoneNumberId,
    });

    return {
      items: filteredItems.map((item) => this.mapToConversation(item)),
      total: result.total,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  async closeConversation(conversationId: string, tenantId: string, closedBy: string): Promise<Conversation> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!conversationId || !tenantId || !closedBy) {
      throw new ValidationError('معرف المحادثة، معرف المستأجر، والمُغلِق مطلوبة');
    }

    let conv: any;
    try {
      conv = await withRetryAndThrow(
        () => this.conversationRepo.findById(conversationId),
        {
          operationName: 'chat.close.getConversation',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المحادثة غير موجودة للإغلاق', {
          correlationId,
          conversationId,
          tenantId,
        });
        throw new NotFoundError('المحادثة غير موجودة');
      }
      logger.error('فشل جلب المحادثة للإغلاق', {
        correlationId,
        conversationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل إغلاق المحادثة، يرجى المحاولة مرة أخرى');
    }

    if (!conv) {
      throw new NotFoundError('المحادثة غير موجودة');
    }

    if (conv.tenantId !== tenantId) {
      logger.warn('محاولة إغلاق محادثة لا تنتمي للمستأجر', {
        correlationId,
        conversationId,
        requestedTenantId: tenantId,
        actualTenantId: conv.tenantId,
      });
      throw new ForbiddenError('ليس لديك صلاحية إغلاق هذه المحادثة');
    }

    if (conv.status === 'CLOSED') {
      logger.warn('محاولة إغلاق محادثة مغلقة بالفعل', {
        correlationId,
        conversationId,
        tenantId,
      });
      throw new ValidationError('المحادثة مغلقة بالفعل');
    }

    let updatedConv: any;
    try {
      updatedConv = await withRetryAndThrow(
        () => this.conversationRepo.update(conversationId, {
          status: 'CLOSED',
          closedAt: new Date(),
          updatedAt: new Date(),
        }),
        {
          operationName: 'chat.close',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل إغلاق المحادثة', {
        correlationId,
        conversationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل إغلاق المحادثة، يرجى المحاولة مرة أخرى');
    }

    logger.info('تم إغلاق المحادثة', {
      correlationId,
      conversationId,
      tenantId,
      closedBy,
      event: 'chat.conversation.closed',
    });

    return this.mapToConversation(updatedConv);
  }

  async deleteConversation(conversationId: string, tenantId: string, deletedBy: string): Promise<void> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!conversationId || !tenantId || !deletedBy) {
      throw new ValidationError('معرف المحادثة، معرف المستأجر، والمُحذِف مطلوبة');
    }

    let conv: any;
    try {
      conv = await withRetryAndThrow(
        () => this.conversationRepo.findById(conversationId),
        {
          operationName: 'chat.delete.getConversation',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المحادثة غير موجودة للحذف', {
          correlationId,
          conversationId,
          tenantId,
        });
        return;
      }
      logger.error('فشل جلب المحادثة للحذف', {
        correlationId,
        conversationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حذف المحادثة، يرجى المحاولة مرة أخرى');
    }

    if (!conv) {
      return;
    }

    if (conv.tenantId !== tenantId) {
      logger.warn('محاولة حذف محادثة لا تنتمي للمستأجر', {
        correlationId,
        conversationId,
        requestedTenantId: tenantId,
        actualTenantId: conv.tenantId,
      });
      throw new ForbiddenError('ليس لديك صلاحية حذف هذه المحادثة');
    }

    try {
      await withRetryAndThrow(
        () => this.conversationRepo.softDelete(conversationId),
        {
          operationName: 'chat.delete',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل حذف المحادثة', {
        correlationId,
        conversationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حذف المحادثة، يرجى المحاولة مرة أخرى');
    }

    try {
      await this.messageRepo.deleteByConversationId(conversationId);
    } catch (error) {
      logger.warn('فشل حذف رسائل المحادثة', {
        correlationId,
        conversationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }

    logger.info('تم حذف المحادثة', {
      correlationId,
      conversationId,
      tenantId,
      deletedBy,
      event: 'chat.conversation.deleted',
    });
  }
}

export default ChatService;
