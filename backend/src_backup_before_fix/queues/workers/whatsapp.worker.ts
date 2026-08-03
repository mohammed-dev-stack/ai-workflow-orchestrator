// ============================================================
// backend/src/queues/workers/whatsapp.worker.ts
// ============================================================
// عامل إرسال رسائل WhatsApp باستخدام BullMQ.
// تم إصلاح الاستيرادات، واستخدام Worker مباشرة، وتصحيح استدعاءات التتبع.
// تم إزالة DLQ (يعتمد على إعادة المحاولة المدمجة في BullMQ).
// ============================================================

import { Worker, Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { config } from '../../config/index.js';
import { logger } from '../../observability/logger.js';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware.js';
import { setSpanAttributes } from '../../observability/tracer.js';
import {
  ValidationError,
  NotFoundError,
  InternalServerError,
  AppError,
} from '../../middlewares/errorHandler.middleware.js';
import { WhatsAppService } from '../../services/whatsapp.service.js';
import { ChatService } from '../../services/chat.service.js';
import { EmbeddingService } from '../../services/embedding.service.js';
import { repositories } from '../../db/index.js';
import { Anthropic } from '@anthropic-ai/sdk';

// ============================================================
// أنواع بيانات المهمة
// ============================================================

export interface WhatsAppJobData {
  tenantId: string;
  to: string;
  text: string;
  replyToMessageId?: string;
  conversationId?: string;
  knowledgeBaseId?: string;
  idempotencyKey?: string;
  correlationId?: string;
}

export interface WhatsAppJobResult {
  messageId: string;
  status: 'sent' | 'failed';
  timestamp: string;
  conversationId: string;
  internalMessageId: string;
  processingTimeMs: number;
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
// تهيئة الخدمات
// ============================================================

function createWhatsAppService(): WhatsAppService {
  const conversationRepo = {
    findById: (id: string) => repositories.conversation.findById(id),
    findByTenantIdAndPhone: (tenantId: string, phoneNumberId: string) =>
      repositories.conversation.findByTenantIdAndPhone(tenantId, phoneNumberId),
    findByTenantId: (tenantId: string, options?: { limit?: number; offset?: number }) =>
      repositories.conversation.findByTenantId(tenantId, options),
    create: (data: any) => repositories.conversation.create(data),
    update: (id: string, data: any) => repositories.conversation.update(id, data),
    softDelete: (id: string) => repositories.conversation.softDelete(id),
    countByTenantIdAndDateRange: (tenantId: string, startDate: Date, endDate: Date, status?: string) =>
      repositories.conversation.countByTenantIdAndDateRange(tenantId, startDate, endDate, status),
    countByDateRangeGrouped: (tenantId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month') =>
      repositories.conversation.countByDateRangeGrouped(tenantId, startDate, endDate, groupBy),
  };

  const messageRepo = {
    findById: (id: string) => repositories.message.findById(id),
    findByConversationId: (conversationId: string, options?: { limit?: number; offset?: number }) =>
      repositories.message.findByConversationId(conversationId, options),
    create: (data: any) => repositories.message.create(data),
    update: (id: string, data: any) => repositories.message.update(id, data),
    deleteByConversationId: (conversationId: string) =>
      repositories.message.deleteByConversationId(conversationId),
    findByExternalId: (externalId: string) =>
      repositories.message.findByExternalId(externalId),
    countByTenantIdAndDateRange: (tenantId: string, startDate: Date, endDate: Date, role?: string) =>
      repositories.message.countByTenantIdAndDateRange(tenantId, startDate, endDate, role),
    countByDateRangeGrouped: (tenantId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month') =>
      repositories.message.countByDateRangeGrouped(tenantId, startDate, endDate, groupBy),
    countByRoleAndDateRange: (tenantId: string, startDate: Date, endDate: Date) =>
      repositories.message.countByRoleAndDateRange(tenantId, startDate, endDate),
  };

  const tenantRepo = {
    findById: (id: string) => repositories.tenant.findById(id),
    findByPhoneNumberId: (phoneNumberId: string) =>
      repositories.tenant.findByPhoneNumberId(phoneNumberId),
  };

  const anthropicClient = new Anthropic({
    apiKey: config.anthropic.apiKey,
  });

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

  const docRepoForEmbedding = {
    findById: (id: string) => repositories.document.findById(id),
    updateStatus: (id: string, status: string, errorMessage?: string) =>
      repositories.document.updateStatus(id, status, errorMessage),
  };

  const embeddingService = new EmbeddingService(
    chunkRepo as any,
    docRepoForEmbedding as any,
    anthropicClient
  );

  const kbRepo = {
    findById: (id: string) => repositories.knowledgeBase.findById(id),
    findByTenantId: (tenantId: string, options?: { limit?: number; offset?: number; search?: string }) =>
      repositories.knowledgeBase.findByTenantId(tenantId, options),
  };

  const chatService = new ChatService(
    conversationRepo as any,
    messageRepo as any,
    kbRepo as any,
    embeddingService as any,
    anthropicClient
  );

  const whatsappService = new WhatsAppService(
    conversationRepo as any,
    messageRepo as any,
    chatService as any,
    tenantRepo as any
  );

  return whatsappService;
}

const whatsappService = createWhatsAppService();

// ============================================================
// معالج المهمة
// ============================================================

async function processWhatsAppJob(job: Job<WhatsAppJobData>): Promise<WhatsAppJobResult> {
  const startTime = Date.now();
  const data = job.data;
  const correlationId = data.correlationId || getCurrentCorrelationId() || randomUUID();

  logger.info('بدء إرسال رسالة WhatsApp في العامل', {
    correlationId,
    tenantId: data.tenantId,
    to: data.to,
    conversationId: data.conversationId || null,
    textLength: data.text?.length || 0,
    jobId: job.id,
    idempotencyKey: data.idempotencyKey || null,
  });

  setSpanAttributes({
    'whatsapp.to': data.to,
    'whatsapp.tenant_id': data.tenantId,
    'whatsapp.conversation_id': data.conversationId || 'none',
    'whatsapp.text_length': data.text?.length || 0,
    'queue.job_id': job.id || 'unknown',
    'queue.attempt': job.attemptsMade + 1,
  });

  try {
    if (!data.tenantId || !data.to || !data.text) {
      throw new ValidationError('بيانات ناقصة: tenantId, to, text مطلوبة');
    }

    if (data.text.trim().length === 0) {
      throw new ValidationError('نص الرسالة لا يمكن أن يكون فارغاً');
    }

    const sanitizedText = data.text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (sanitizedText.length === 0) {
      throw new ValidationError('نص الرسالة لا يمكن أن يكون فارغاً بعد التنقية');
    }

    const result = await whatsappService.sendMessage({
      tenantId: data.tenantId,
      to: data.to,
      text: sanitizedText,
      replyToMessageId: data.replyToMessageId,
      conversationId: data.conversationId,
      knowledgeBaseId: data.knowledgeBaseId,
      idempotencyKey: data.idempotencyKey || `whatsapp-${correlationId}`,
    });

    const processingTimeMs = Date.now() - startTime;

    logger.info('اكتمل إرسال رسالة WhatsApp في العامل', {
      correlationId,
      tenantId: data.tenantId,
      to: data.to,
      messageId: result.messageId,
      conversationId: result.conversationId,
      status: result.status,
      processingTimeMs,
      jobId: job.id,
    });

    setSpanAttributes({
      'whatsapp.message_id': result.messageId,
      'whatsapp.status': result.status,
      'whatsapp.processing_time_ms': processingTimeMs,
    });

    return {
      messageId: result.messageId,
      status: result.status === 'sent' ? 'sent' : 'failed',
      timestamp: result.timestamp,
      conversationId: result.conversationId,
      internalMessageId: result.internalMessageId,
      processingTimeMs,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'فشل غير معروف';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    logger.error('فشل إرسال رسالة WhatsApp في العامل', {
      correlationId,
      tenantId: data.tenantId,
      to: data.to,
      conversationId: data.conversationId || null,
      error: errorMessage,
      errorName,
      processingTimeMs,
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts || 3,
    });

    setSpanAttributes({
      'whatsapp.error': errorMessage,
      'whatsapp.error_name': errorName,
      'whatsapp.processing_time_ms': processingTimeMs,
      'whatsapp.status': 'failed',
    });

    // إعادة رمي الخطأ (سيقوم BullMQ بإعادة المحاولة تلقائياً حتى maxAttempts)
    throw error;
  }
}

// ============================================================
// إنشاء العامل وتصديره
// ============================================================

export const whatsappWorker = new Worker<WhatsAppJobData>(
  'whatsapp-send',
  processWhatsAppJob,
  {
    connection,
    concurrency: 5,
    lockDuration: 30000,
    stalledInterval: 30000,
    maxStalledCount: 1,
  }
);

whatsappWorker.on('completed', (job) => {
  logger.debug('اكتملت مهمة إرسال WhatsApp', {
    jobId: job.id,
    tenantId: job.data.tenantId,
    to: job.data.to,
  });
});

whatsappWorker.on('failed', (job, err) => {
  logger.error('فشلت مهمة إرسال WhatsApp', {
    jobId: job?.id,
    tenantId: job?.data.tenantId,
    to: job?.data.to,
    error: err.message,
  });
});

export default whatsappWorker;
export { processWhatsAppJob };
