// ============================================================
// backend/src/server.ts
// ============================================================
// خادم Express + WebSocket — يُهيئ التطبيق بالكامل مع جميع الـ middleware والمسارات.
// ✅ تم استبدال express-rate-limit (In-Memory) بـ Redis-based Rate Limiter.
// ✅ تم ربط الـ Rate Limiter مع عزل المستأجرين (Tenant Scope).
// ✅ تم دمج خادم WebSocket لدعم الاتصال الفوري (Realtime).
// ✅ تم إصلاح مشكلة req.ip المحتملة undefined في ipKeyGenerator.
// ============================================================

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { logger } from './observability/logger.js';

// استيراد الـ Middleware
import { getCurrentCorrelationId } from './middlewares/correlation.middleware.js';
import { correlationMiddleware } from './middlewares/correlation.middleware.js';
import { errorHandler, catchAllErrorHandler } from './middlewares/errorHandler.middleware.js';
import { loggingMiddleware } from './middlewares/logging.middleware.js';
import { authenticate } from './middlewares/auth.middleware.js';

// ✅ استيراد Rate Limiter الجديد (Redis-based)
import { initializeRateLimiter, tenantRateLimiter } from './middlewares/rateLimiter.middleware.js';

// استيراد خادم WebSocket
import initializeWebSocket from './websocket/index.js';

// استيراد دوال تهيئة Redis (من config/redis.config.ts)
import { initializeRedis, getRedisClient } from './config/redis.config.js';

const requireAuth = authenticate;

// استيراد المسارات
import conversationRoutes from './routes/conversation.routes.js';
import documentRoutes from './routes/document.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import authRoutes from './routes/auth.routes.js';
import knowledgeBaseRoutes from './routes/knowledgeBase.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';

// ============================================================
// إنشاء تطبيق Express
// ============================================================

const app: Express = express();

// ============================================================
// الـ Middleware الأساسية
// ============================================================

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

app.use(cors({
  origin: config.server.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'x-tenant-id'],
  exposedHeaders: ['x-correlation-id', 'x-rate-limit-limit', 'x-rate-limit-remaining'],
}));

app.use(compression());

const MAX_PAYLOAD_SIZE = 1024 * 1024;
app.use(express.json({ limit: MAX_PAYLOAD_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_PAYLOAD_SIZE }));

app.use(cookieParser());
app.use(correlationMiddleware);

app.use(loggingMiddleware({
  logRequestBody: config.env.isDevelopment,
  logResponseBody: config.env.isDevelopment,
  excludePaths: ['/health', '/liveness', '/readiness', '/startup', '/metrics'],
}));

// ============================================================
// ✅ تحديد المعدل (Rate Limiter) — باستخدام Redis (مع عزل المستأجرين)
// ============================================================

/**
 * تم استبدال `express-rate-limit` (In-Memory) بـ `tenantRateLimiter` (Redis-based).
 * هذا يضمن:
 * - توزيع العدادات عبر عدة عقد (Horizontal Scaling).
 * - عزل تام بين المستأجرين (Tenant Isolation).
 * - عدادات ذرية (Atomic) باستخدام Lua scripts.
 */
app.use(tenantRateLimiter);

// ============================================================
// المسارات العامة (بدون مصادقة)
// ============================================================

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    correlationId: getCurrentCorrelationId() || 'no-correlation-id',
  });
});

app.get('/liveness', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    correlationId: getCurrentCorrelationId() || 'no-correlation-id',
    uptime: process.uptime(),
  });
});

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

app.use('/webhook', webhookRoutes);
app.use('/api/auth', authRoutes);

app.use('/api/conversations', requireAuth, conversationRoutes);
app.use('/api/documents', requireAuth, documentRoutes);
app.use('/api/knowledge-bases', requireAuth, knowledgeBaseRoutes);
app.use('/api/analytics', requireAuth, analyticsRoutes);

// ============================================================
// معالج 404
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
// إنشاء خادم HTTP مشترك لـ Express و WebSocket
// ============================================================

const server = createServer(app);

/**
 * تهيئة خادم WebSocket على المسار /ws.
 */
const wss = initializeWebSocket(server, '/ws');

// ============================================================
// التصدير — التطبيق، الخادم، وخادم WebSocket
// ============================================================

export { app, server, wss };
export default app;