// ============================================================
// backend/src/queues/workers/document.worker.ts
// ============================================================
// عامل معالجة المستندات (Document Worker) باستخدام BullMQ.
// تم إصلاح الاستيرادات، واستخدام Worker مباشرة، وتصحيح استدعاءات التتبع.
// ============================================================

import { Worker, Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { config } from '../../config/index.js';
import { logger } from '../../observability/logger.js';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware.js';
import { setSpanAttributes, withSpan } from '../../observability/tracer.js';
import {
  ValidationError,
  NotFoundError,
  InternalServerError,
  AIServiceError,
} from '../../middlewares/errorHandler.middleware.js';
import { EmbeddingService } from '../../services/embedding.service.js';
import { repositories } from '../../db/index.js';
import { Anthropic } from '@anthropic-ai/sdk';

// ============================================================
// أنواع بيانات المهمة
// ============================================================

export interface DocumentJobData {
  documentId: string;
  tenantId: string;
  knowledgeBaseId: string;
  text: string;
  uploadedBy: string;
  idempotencyKey?: string;
  correlationId?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface DocumentJobResult {
  documentId: string;
  chunkCount: number;
  vectorCount: number;
  processingTimeMs: number;
  status: 'completed' | 'failed';
  error?: string;
}

// ============================================================
// اتصال Redis
// ============================================================

const connection = {
  host: new URL(config.redis.url).hostname || 'localhost',
  port: parseInt(new URL(config.redis.url).port || '6379', 10),
  password: new URL(config.redis.url).password || undefined,
  db: parseInt(new URL(config.redis.url).pathname?.replace('/', '') || '0', 10),
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
};

// ============================================================
// تهيئة خدمة التضمين
// ============================================================

function createEmbeddingService(): EmbeddingService {
  const chunkRepo = {
    create: (data: any) => repositories.documentChunk.create(data),
    bulkCreate: (data: any[]) => repositories.documentChunk.bulkCreate(data),
    findByDocumentId: (documentId: string) =>
      repositories.documentChunk.findByDocumentId(documentId),
    deleteByDocumentId: (documentId: string) =>
      repositories.documentChunk.deleteByDocumentId(documentId),
    countByDocumentId: (documentId: string) =>
      repositories.documentChunk.countByDocumentId(documentId),
    findSimilarVectors: (vector: number[], limit: number, knowledgeBaseId: string, threshold?: number) =>
      repositories.documentChunk.findSimilarVectors(vector, limit, knowledgeBaseId, threshold),
  };

  const docRepo = {
    findById: (id: string) => repositories.document.findById(id),
    updateStatus: (id: string, status: string, errorMessage?: string) =>
      repositories.document.updateStatus(id, status, errorMessage),
  };

  const anthropicClient = new Anthropic({
    apiKey: config.anthropic.apiKey,
  });

  return new EmbeddingService(chunkRepo as any, docRepo as any, anthropicClient);
}

const embeddingService = createEmbeddingService();

// ============================================================
// معالج المهمة
// ============================================================

async function processDocumentJob(job: Job<DocumentJobData>): Promise<DocumentJobResult> {
  const startTime = Date.now();
  const data = job.data;
  const correlationId = data.correlationId || getCurrentCorrelationId() || randomUUID();

  logger.info('بدء معالجة مستند في العامل', {
    correlationId,
    documentId: data.documentId,
    tenantId: data.tenantId,
    knowledgeBaseId: data.knowledgeBaseId,
    textLength: data.text?.length || 0,
    jobId: job.id,
    idempotencyKey: data.idempotencyKey,
  });

  setSpanAttributes({
    'document.id': data.documentId,
    'document.tenant_id': data.tenantId,
    'document.knowledge_base_id': data.knowledgeBaseId,
    'document.text_length': data.text?.length || 0,
    'queue.job_id': job.id || 'unknown',
    'queue.attempt': job.attemptsMade + 1,
  });

  try {
    const doc = await repositories.document.findById(data.documentId);
    if (!doc) {
      throw new NotFoundError(`المستند ${data.documentId} غير موجود`);
    }

    if (doc.tenantId !== data.tenantId) {
      throw new ValidationError('المستند لا ينتمي إلى هذا المستأجر');
    }

    if (doc.deletedAt) {
      throw new ValidationError('المستند محذوف ولا يمكن معالجته');
    }

    if (doc.status === 'COMPLETED') {
      logger.info('المستند مكتمل بالفعل، تخطي المعالجة', {
        correlationId,
        documentId: data.documentId,
      });
      // ✅ chunkCount و vectorCount غير موجودين في نموذج Document، نستخدم 0
      return {
        documentId: data.documentId,
        chunkCount: 0,
        vectorCount: 0,
        processingTimeMs: Date.now() - startTime,
        status: 'completed',
      };
    }

    await repositories.document.updateStatus(data.documentId, 'PROCESSING');

    const sanitizedText = data.text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitizedText || sanitizedText.length < 3) {
      throw new ValidationError('نص المستند قصير جداً للمعالجة (يجب أن يكون 3 أحرف على الأقل)');
    }

    // ✅ withSpan تأخذ 3 معاملات: name, fn, attributes (كائن)
    const result = await withSpan(
      'document.embedding.generate',
      async (span) => {
        span.setAttribute('document.id', data.documentId);
        span.setAttribute('document.text_length', sanitizedText.length);
        span.setAttribute('document.chunk_size', data.chunkSize || 1000);

        return await embeddingService.generateDocumentEmbeddings({
          documentId: data.documentId,
          tenantId: data.tenantId,
          knowledgeBaseId: data.knowledgeBaseId,
          text: sanitizedText,
          chunkSize: data.chunkSize || 1000,
          chunkOverlap: data.chunkOverlap || 200,
          idempotencyKey: data.idempotencyKey || `embed-${data.documentId}`,
        });
      },
      {
        'document.id': data.documentId,
        'document.tenant_id': data.tenantId,
      }
    );

    const processingTimeMs = Date.now() - startTime;

    logger.info('اكتملت معالجة المستند في العامل', {
      correlationId,
      documentId: data.documentId,
      chunkCount: result.chunkCount,
      vectorCount: result.vectorCount,
      processingTimeMs,
      jobId: job.id,
    });

    setSpanAttributes({
      'document.chunk_count': result.chunkCount,
      'document.vector_count': result.vectorCount,
      'document.processing_time_ms': processingTimeMs,
      'document.status': 'completed',
    });

    return {
      documentId: data.documentId,
      chunkCount: result.chunkCount,
      vectorCount: result.vectorCount,
      processingTimeMs,
      status: 'completed',
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'فشل غير معروف';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    try {
      await repositories.document.updateStatus(data.documentId, 'FAILED', errorMessage);
    } catch (statusError) {
      logger.error('فشل تحديث حالة المستند إلى FAILED', {
        correlationId,
        documentId: data.documentId,
        error: statusError instanceof Error ? statusError.message : 'unknown',
      });
    }

    logger.error('فشلت معالجة المستند في العامل', {
      correlationId,
      documentId: data.documentId,
      error: errorMessage,
      errorName,
      processingTimeMs,
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts || 3,
    });

    setSpanAttributes({
      'document.error': errorMessage,
      'document.error_name': errorName,
      'document.processing_time_ms': processingTimeMs,
      'document.status': 'failed',
    });

    throw error;
  }
}

// ============================================================
// إنشاء العامل وتصديره
// ============================================================

/**
 * عامل معالجة المستندات.
 * تم إنشاؤه مباشرة باستخدام Worker من bullmq.
 */
export const documentWorker = new Worker<DocumentJobData>(
  'document-processing',
  processDocumentJob,
  {
    connection,
    concurrency: 1, // معالجة مستند واحد في كل مرة لتجنب التحميل الزائد
    lockDuration: 600000, // 10 دقائق
    stalledInterval: 30000,
    maxStalledCount: 3,
  }
);

documentWorker.on('completed', (job) => {
  logger.debug('اكتملت مهمة معالجة مستند', {
    jobId: job.id,
    documentId: job.data.documentId,
    tenantId: job.data.tenantId,
  });
});

documentWorker.on('failed', (job, err) => {
  logger.error('فشلت مهمة معالجة مستند', {
    jobId: job?.id,
    documentId: job?.data.documentId,
    error: err.message,
  });
});

export default documentWorker;
export { processDocumentJob };
