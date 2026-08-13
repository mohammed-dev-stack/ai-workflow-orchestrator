// ============================================================
// backend/src/app.ts
// ============================================================
// خادم Express — يُهيئ التطبيق بالكامل مع جميع الـ Middleware والمسارات.
// ✅ تم إعادة هيكلته لاستخدام PostgreSQL + Prisma بدلاً من MongoDB.
// ✅ تم تبني المصدر الوحيد (SSoT) للإعدادات من config/index.ts.
// ✅ تم فصل منطق التشغيل (server.listen) عن تهيئة التطبيق (app) لتسهيل الاختبار.
// ============================================================

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createServer, Server } from 'http';

// ============================================================
// استيرادات المشروع الداخلية
// ============================================================

// المصدر الوحيد للإعدادات (SSoT)
import { config } from './config/index.js';

// أدوات المراقبة والتسجيل
import { logger } from './observability/logger.js';
import { getCurrentCorrelationId } from './middlewares/correlation.middleware.js';
import { correlationMiddleware } from './middlewares/correlation.middleware.js';
import { loggingMiddleware } from './middlewares/logging.middleware.js';

// معالجات الأخطاء والمصادقة
import { errorHandler, catchAllErrorHandler } from './middlewares/errorHandler.middleware.js';
import { authenticate } from './middlewares/auth.middleware.js';

// عميل Prisma (الاتصال بقاعدة البيانات PostgreSQL)
import { prisma } from './models/prisma/client.js';

// عميل Redis (لـ BullMQ والتخزين المؤقت)
import { getRedisClient, initializeRedis } from './config/redis.config.js';

// المسارات (Routes)
import conversationRoutes from './routes/conversation.routes.js';
import documentRoutes from './routes/document.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import authRoutes from './routes/auth.routes.js';
import knowledgeBaseRoutes from './routes/knowledgeBase.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';

// معالج BullMQ Worker (للمهام الخلفية)
import { RunWorker } from './workers/run.worker.js';

// ============================================================
// إنشاء تطبيق Express
// ============================================================

const app: Application = express();

// ============================================================
// الـ Middleware الأساسية (الأمان، الضغط، التحليل)
// ============================================================

/**
 * Helmet – إضافة رؤوس أمان HTTP
 * - crossOriginResourcePolicy: تسمح بتحميل الموارد عبر النطاقات (ضروري للـ API)
 * - Content-Security-Policy: تقييد مصادر تحميل النصوص والصور
 */
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
    },
  },
}));

/**
 * CORS – السماح للواجهة الأمامية بالاتصال بالخادم
 * - origin: من الإعدادات (يدعم النطاقات المتعددة)
 * - credentials: true للسماح بإرسال التوكن عبر الـ cookies
 * - methods: جميع الطرق الأساسية
 * - allowedHeaders: الرؤوس المصرح بها (بما فيها x-correlation-id و x-tenant-id)
 * - exposedHeaders: الرؤوس المكشوفة للواجهة الأمامية (للـ rate limiting)
 */
app.use(cors({
  origin: config.server.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'x-tenant-id'],
  exposedHeaders: ['x-correlation-id', 'x-rate-limit-limit', 'x-rate-limit-remaining'],
}));

/**
 * Compression – ضغط الاستجابات (Gzip/Brotli)
 * يقلل حجم البيانات المنقولة ويحسن الأداء
 */
app.use(compression());

/**
 * تحليل جسم الطلب (Body Parser)
 * - JSON: حد أقصى 1 ميجابايت لمنع هجمات DoS
 * - URL-encoded: دعم النماذج التقليدية
 */
const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1 MB
app.use(express.json({ limit: MAX_PAYLOAD_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_PAYLOAD_SIZE }));

/**
 * Cookie Parser – تحليل الـ cookies وإتاحتها في req.cookies
 * تستخدمه بعض استراتيجيات المصادقة (مثل JWT في cookies)
 */
app.use(cookieParser());

// ============================================================
// التتبُّع والتسجيل (Correlation & Logging)
// ============================================================

/**
 * Correlation Middleware – إضافة معرف تتبع فريد لكل طلب
 * يُستخدم في التسجيل لتتبع الطلبات عبر الخدمات المختلفة
 */
app.use(correlationMiddleware);

/**
 * Logging Middleware – تسجيل الطلبات والاستجابات
 * - في بيئة التطوير: تسجيل جسم الطلب والاستجابة بالكامل
 * - استثناء مسارات الصحة (لتجنب تلويث السجلات)
 */
app.use(loggingMiddleware({
  logRequestBody: config.env.isDevelopment,
  logResponseBody: config.env.isDevelopment,
  excludePaths: ['/health', '/liveness', '/readiness', '/startup', '/metrics'],
}));

// ============================================================
// تحديد المعدل (Rate Limiter) — حماية من هجمات DoS
// ============================================================

