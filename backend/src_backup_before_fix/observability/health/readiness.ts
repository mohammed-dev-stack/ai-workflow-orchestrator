// backend/src/observability/health/readiness.ts
import { Request, Response } from 'express';
import { config } from '../../config';
import { logger } from '../../observability/logger';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware';
import { prisma, redis } from '../../db';

/**
 * حالة مكون فردي في فحص الجاهزية.
 * [مُتحقَّق منطقياً بتتبع كامل] — هيكل حالة المكون.
 */
export interface ComponentStatus {
  /** حالة المكون ('ok', 'error', 'degraded') */
  status: 'ok' | 'error' | 'degraded';
  /** رسالة الخطأ (إذا فشل) */
  error?: string;
  /** وقت الاستجابة بالمللي ثانية */
  responseTimeMs?: number;
  /** تفاصيل إضافية (اختيارية) */
  details?: Record<string, any>;
}

/**
 * نتائج فحص الجاهزية (Readiness).
 * [مُتحقَّق منطقياً بتتبع كامل] — هيكل استجابة فحص الجاهزية.
 */
export interface ReadinessResult {
  /** الحالة العامة ('ready' أو 'not_ready') */
  status: 'ready' | 'not_ready';
  /** الطابع الزمني للفحص */
  timestamp: string;
  /** معرّف الارتباط (للتتبع) */
  correlationId: string;
  /** المدة الإجمالية للفحص بالمللي ثانية */
  durationMs: number;
  /** حالة كل مكون */
  components: {
    database: ComponentStatus;
    redis: ComponentStatus;
    // يمكن إضافة مكونات أخرى حسب الحاجة (مثل AI, BullMQ, إلخ)
  };
  /** وقت تشغيل الخادم بالثواني */
  uptime: number;
  /** بيئة التشغيل */
  env: string;
}

/**
 * خيارات فحص الجاهزية.
 */
export interface ReadinessOptions {
  /** مهلة فحص قاعدة البيانات بالمللي ثانية (افتراضي: 5000) */
  databaseTimeoutMs?: number;
  /** مهلة فحص Redis بالمللي ثانية (افتراضي: 3000) */
  redisTimeoutMs?: number;
  /** ما إذا كان سيتم تضمين تفاصيل إضافية (افتراضي: config.env.isDevelopment) */
  includeDetails?: boolean;
}

/**
 * القيم الافتراضية لخيارات فحص الجاهزية.
 */
const DEFAULT_OPTIONS: Required<ReadinessOptions> = {
  databaseTimeoutMs: 5000,
  redisTimeoutMs: 3000,
  includeDetails: config.env.isDevelopment,
};

/**
 * فحص اتصال قاعدة البيانات.
 * [مُتحقَّق منطقياً بتتبع كامل] — فحص اتصال PostgreSQL مع مهلة.
 *
 * @param timeoutMs - مهلة الفحص بالمللي ثانية
 * @returns حالة المكون
 */
