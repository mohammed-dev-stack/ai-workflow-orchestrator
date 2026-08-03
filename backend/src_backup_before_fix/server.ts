// ============================================================
// backend/src/server.ts
// ============================================================
// خادم Express — يصدّر فقط تطبيق Express مع جميع الـ middleware والمسارات.
// تم إصلاح مشكلة req.ip المحتملة undefined في ipKeyGenerator.
// ✅ تم إضافة مسار /api/knowledge-bases.
// ✅ تم إضافة مسار /api/analytics لحل مشكلة "لا توجد بيانات للتحليلات".
// ============================================================

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from './config/index.js';
import { logger } from './observability/logger.js';

// استيراد الـ Middleware
import { getCurrentCorrelationId } from './middlewares/correlation.middleware.js';
import { correlationMiddleware } from './middlewares/correlation.middleware.js';
import { errorHandler, catchAllErrorHandler } from './middlewares/errorHandler.middleware.js';
import { loggingMiddleware } from './middlewares/logging.middleware.js';
import { authenticate } from './middlewares/auth.middleware.js';

const requireAuth = authenticate;

// استيراد المسارات
import conversationRoutes from './routes/conversation.routes.js';
import documentRoutes from './routes/document.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import authRoutes from './routes/auth.routes.js';
// ✅ مسار قواعد المعرفة – تم إضافته لحل 404
import knowledgeBaseRoutes from './routes/knowledgeBase.routes.js';
// ✅ مسار التحليلات – تم إضافته لحل مشكلة "لا توجد بيانات للتحليلات"
import analyticsRoutes from './routes/analytics.routes.js';

// ============================================================
// إنشاء تطبيق Express
// ============================================================

const app: Express = express();

// ============================================================
// الـ Middleware الأساسية
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

const rateLimitWindowMs = config.rateLimit?.windowMs || 60000; // 60 ثانية
const rateLimitMax = config.rateLimit?.maxRequests || 100; // 100 طلب لكل نافذة
const rateLimitMessage = 'تم تجاوز حد الطلبات المسموح به. يرجى المحاولة بعد قليل.';

app.use(rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  message: rateLimitMessage,
  /**
   * مفتاح التمييز (Key Generator)
   * يجمع بين IP والمستخدم و correlationId لتحديد فريد لكل عميل
   * ✅ تم إصلاح req.ip: استخدام قيمة افتراضية في حال كانت undefined
   */
  keyGenerator: (req) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
    const clientIp = req.ip || 
                     req.headers['x-forwarded-for']?.toString().split(',')[0] || 
                     req.socket.remoteAddress || 
                     '0.0.0.0';
    const ipKey = ipKeyGenerator(clientIp as string, 56);
    return `${ipKey}-${correlationId}`;
  },
  /**
   * تخطي (Skip) مسارات الصحة و Webhook
   * - الصحة: لتجنب حظر أدوات المراقبة
   * - Webhook: واتساب يرسل طلبات كثيرة وقد يحتاج إلى معاملة خاصة
   */
  skip: (req) => req.path.startsWith('/health') || req.path.startsWith('/webhook'),
  standardHeaders: true, // إضافة رؤوس RateLimit-* في الاستجابة
  legacyHeaders: false,  // تعطيل الرؤوس القديمة (X-RateLimit-*)
}));

// ============================================================
// المسارات العامة (بدون مصادقة)
// ============================================================

/**
 * GET /health
 * فحص صحة الخادم (يُستخدم بواسطة أدوات المراقبة)
 */
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    correlationId: getCurrentCorrelationId() || 'no-correlation-id',
  });
});

/**
 * GET /liveness
 * فحص استمرارية التشغيل (يُستخدم بواسطة Kubernetes liveness probe)
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
 * يتحقق من اتصال قاعدة البيانات
 */
app.get('/readiness', async (req: Request, res: Response) => {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  try {
    const { prisma } = await import('./models/prisma/client.js');
    await prisma.$queryRaw`SELECT 1 as connected`;
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
 * - GET /api/conversations
 * - GET /api/conversations/:id
 * - POST /api/conversations
 * - POST /api/conversations/:id/messages
 * - POST /api/conversations/:id/close
 * - DELETE /api/conversations/:id
 * - POST /api/conversations/:id/send-whatsapp
 */
app.use('/api/conversations', requireAuth, conversationRoutes);

/**
 * المستندات – تتطلب مصادقة وعزل المستأجرين
 * - GET /api/documents
 * - GET /api/documents/:id
 * - POST /api/documents
 * - PUT /api/documents/:id
 * - DELETE /api/documents/:id
 * - POST /api/documents/:id/restore
 * - POST /api/documents/:id/process
 * - POST /api/documents/:id/status
 */
app.use('/api/documents', requireAuth, documentRoutes);

/**
 * قواعد المعرفة – تتطلب مصادقة وعزل المستأجرين
 * - GET /api/knowledge-bases
 * - GET /api/knowledge-bases/:id
 * - POST /api/knowledge-bases
 * - PUT /api/knowledge-bases/:id
 * - DELETE /api/knowledge-bases/:id
 * - DELETE /api/knowledge-bases/:id/hard (حذف نهائي)
 * - POST /api/knowledge-bases/:id/restore
 * - GET /api/knowledge-bases/:id/documents/count
 */
app.use('/api/knowledge-bases', requireAuth, knowledgeBaseRoutes);

/**
 * ✅ التحليلات – تم إضافته لحل مشكلة "لا توجد بيانات للتحليلات"
 * تتطلب مصادقة وعزل المستأجرين
 * - GET /api/analytics/dashboard
 * - GET /api/analytics/trends
 * - GET /api/analytics/ai-performance
 * - GET /api/analytics/documents/status
 * - GET /api/analytics/messages/roles
 * - GET /api/analytics/storage
 * - POST /api/analytics/cache/invalidate
 */
app.use('/api/analytics', requireAuth, analyticsRoutes);

// ============================================================
// معالج 404 (للمسارات غير المعروفة)
// ============================================================

/**
 * يتم تشغيل هذا المعالج عندما لا يطابق أي مسار آخر الطلب
 * يعيد 404 مع رسالة موحدة تحتوي على correlationId لتسهيل التتبع
 */
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

/**
 * معالج الأخطاء المركزي (Error Handler)
 * - في بيئة التطوير: يعرض تفاصيل الخطأ (stack trace) لتسهيل التصحيح
 * - في بيئة الإنتاج: يعرض رسالة عامة فقط لحماية المعلومات الحساسة
 */
app.use(errorHandler({
  includeStackTrace: config.env.isDevelopment,
  logStackTrace: true,
}));

/**
 * معالج الأخطاء الشامل (Catch-All)
 * يلتقط أي خطأ غير متوقع لم يتم التعامل معه بواسطة errorHandler
 */
app.use(catchAllErrorHandler);

// ============================================================
// التصدير — فقط التطبيق، بدون منطق تشغيل
// ============================================================

/**
 * تصدير التطبيق كـ `server` و `default`
 * يُستخدم في ملف التشغيل (مثل `bin/www` أو `index.ts`)
 * فصل التهيئة عن التشغيل يسهل الاختبار ويمنع تشغيل الخادم عدة مرات
 */
export { app as server };
export default app;