// يمكن تفعيل الـ Redis-backed limiter لاحقاً، حالياً نستخدم in-memory
const rateLimitWindowMs = config.rateLimit?.windowMs || 60000; // 60 ثانية
const rateLimitMax = config.rateLimit?.maxRequests || 100; // 100 طلب لكل نافذة
const rateLimitMessage = 'تم تجاوز حد الطلبات المسموح به. يرجى المحاولة بعد قليل.';

app.use(rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  message: rateLimitMessage,
  keyGenerator: (req) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
    const clientIp = req.ip ||
                     req.headers['x-forwarded-for']?.toString().split(',')[0] ||
                     req.socket.remoteAddress ||
                     '0.0.0.0';
    return `${clientIp}-${correlationId}`;
  },
  skip: (req) => req.path.startsWith('/health') || req.path.startsWith('/webhook'),
  standardHeaders: true,
  legacyHeaders: false,
}));

// ============================================================
// المسارات العامة (بدون مصادقة)
// ============================================================

/**
 * GET /health
 * فحص صحة الخادم (يُستخدم بواسطة أدوات المراقبة)
 * يعرض حالة PostgreSQL (Prisma) و Redis و AI Mode
 */
app.get('/health', async (req: Request, res: Response) => {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  const startTime = Date.now();

  try {
    // فحص اتصال Prisma (PostgreSQL)
    let dbStatus = 'disconnected';
    let dbLatency = 0;
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1 as connected`;
      dbLatency = Date.now() - dbStart;
      dbStatus = 'connected';
    } catch (error) {
      dbStatus = 'error';
    }

    // فحص اتصال Redis
    let redisStatus = 'disconnected';
    let redisLatency = 0;
    try {
      const redis = getRedisClient();
      if (redis) {
        const redisStart = Date.now();
        await redis.ping();
        redisLatency = Date.now() - redisStart;
        redisStatus = 'connected';
      }
    } catch (error) {
      redisStatus = 'error';
    }

    // حالة الذكاء الاصطناعي
    const aiMode = config.anthropic.apiKey && config.anthropic.apiKey !== 'dummy_key_for_development_please_replace_in_production'
      ? 'real'
      : 'mock';
    const aiLabel = aiMode === 'real' ? '✅ Real (Claude)' : '🧪 Mock (Free - No Cost)';

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      services: {
        database: {
          type: 'PostgreSQL + pgvector',
          status: dbStatus,
          latency: dbLatency,
        },
        redis: {
          status: redisStatus,
          latency: redisLatency,
        },
        ai: {
          mode: aiMode,
          label: aiLabel,
          configured: !!config.anthropic.apiKey && config.anthropic.apiKey !== 'dummy_key_for_development_please_replace_in_production',
        },
      },
      memory: {
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      },
      correlationId,
    });
  } catch (error) {
    logger.error('فشل فحص الصحة', { correlationId, error });
    res.status(500).json({
      status: 'error',
      message: 'فشل فحص الصحة',
      correlationId,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /liveness
 * فحص استمرارية التشغيل (يُستخدم بواسطة Kubernetes liveness probe)
 * يجب أن يعيد 200 دائماً ما دام التطبيق قيد التشغيل
 */
app.get('/liveness', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    correlationId: getCurrentCorrelationId() || 'no-correlation-id',
    uptime: process.uptime(),
  });
});

/**
 * GET /readiness
 * فحص جاهزية الخادم (يُستخدم بواسطة Kubernetes readiness probe)
 * يتحقق من اتصال قاعدة البيانات (Prisma) و Redis
 */
app.get('/readiness', async (req: Request, res: Response) => {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  try {
    // اختبار Prisma
    await prisma.$queryRaw`SELECT 1 as connected`;
    // اختبار Redis
    const redis = getRedisClient();
    if (redis) {
      await redis.ping();
    }

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      correlationId,
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      correlationId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
});

// ============================================================
// المسارات المُستوردة (المحمية – تتطلب مصادقة)
// ============================================================

// تطبيق المصادقة (JWT) على جميع المسارات المحمية
const requireAuth = authenticate;

/**
 * Webhook – مسار عام (بدون مصادقة) يستقبل رسائل واتساب
 * يتحقق من التوقيع داخلياً لضمان الأمان
 */
app.use('/webhook', webhookRoutes);

/**
 * المصادقة – مسارات عامة (تسجيل الدخول، التسجيل، تجديد التوكن)
 */
app.use('/api/auth', authRoutes);

/**
 * المحادثات – تتطلب مصادقة وعزل المستأجرين
 */
app.use('/api/conversations', requireAuth, conversationRoutes);

/**
 * المستندات – تتطلب مصادقة وعزل المستأجرين
 */
app.use('/api/documents', requireAuth, documentRoutes);

/**
 * قواعد المعرفة – تتطلب مصادقة وعزل المستأجرين
 */
app.use('/api/knowledge-bases', requireAuth, knowledgeBaseRoutes);

/**
 * التحليلات – تتطلب مصادقة وعزل المستأجرين
 */
app.use('/api/analytics', requireAuth, analyticsRoutes);

// ============================================================
// معالج 404 (للمسارات غير المعروفة)
// ============================================================

app.use((req: Request, res: Response) => {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  logger.warn('مسار غير موجود', {
    correlationId,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'المسار غير موجود',
    correlationId,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// معالج الأخطاء العام
// ============================================================

app.use(errorHandler({
  includeStackTrace: config.env.isDevelopment,
  logStackTrace: true,
}));

app.use(catchAllErrorHandler);

// ============================================================
// تهيئة الخادم وتشغيله (منفصلة عن التطبيق)
// ============================================================

let server: Server;
let isShuttingDown = false;

/**
 * دالة بدء تشغيل الخادم
 * تقوم بـ:
 * 1. الاتصال بـ PostgreSQL عبر Prisma
 * 2. الاتصال بـ Redis
 * 3. بدء BullMQ Worker
 * 4. تشغيل خادم Express على المنفذ المحدد
 */
export async function startServer(): Promise<void> {
  try {
    // عرض لافتة البداية
    logger.info('🚀 ' + '='.repeat(60));
    logger.info('  🤖 AI Knowledge Orchestrator Server');
    logger.info(`  📦 Version: ${process.env.npm_package_version || '1.0.0'}`);
    logger.info(`  🌍 Environment: ${config.env.nodeEnv}`);
    logger.info(`  🔑 API Key: ${config.anthropic.apiKey && config.anthropic.apiKey !== 'dummy_key_for_development_please_replace_in_production' ? '✅ Configured' : '❌ Missing (Mock only)'}`);
    logger.info('🚀 ' + '='.repeat(60));

    // 1. الاتصال بـ PostgreSQL عبر Prisma
    logger.info('🗄️ Connecting to PostgreSQL via Prisma...');
    await prisma.$connect();
    // اختبار الاتصال
    await prisma.$queryRaw`SELECT 1 as connected`;
    logger.info('✅ PostgreSQL connected successfully');

    // 2. الاتصال بـ Redis
    logger.info('🔴 Connecting to Redis...');
    await initializeRedis();
    logger.info('✅ Redis connected successfully');

    // 3. بدء BullMQ Worker (للمعالجة الخلفية)
    logger.info('⚙️ Starting BullMQ Worker...');
    await RunWorker.start();
    logger.info('✅ BullMQ Worker started');

    // 4. تشغيل خادم Express
    const PORT = config.server.port || 3000;
    server = createServer(app);
    server.listen(PORT, () => {
      logger.info(`🌐 Server running on http://localhost:${PORT}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/health`);
      logger.info(`📡 API endpoint: http://localhost:${PORT}/api`);
    });

    // تسجيل معالج الإغلاق الآمن
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

    // معالجة الأخطاء غير المتوقعة
    process.on('uncaughtException', (error) => {
      logger.error('💥 Uncaught Exception', { error: error.message, stack: error.stack });
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('💥 Unhandled Rejection', { reason });
      gracefulShutdown('unhandledRejection');
    });

  } catch (error) {
    logger.error('❌ Failed to start server', { error });
    process.exit(1);
  }
}

