// ============================================================
// backend/src/queues/workers/analytics.worker.ts
// ============================================================
// عامل تحديث التحليلات (Analytics Worker) باستخدام BullMQ.
// تم إصلاح استيراد recordMetric (بدلاً من logMetric) من metrics.ts
// لأن الدالة المسماة الصحيحة هي recordMetric.
// ============================================================

import { Worker, Job } from 'bullmq';
import { randomUUID } from 'crypto';
import { config } from '../../config/index.js';
import { logger } from '../../observability/logger.js';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware.js';
import { setSpanAttributes, withSpan } from '../../observability/tracer.js';
// ✅ استيراد الدالة الصحيحة recordMetric من metrics.ts
import { recordMetric } from '../../observability/metrics.js';
import { repositories } from '../../db/index.js';
import { AnalyticsService } from '../../services/analytics.service.js';
import {
  ValidationError,
  NotFoundError,
  InternalServerError,
  AppError,
} from '../../middlewares/errorHandler.middleware.js';

// ============================================================
// أنواع بيانات المهمة
// ============================================================

export interface AnalyticsJobData {
  tenantId: string;
  eventType: 'conversation.created' | 'message.sent' | 'document.uploaded' | 'ai.request' | 'ai.response' | 'search.performed';
  payload: Record<string, any>;
  timestamp?: Date;
  idempotencyKey?: string;
  correlationId?: string;
}

