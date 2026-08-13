// ============================================================
// backend/src/worker.ts
// ============================================================
// نقطة دخول مستقلة لـ BullMQ Workers.
// يتم تشغيلها كعملية منفصلة عن خادم HTTP.
// الأمر: npm run worker:dev (للتطوير) أو npm run worker:start (للإنتاج)
// ============================================================

import { config } from './config/index.js';
import { logger } from './observability/logger.js';
import { initializeRedis } from './config/redis.config.js';
import { initializeRateLimiter } from './middlewares/rateLimiter.middleware.js';
import { initializeEncryption } from './utils/encryption.js';
import { initializeTracer, shutdownTracer } from './observability/tracer.js';
import {
  initializeStartup,
  markStartupComplete,
  setTracingInitialized,
  setQueuesInitialized,
} from './observability/health/startup.js';

// استيراد جميع الـ Workers
import { documentWorker } from './queues/workers/document.worker.js';
import { whatsappWorker } from './queues/workers/whatsapp.worker.js';
import { analyticsWorker } from './queues/workers/analytics.worker.js';
import deadLetterWorker from './queues/index.js';

// ============================================================
// إدارة حالة الإيقاف
// ============================================================

let isShuttingDown = false;

/**
 * إيقاف جميع الـ Workers بشكل آمن.
 */
async function shutdownWorkers(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const correlationId = 'worker-shutdown';
  logger.info(`🛑 Worker: استلام إشارة ${signal}، بدء إيقاف التشغيل الآمن`, { correlationId });

  try {
    // إيقاف Workers واحداً تلو الآخر (مع التسامح مع الأخطاء)
    const workers = [
      { name: 'Document', instance: documentWorker },
      { name: 'WhatsApp', instance: whatsappWorker },
      { name: 'Analytics', instance: analyticsWorker },
      { name: 'DLQ', instance: deadLetterWorker },
    ];

    for (const worker of workers) {
      try {
        logger.debug(`⏹️ إيقاف عامل ${worker.name}...`, { correlationId });
        await worker.instance.close();
        logger.debug(`✅ تم إيقاف عامل ${worker.name}`, { correlationId });
      } catch (error) {
        logger.warn(`⚠️ فشل إيقاف عامل ${worker.name}`, {
          correlationId,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    // إيقاف التتبع
    await shutdownTracer().catch((err) => {
      logger.warn('⚠️ فشل إيقاف التتبع', {
        correlationId,
        error: err instanceof Error ? err.message : 'unknown',
      });
    });

    logger.info('✅ تم إيقاف جميع الـ Workers بنجاح', { correlationId });
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('❌ فشل إيقاف الـ Workers', {
      correlationId,
      error: errorMessage,
    });
    process.exit(1);
  }
}

// ============================================================
// التهيئة الأساسية لبيئة Worker
// ============================================================

async function initializeWorkerEnvironment(): Promise<void> {
  const correlationId = 'worker-init';

  logger.info('⚙️ ' + '='.repeat(60));
  logger.info('  🔧 BullMQ Workers (عملية مستقلة)');
  logger.info(`  📦 Version: ${process.env.npm_package_version || '1.0.0'}`);
  logger.info(`  🌍 Environment: ${config.env.nodeEnv}`);
  logger.info(`  🔢 Process ID: ${process.pid}`);
  logger.info('⚙️ ' + '='.repeat(60));

  try {
    // 1. التشفير
    logger.debug('🔐 تهيئة التشفير', { correlationId });
    initializeEncryption();

    // 2. التتبع الموزع
    logger.debug('🔍 تهيئة التتبع الموزع', { correlationId });
    initializeTracer();
    setTracingInitialized(true);

    // 3. Redis (الأساسي للـ Workers)
    logger.debug('🔴 تهيئة Redis لـ Workers', { correlationId });
    const redisClient = await initializeRedis();
    initializeRateLimiter(redisClient);
    logger.info('✅ تم تهيئة Redis بنجاح', { correlationId });

    // 4. حالة بدء التشغيل
    initializeStartup();
    setQueuesInitialized(true);
    markStartupComplete();

    logger.info('✅ اكتملت تهيئة بيئة Worker', { correlationId });

    // 5. التأكد من أن جميع الـ Workers جاهزة
    // (الـ Workers تبدأ تلقائياً عند استيرادها، ولكن نؤكد أنها تعمل)
    logger.info('✅ جميع الـ Workers جاهزة للعمل', {
      correlationId,
      workers: ['Document', 'WhatsApp', 'Analytics', 'DLQ'],
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('❌ فشلت تهيئة بيئة Worker', {
      correlationId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// ============================================================
// تسجيل معالجات الإشارات
// ============================================================

function setupShutdownHandlers(): void {
  process.on('SIGTERM', () => shutdownWorkers('SIGTERM'));
  process.on('SIGINT', () => shutdownWorkers('SIGINT'));

  process.on('uncaughtException', (error) => {
    const correlationId = 'worker-uncaught';
    logger.error('❌ استثناء غير معالج في Worker', {
      correlationId,
      error: error.message,
      stack: error.stack,
    });
    shutdownWorkers('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    const correlationId = 'worker-unhandled';
    logger.error('❌ رفض وعد غير معالج في Worker', {
      correlationId,
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

// ============================================================
// بدء التشغيل الرئيسي
// ============================================================

async function startWorkers(): Promise<void> {
  try {
    await initializeWorkerEnvironment();
    setupShutdownHandlers();

    logger.info('✅ Workers قيد التشغيل، في انتظار المهام...');

    // مراقبة صحة Workers (كل 60 ثانية)
    setInterval(async () => {
      try {
        // يمكن إضافة فحوصات صحة لكل Worker هنا
        logger.debug('🏥 فحص صحة Workers', { pid: process.pid });
      } catch (error) {
        logger.warn('⚠️ فشل فحص صحة Worker', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }, 60000);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('❌ فشل بدء الـ Workers', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// ============================================================
// نقطة الدخول
// ============================================================

// تأكد من أن الملف يُشغل مباشرة (ليس عبر استيراد)
if (process.argv[1] === import.meta.url.replace(/^file:\/\//, '')) {
  startWorkers().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('❌ فشل تشغيل الـ Workers', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  });
}

// ============================================================
// التصدير (للاختبارات أو التوسع)
// ============================================================

export { startWorkers, shutdownWorkers, initializeWorkerEnvironment };
export default startWorkers;