// ============================================================
// backend/src/queues/index.ts
// ============================================================
// إعدادات قوائم انتظار BullMQ (الإصدار 5.x)
// ============================================================

import { Queue, Worker, QueueEvents } from 'bullmq';
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';

// ============================================================
// اتصال Redis المستخدم من قبل BullMQ
// ============================================================
const connection = {
  host: new URL(config.redis.url).hostname || 'localhost',
  port: parseInt(new URL(config.redis.url).port || '6379', 10),
  password: new URL(config.redis.url).password || undefined,
  db: parseInt(new URL(config.redis.url).pathname?.replace('/', '') || '0', 10),
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
};

// ============================================================
// 1. تعريف قائمة انتظار معالجة المستندات
// ============================================================

export const documentQueue = new Queue('documentProcessing', {
  connection,
  defaultJobOptions: {
    attempts: config.queues?.retryAttempts ?? 3,
    backoff: {
      type: 'exponential',
      delay: config.queues?.retryBackoffMs ?? 1000,
    },
    removeOnComplete: {
      age: config.queues?.jobHistoryTtlSeconds ?? 86400,
    },
    removeOnFail: {
      age: config.queues?.jobHistoryTtlSeconds ?? 86400,
    },
  },
});

// ============================================================
// 2. عامل (Worker) لمعالجة المهام
// ============================================================

export const documentWorker = new Worker(
  'documentProcessing',
  async (job) => {
    const { tenantId, documentId, fileName, fileContent } = job.data;
    logger.info('بدء معالجة مستند', { jobId: job.id, documentId });

    try {
      const { processDocument } = await import('../orchestrators/documentProcessing.orchestrator.js');
      await processDocument(tenantId, documentId, fileName, fileContent);
      logger.info('تمت معالجة المستند بنجاح', { jobId: job.id, documentId });
    } catch (error) {
      logger.error('فشل معالجة المستند', { jobId: job.id, documentId, error });
      throw error;
    }
  },
  {
    connection,
    concurrency: 5,
    lockDuration: 30000,
    stalledInterval: 30000,
    maxStalledCount: 1,
  }
);

// ============================================================
// 3. أحداث قائمة الانتظار (للمراقبة)
// ============================================================

export const documentQueueEvents = new QueueEvents('documentProcessing', {
  connection,
});

documentQueueEvents.on('completed', ({ jobId }) => {
  logger.info(`✅ المهمة ${jobId} اكتملت بنجاح`);
});

documentQueueEvents.on('failed', ({ jobId, failedReason }) => {
  logger.error(`❌ المهمة ${jobId} فشلت: ${failedReason}`);
});

// ============================================================
// 4. دوال مساعدة لإضافة مهام
// ============================================================

export async function enqueueDocumentProcessing(
  tenantId: string,
  documentId: string,
  fileName: string,
  fileContent: string
) {
  const jobId = `doc-${randomUUID()}`;
  const job = await documentQueue.add(
    'processDocument',
    { tenantId, documentId, fileName, fileContent },
    { jobId }
  );
  logger.info('تمت إضافة مهمة معالجة مستند إلى قائمة الانتظار', { jobId: job.id, documentId });
  return job;
}

// ============================================================
// 5. إيقاف العامل والقوائم عند الخروج
// ============================================================

export async function shutdownQueues() {
  await Promise.allSettled([
    documentWorker.close(),
    documentQueue.close(),
    documentQueueEvents.close(),
  ]);
  logger.info('تم إغلاق قوائم الانتظار');
}

// ============================================================
// 6. الكائن الافتراضي مع واجهة موحّدة .close()
// ============================================================

export default {
  documentQueue,
  documentWorker,
  documentQueueEvents,
  enqueueDocumentProcessing,
  shutdownQueues,
  async close() {
    return this.shutdownQueues();
  },
};

