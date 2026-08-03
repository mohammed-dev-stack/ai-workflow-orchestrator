// backend/src/observability/health/liveness.ts
import { Request, Response } from 'express';
import { config } from '../../config';
import { logger } from '../../observability/logger';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware';

/**
 * نتائج فحص الحيوية (Liveness).
 * [مُتحقَّق منطقياً بتتبع كامل] — هيكل استجابة فحص الحيوية.
 */
export interface LivenessResult {
  /** حالة الفحص ('alive' أو 'dead') */
  status: 'alive' | 'dead';
  /** الطابع الزمني للفحص */
  timestamp: string;
  /** معرّف الارتباط (للتتبع) */
  correlationId: string;
  /** وقت تشغيل الخادم بالثواني */
  uptime: number;
  /** إصدار Node.js */
  nodeVersion: string;
  /** بيئة التشغيل */
  env: string;
  /** معرف العملية (PID) */
  pid: number;
  /** استخدام الذاكرة (اختياري — للتصحيح) */
  memory?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
}

/**
 * دالة مساعدة لفحص الحيوية (Liveness Probe).
 * تتحقق مما إذا كان الخادم لا يزال قيد التشغيل (يعالج الطلبات).
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — فحص حيوية بسيط وسريع.
 *
 * @param req - طلب Express
 * @param res - استجابة Express
 */
export function livenessHandler(req: Request, res: Response): void {
  const correlationId = getCurrentCorrelationId() || 'liveness-check';
  const startTime = Date.now();

  try {
    // جمع معلومات الخادم
    const memoryUsage = process.memoryUsage();
    const uptimeSeconds = process.uptime();

    // بناء نتيجة الفحص
    const result: LivenessResult = {
      status: 'alive',
      timestamp: new Date().toISOString(),
      correlationId,
      uptime: Math.floor(uptimeSeconds),
      nodeVersion: process.version,
      env: config.env.nodeEnv || 'unknown',
      pid: process.pid,
      // معلومات الذاكرة (للتصحيح في التطوير)
      ...(config.env.isDevelopment && {
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          external: Math.round(memoryUsage.external / 1024 / 1024), // MB
        },
      }),
    };

    // تسجيل الفحص (للتصحيح)
    const durationMs = Date.now() - startTime;
    logger.debug('فحص الحيوية', {
      correlationId,
      status: result.status,
      uptime: result.uptime,
      durationMs,
      pid: result.pid,
    });

    // إرسال الاستجابة
    res.status(200).json(result);
  } catch (error) {
    // في حال فشل الفحص (نادر)
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('فشل فحص الحيوية', {
      correlationId,
      error: errorMessage,
    });

    res.status(503).json({
      status: 'dead',
      timestamp: new Date().toISOString(),
      correlationId,
      error: 'فشل فحص الحيوية',
      details: errorMessage,
    });
  }
}

/**
 * دالة مساعدة للحصول على معلومات الخادم (للتصحيح).
 * [مُتحقَّق منطقياً بتتبع كامل] — معلومات الخادم الأساسية.
 */
export function getServerInfo(): {
  pid: number;
  uptime: number;
  nodeVersion: string;
  env: string;
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
} {
  const memoryUsage = process.memoryUsage();
  return {
    pid: process.pid,
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    env: config.env.nodeEnv || 'unknown',
    memory: {
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024),
    },
  };
}

/**
 * تصدير معالج فحص الحيوية كافتراضي.
 */
export default livenessHandler;

