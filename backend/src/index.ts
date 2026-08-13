// ============================================================
// backend/src/index.ts
// ============================================================
// نقطة الدخول الرئيسية لخادم HTTP + WebSocket.
// ✅ تم إزالة جميع استدعاءات Workers (تم نقلها إلى worker.ts).
// ✅ تم الحفاظ على التهيئة الأساسية (التشفير، التتبع، Redis، Rate Limiter).
// ============================================================

import { config } from './config/index.js';
import { logger } from './observability/logger.js';
import { getCurrentCorrelationId } from './middlewares/correlation.middleware.js';
import { initializeTracer, shutdownTracer } from './observability/tracer.js';
import { initializeEncryption } from './utils/encryption.js';
import {
  initializeStartup,
  markStartupComplete,
  setTracingInitialized,
  setQueuesInitialized,
} from './observability/health/startup.js';
import { server } from './server.js';
import { fileURLToPath } from 'url';
import { initializeRedis } from './config/redis.config.js';
import { initializeRateLimiter } from './middlewares/rateLimiter.middleware.js';

// ============================================================
// متغير لتخزين كائن الخادم (للإيقاف الآمن)
// ============================================================

let httpServer: ReturnType<typeof server.listen> | null = null;

// ============================================================
// معالجة الإشارات والإيقاف الآمن
// ============================================================

function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    const correlationId = getCurrentCorrelationId() || 'shutdown';
    logger.info(`🛑 استلام إشارة ${signal}، بدء إيقاف التشغيل الآمن`, { correlationId });

    try {
      // إيقاف خادم HTTP
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer!.close(() => {
            logger.debug('✅ تم إيقاف خادم HTTP', { correlationId });
            resolve();
          });
        });
      }

      // إيقاف التتبع الموزع (Tracing)
      await shutdownTracer().catch((err: unknown) => {
        logger.warn('⚠️ فشل إيقاف التتبع الموزع', {
          correlationId,
          error: err instanceof Error ? err.message : 'unknown',
        });
      });

      logger.info('✅ إيقاف التشغيل الآمن اكتمل', { correlationId });
      process.exit(0);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown';
      logger.error('❌ فشل إيقاف التشغيل الآمن', {
        correlationId,
        error: errorMessage,
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    const correlationId = getCurrentCorrelationId() || 'uncaught';
    logger.error('❌ استثناء غير معالج', {
      correlationId,
      error: error.message,
      stack: error.stack,
    });
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason) => {
    const correlationId = getCurrentCorrelationId() || 'unhandled';
    logger.error('❌ رفض وعد غير معالج', {
      correlationId,
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

// ============================================================
// التهيئة الأساسية (بدون Workers)
// ============================================================

async function initializeApplication(): Promise<void> {
  const correlationId = 'startup-init';

  logger.info('🚀 بدء تهيئة خادم HTTP', {
    correlationId,
    nodeVersion: process.version,
    env: config.env.nodeEnv,
    pid: process.pid,
  });

  try {
    // 1. التشفير
    logger.debug('🔐 تهيئة التشفير', { correlationId });
    initializeEncryption();

    // 2. التتبع الموزع
    logger.debug('🔍 تهيئة التتبع الموزع', { correlationId });
    initializeTracer();
    setTracingInitialized(true);

    // 3. Redis (مطلوب لـ Rate Limiter و BullMQ)
    logger.debug('🔴 تهيئة Redis', { correlationId });
    const redisClient = await initializeRedis();
    initializeRateLimiter(redisClient);
    logger.info('✅ تم تهيئة Redis و Rate Limiter', { correlationId });

    // 4. حالة بدء التشغيل
    logger.debug('📊 تهيئة حالة بدء التشغيل', { correlationId });
    initializeStartup();
    setQueuesInitialized(true);
    markStartupComplete();

    logger.info('✅ اكتملت التهيئة الأساسية', {
      correlationId,
      tracingInitialized: true,
      encryptionInitialized: true,
      redisInitialized: true,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('❌ فشلت التهيئة الأساسية', {
      correlationId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// ============================================================
// بدء التشغيل الرئيسي
// ============================================================

async function startApplication(): Promise<void> {
  const correlationId = 'startup-main';

  try {
    await initializeApplication();

    // بدء تشغيل الخادم
    const port = config.server.port;
    logger.info('🚀 بدء تشغيل خادم HTTP', { correlationId, port });

    httpServer = server.listen(port, () => {
      logger.info('✅ اكتمل بدء تشغيل الخادم', {
        correlationId,
        port,
        env: config.env.nodeEnv,
      });

      console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ WhatsApp AI Agent Platform - HTTP Server               ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Server running at:     http://localhost:${port}        ║
║  🌍 Environment:           ${config.env.nodeEnv.padEnd(30)}║
║  🔢 Process ID:            ${String(process.pid).padEnd(30)}║
║  ⏱️  Started at:            ${new Date().toISOString()} ║
║  ⚙️  Workers:               Running separately             ║
╚══════════════════════════════════════════════════════════════╝
      `);
    });

    setupShutdownHandlers();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('❌ فشل بدء تشغيل التطبيق', {
      correlationId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// ============================================================
// نقطة الدخول (ESM)
// ============================================================

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startApplication().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('❌ فشل تشغيل التطبيق', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  });
}

// ============================================================
// التصدير للاختبارات
// ============================================================

export {
  startApplication,
  initializeApplication,
  setupShutdownHandlers,
};

export { server };
export default startApplication;