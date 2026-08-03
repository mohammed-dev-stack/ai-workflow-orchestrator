// ============================================================
// backend/src/index.ts
// ============================================================
// نقطة الدخول الرئيسية لتطبيق الخادم.
// تم إصلاح استيراد initializeTracer و shutdownTracer باستخدام التصدير المسمى.
// ============================================================

import { config } from './config/index.js';
import { logger } from './observability/logger.js';
import { getCurrentCorrelationId } from './middlewares/correlation.middleware.js';
// ✅ التصدير المسمى متاح الآن في tracer.ts
import { initializeTracer, shutdownTracer } from './observability/tracer.js';
import { initializeEncryption } from './utils/encryption.js';
import {
  initializeStartup,
  markStartupComplete,
  setTracingInitialized,
  setQueuesInitialized,
} from './observability/health/startup.js';
import { server } from './server.js';
import { documentWorker } from './queues/workers/document.worker.js';
import { whatsappWorker } from './queues/workers/whatsapp.worker.js';
import { analyticsWorker } from './queues/workers/analytics.worker.js';
import deadLetterWorker from './queues/index.js';
import { fileURLToPath } from 'url';

// ============================================================
// متغير لتخزين كائن الخادم (من `server.listen`) للإيقاف الآمن
// ============================================================

let httpServer: ReturnType<typeof server.listen> | null = null;

// ============================================================
// معالجة الإشارات والإيقاف الآمن
// ============================================================

function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    const correlationId = getCurrentCorrelationId() || 'shutdown';
    logger.info(`استلام إشارة ${signal}، بدء إيقاف التشغيل الآمن`, { correlationId });

    try {
      logger.debug('إيقاف عامل قائمة انتظار المستندات', { correlationId });
      await documentWorker.close().catch((err: unknown) => {
        logger.warn('فشل إيقاف عامل المستندات', {
          correlationId,
          error: err instanceof Error ? err.message : 'unknown',
        });
      });

      logger.debug('إيقاف عامل قائمة انتظار WhatsApp', { correlationId });
      await whatsappWorker.close().catch((err: unknown) => {
        logger.warn('فشل إيقاف عامل WhatsApp', {
          correlationId,
          error: err instanceof Error ? err.message : 'unknown',
        });
      });

      logger.debug('إيقاف عامل قائمة انتظار التحليلات', { correlationId });
      await analyticsWorker.close().catch((err: unknown) => {
        logger.warn('فشل إيقاف عامل التحليلات', {
          correlationId,
          error: err instanceof Error ? err.message : 'unknown',
        });
      });

      logger.debug('إيقاف عامل DLQ', { correlationId });
      await deadLetterWorker.close().catch((err: unknown) => {
        logger.warn('فشل إيقاف عامل DLQ', {
          correlationId,
          error: err instanceof Error ? err.message : 'unknown',
        });
      });

      await shutdownTracer().catch((err: unknown) => {
        logger.warn('فشل إيقاف التتبع الموزع', {
          correlationId,
          error: err instanceof Error ? err.message : 'unknown',
        });
      });

      // إيقاف خادم HTTP
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer!.close(() => {
            logger.debug('تم إيقاف خادم HTTP', { correlationId });
            resolve();
          });
        });
      }

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
// التهيئة الأساسية
// ============================================================

async function initializeApplication(): Promise<void> {
  const correlationId = 'startup-init';

  logger.info('🚀 بدء تهيئة التطبيق', {
    correlationId,
    nodeVersion: process.version,
    env: config.env.nodeEnv,
    pid: process.pid,
  });

  try {
    logger.debug('تهيئة التشفير', { correlationId });
    initializeEncryption();

    logger.debug('تهيئة التتبع الموزع', { correlationId });
    // ✅ initializeTracer متاحة كتصدير مسمى
    initializeTracer();
    setTracingInitialized(true);

    logger.info('✅ اكتملت التهيئة الأساسية', {
      correlationId,
      tracingInitialized: true,
      encryptionInitialized: true,
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

    logger.debug('تهيئة حالة بدء التشغيل', { correlationId });
    initializeStartup();

    setQueuesInitialized(true);
    markStartupComplete();

    // ✅ بدء تشغيل الخادم باستخدام `server.listen`
    const port = config.server.port;
    logger.info('🚀 بدء تشغيل الخادم', { correlationId, port });

    httpServer = server.listen(port, () => {
      logger.info('✅ اكتمل بدء تشغيل التطبيق', {
        correlationId,
        port,
        env: config.env.nodeEnv,
      });

      console.log(`
╔══════════════════════════════════════════════════════════════╗
║  ✅ WhatsApp AI Agent Platform - Backend Server            ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Server running at:     http://localhost:${port}        ║
║  🌍 Environment:           ${config.env.nodeEnv.padEnd(30)}║
║  🔢 Process ID:            ${String(process.pid).padEnd(30)}║
║  ⏱️  Started at:            ${new Date().toISOString()} ║
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
// ✅ نقطة الدخول (ESM) — بدون require
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