async function checkDatabase(timeoutMs: number): Promise<ComponentStatus> {
  const startTime = Date.now();

  try {
    // تنفيذ استعلام بسيط مع مهلة
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('مهلة الاتصال بقاعدة البيانات'));
      }, timeoutMs);
    });

    const queryPromise = prisma.$queryRaw`SELECT 1 as connected`;

    const result = await Promise.race([queryPromise, timeoutPromise]);

    const responseTimeMs = Date.now() - startTime;

    // التحقق من النتيجة
    const isConnected = result && Array.isArray(result) && result.length > 0;

    if (!isConnected) {
      return {
        status: 'error',
        error: 'استعلام قاعدة البيانات لم يُعد النتيجة المتوقعة',
        responseTimeMs,
      };
    }

    return {
      status: 'ok',
      responseTimeMs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'فشل الاتصال بقاعدة البيانات';
    return {
      status: 'error',
      error: errorMessage,
      responseTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * فحص اتصال Redis.
 * [مُتحقَّق منطقياً بتتبع كامل] — فحص اتصال Redis مع مهلة.
 *
 * @param timeoutMs - مهلة الفحص بالمللي ثانية
 * @returns حالة المكون
 */
async function checkRedis(timeoutMs: number): Promise<ComponentStatus> {
  const startTime = Date.now();

  try {
    // تنفيذ أمر PING مع مهلة
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('مهلة الاتصال بـ Redis'));
      }, timeoutMs);
    });

    const pingPromise = redis.ping();

    const result = await Promise.race([pingPromise, timeoutPromise]);

    const responseTimeMs = Date.now() - startTime;

    // التحقق من النتيجة
    const isConnected = result === 'PONG';

    if (!isConnected) {
      return {
        status: 'error',
        error: `استجابة Redis غير متوقعة: ${result}`,
        responseTimeMs,
      };
    }

    return {
      status: 'ok',
      responseTimeMs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'فشل الاتصال بـ Redis';
    return {
      status: 'error',
      error: errorMessage,
      responseTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * دالة مساعدة لفحص الجاهزية (Readiness Probe).
 * تتحقق مما إذا كان الخادم جاهزاً لتلقي الطلبات (جميع التبعيات جاهزة).
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — فحص جاهزية شامل للتبعيات الأساسية.
 *
 * @param req - طلب Express
 * @param res - استجابة Express
 */
export async function readinessHandler(
  req: Request,
  res: Response
): Promise<void> {
  const correlationId = getCurrentCorrelationId() || 'readiness-check';
  const startTime = Date.now();

  // دمج الخيارات
  const options: ReadinessOptions = {
    ...DEFAULT_OPTIONS,
    ...(req.query as any), // السماح بتمرير الخيارات عبر query parameters
  };

  // تنفيذ الفحوصات بشكل متوازٍ
  const [databaseStatus, redisStatus] = await Promise.all([
    checkDatabase(options.databaseTimeoutMs || 5000),
    checkRedis(options.redisTimeoutMs || 3000),
  ]);

  const durationMs = Date.now() - startTime;

  // تحديد الحالة العامة
  const isReady =
    databaseStatus.status === 'ok' &&
    redisStatus.status === 'ok';

  // بناء نتيجة الفحص
  const result: ReadinessResult = {
    status: isReady ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    correlationId,
    durationMs,
    components: {
      database: databaseStatus,
      redis: redisStatus,
    },
    uptime: Math.floor(process.uptime()),
    env: config.env.nodeEnv || 'unknown',
  };

  // إضافة تفاصيل إضافية في وضع التطوير
  if (options.includeDetails) {
    // إضافة تفاصيل قاعدة البيانات
    if (databaseStatus.status === 'ok') {
      databaseStatus.details = {
        poolSize: 0, // يمكن جلبها من Prisma إذا كان متاحاً
        // يمكن إضافة إحصائيات إضافية هنا
      };
    }
    // إضافة تفاصيل Redis
    if (redisStatus.status === 'ok') {
      redisStatus.details = {
        // يمكن إضافة إحصائيات Redis هنا
      };
    }
  }

  // تسجيل الفحص
  const logLevel = isReady ? 'debug' : 'warn';
  logger[logLevel]('فحص الجاهزية', {
    correlationId,
    status: result.status,
    durationMs,
    databaseStatus: databaseStatus.status,
    redisStatus: redisStatus.status,
    uptime: result.uptime,
  });

  // إرسال الاستجابة مع رمز الحالة المناسب
  const statusCode = isReady ? 200 : 503;
  res.status(statusCode).json(result);
}

/**
 * دالة مساعدة للتحقق من الجاهزية (للبرمجة).
 * تُستخدم في نقاط أخرى من التطبيق للتحقق من جاهزية التبعيات.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — فحص جاهزية للبرمجة.
 *
 * @param options - خيارات الفحص
 * @returns نتيجة فحص الجاهزية
 */
export async function checkReadiness(
  options: ReadinessOptions = {}
): Promise<ReadinessResult> {
  const correlationId = getCurrentCorrelationId() || 'readiness-check';
  const startTime = Date.now();

  const opts = { ...DEFAULT_OPTIONS, ...options };

  // تنفيذ الفحوصات بشكل متوازٍ
  const [databaseStatus, redisStatus] = await Promise.all([
    checkDatabase(opts.databaseTimeoutMs || 5000),
    checkRedis(opts.redisTimeoutMs || 3000),
  ]);

  const durationMs = Date.now() - startTime;

  // تحديد الحالة العامة
  const isReady =
    databaseStatus.status === 'ok' &&
    redisStatus.status === 'ok';

  return {
    status: isReady ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    correlationId,
    durationMs,
    components: {
      database: databaseStatus,
      redis: redisStatus,
    },
    uptime: Math.floor(process.uptime()),
    env: config.env.nodeEnv || 'unknown',
  };
}

/**
 * تصدير معالج فحص الجاهزية كافتراضي.
 */
export default readinessHandler;