/**
 * دالة الإغلاق الآمن (Graceful Shutdown)
 * تغلق:
 * 1. خادم HTTP (بعد انتظار انتهاء الطلبات الحالية)
 * 2. اتصال Prisma (PostgreSQL)
 * 3. اتصال Redis
 * 4. BullMQ Worker
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('⚠️ Shutdown already in progress, skipping duplicate signal');
    return;
  }
  isShuttingDown = true;

  logger.info(`🛑 Received ${signal}, starting graceful shutdown...`);

  // 1. إيقاف استقبال طلبات جديدة
  if (server) {
    server.close(async () => {
      logger.info('🔒 HTTP server closed');
      await closeConnections();
    });
  } else {
    await closeConnections();
  }

  // مهلة قسريّة (Force timeout) لمنع التوقف للأبد
  setTimeout(() => {
    logger.error('⏰ Force shutdown after timeout');
    process.exit(1);
  }, 30000);
}

/**
 * إغلاق جميع الاتصالات بشكل منظم
 */
async function closeConnections(): Promise<void> {
  // 2. إغلاق اتصال Prisma (PostgreSQL)
  try {
    await prisma.$disconnect();
    logger.info('🗄️ PostgreSQL connection closed');
  } catch (error) {
    logger.error('❌ Error closing PostgreSQL connection', { error });
  }

  // 3. إغلاق اتصال Redis
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.quit();
      logger.info('🔴 Redis connection closed');
    }
  } catch (error) {
    logger.error('❌ Error closing Redis connection', { error });
  }

  // 4. إغلاق BullMQ Worker
  try {
    await RunWorker.shutdown();
    logger.info('⚙️ BullMQ Worker closed');
  } catch (error) {
    logger.error('❌ Error closing BullMQ Worker', { error });
  }

  logger.info('✅ Graceful shutdown complete');
  process.exit(0);
}

// ============================================================
// تصدير التطبيق (للاختبار أو للاستخدام الخارجي)
// ============================================================

export default app;