export interface AnalyticsJobResult {
  tenantId: string;
  eventType: string;
  processed: boolean;
  processingTimeMs: number;
  metricsUpdated: number;
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
// تهيئة خدمة التحليلات
// ============================================================

function createAnalyticsService(): AnalyticsService {
  const conversationRepo = {
    countByTenantIdAndDateRange: (tenantId: string, startDate: Date, endDate: Date, status?: string) =>
      repositories.conversation.countByTenantIdAndDateRange(tenantId, startDate, endDate, status),
    countByDateRangeGrouped: (tenantId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month') =>
      repositories.conversation.countByDateRangeGrouped(tenantId, startDate, endDate, groupBy),
    findById: (id: string) => repositories.conversation.findById(id),
  };

  const messageRepo = {
    countByTenantIdAndDateRange: (tenantId: string, startDate: Date, endDate: Date, role?: string) =>
      repositories.message.countByTenantIdAndDateRange(tenantId, startDate, endDate, role),
    countByDateRangeGrouped: (tenantId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month') =>
      repositories.message.countByDateRangeGrouped(tenantId, startDate, endDate, groupBy),
    countByRoleAndDateRange: (tenantId: string, startDate: Date, endDate: Date) =>
      repositories.message.countByRoleAndDateRange(tenantId, startDate, endDate),
  };

  const documentRepo = {
    countByStatusAndDateRange: (tenantId: string, startDate: Date, endDate: Date) =>
      repositories.document.countByStatusAndDateRange(tenantId, startDate, endDate),
    getTotalStorageSize: (tenantId: string) =>
      repositories.document.getTotalStorageSize(tenantId),
  };

  const tenantRepo = {
    findById: (id: string) => repositories.tenant.findById(id),
  };

  return new AnalyticsService(
    conversationRepo as any,
    messageRepo as any,
    documentRepo as any,
    tenantRepo as any
  );
}

const analyticsService = createAnalyticsService();

// ============================================================
// معالج المهمة
// ============================================================

async function processAnalyticsJob(job: Job<AnalyticsJobData>): Promise<AnalyticsJobResult> {
  const startTime = Date.now();
  const data = job.data;
  const correlationId = data.correlationId || getCurrentCorrelationId() || randomUUID();

  logger.info('بدء معالجة مهمة تحليلات في العامل', {
    correlationId,
    tenantId: data.tenantId,
    eventType: data.eventType,
    jobId: job.id,
    idempotencyKey: data.idempotencyKey,
    payloadKeys: Object.keys(data.payload || {}),
  });

  setSpanAttributes({
    'analytics.tenant_id': data.tenantId,
    'analytics.event_type': data.eventType,
    'queue.job_id': job.id || 'unknown',
    'queue.attempt': job.attemptsMade + 1,
  });

  try {
    if (!data.tenantId || !data.eventType) {
      throw new ValidationError('بيانات ناقصة: tenantId و eventType مطلوبة');
    }

    const allowedEventTypes = [
      'conversation.created',
      'message.sent',
      'document.uploaded',
      'ai.request',
      'ai.response',
      'search.performed',
    ];
    if (!allowedEventTypes.includes(data.eventType)) {
      throw new ValidationError(`نوع الحدث غير معروف: ${data.eventType}`);
    }

    let metricsUpdated = 0;

    await withSpan(
      `analytics.process.${data.eventType.replace('.', '_')}`,
      async (span) => {
        span.setAttribute('analytics.event_type', data.eventType);
        span.setAttribute('analytics.tenant_id', data.tenantId);

        switch (data.eventType) {
          case 'conversation.created':
            await recordMetric('conversation.created', 'counter', 1, {
              tenantId: data.tenantId,
              source: data.payload?.source || 'unknown',
            });
            metricsUpdated++;
            break;

          case 'message.sent':
            await recordMetric('message.sent', 'counter', 1, {
              tenantId: data.tenantId,
              role: data.payload?.role || 'unknown',
              conversationId: data.payload?.conversationId || 'unknown',
            });
            metricsUpdated++;
            break;

          case 'document.uploaded':
            await recordMetric('document.uploaded', 'counter', 1, {
              tenantId: data.tenantId,
              knowledgeBaseId: data.payload?.knowledgeBaseId || 'unknown',
              fileSize: data.payload?.fileSize || 0,
            });
            metricsUpdated++;
            break;

          case 'ai.request':
            await recordMetric('ai.request', 'counter', 1, {
              tenantId: data.tenantId,
              model: data.payload?.model || 'unknown',
              conversationId: data.payload?.conversationId || 'unknown',
            });
            metricsUpdated++;
            if (data.payload?.tokens) {
              await recordMetric('ai.tokens', 'counter', data.payload.tokens, {
                tenantId: data.tenantId,
                type: 'request',
              });
              metricsUpdated++;
            }
            break;

          case 'ai.response':
            await recordMetric('ai.response', 'counter', 1, {
              tenantId: data.tenantId,
              model: data.payload?.model || 'unknown',
success: data.payload?.success === false ? 'false' : 'true',
              durationMs: data.payload?.durationMs || 0,
            });
            metricsUpdated++;
            if (data.payload?.tokens) {
              await recordMetric('ai.tokens', 'counter', data.payload.tokens, {
                tenantId: data.tenantId,
                type: 'response',
              });
              metricsUpdated++;
            }
            break;

          case 'search.performed':
            await recordMetric('search.performed', 'counter', 1, {
              tenantId: data.tenantId,
              knowledgeBaseId: data.payload?.knowledgeBaseId || 'unknown',
              resultsCount: data.payload?.resultsCount || 0,
              threshold: data.payload?.threshold || 0.7,
            });
            metricsUpdated++;
            break;

          default:
            break;
        }
      },
      {
        'analytics.tenant_id': data.tenantId,
        'analytics.event_type': data.eventType,
      }
    );

    const processingTimeMs = Date.now() - startTime;

    logger.info('اكتملت معالجة مهمة التحليلات في العامل', {
      correlationId,
      tenantId: data.tenantId,
      eventType: data.eventType,
      metricsUpdated,
      processingTimeMs,
      jobId: job.id,
    });

    setSpanAttributes({
      'analytics.metrics_updated': metricsUpdated,
      'analytics.processing_time_ms': processingTimeMs,
      'analytics.status': 'completed',
    });

    return {
      tenantId: data.tenantId,
      eventType: data.eventType,
      processed: true,
      processingTimeMs,
      metricsUpdated,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'فشل غير معروف';
    const errorName = error instanceof Error ? error.name : 'UnknownError';

    logger.error('فشلت معالجة مهمة التحليلات في العامل', {
      correlationId,
      tenantId: data.tenantId,
      eventType: data.eventType,
      error: errorMessage,
      errorName,
      processingTimeMs,
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts || 3,
    });

    setSpanAttributes({
      'analytics.error': errorMessage,
      'analytics.error_name': errorName,
      'analytics.processing_time_ms': processingTimeMs,
      'analytics.status': 'failed',
    });

    throw error;
  }
}

// ============================================================
// إنشاء العامل وتصديره
// ============================================================

export const analyticsWorker = new Worker<AnalyticsJobData>(
  'analytics-update',
  processAnalyticsJob,
  {
    connection,
    concurrency: 5,
    lockDuration: 30000,
    stalledInterval: 30000,
    maxStalledCount: 1,
  }
);

analyticsWorker.on('completed', (job) => {
  logger.debug('اكتملت مهمة تحليلات', { jobId: job.id, tenantId: job.data.tenantId });
});

analyticsWorker.on('failed', (job, err) => {
  logger.error('فشلت مهمة تحليلات', { jobId: job?.id, error: err.message });
});

export default analyticsWorker;
export { processAnalyticsJob };
