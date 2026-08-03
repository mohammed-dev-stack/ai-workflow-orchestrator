// ============================================================
// backend/src/observability/health/startup.ts
// ============================================================
// حالة بدء التشغيل (Startup Health Check)
// تم إصلاح جميع مشاكل `require` و `import` ليكون متوافقاً مع ES Modules.
// ============================================================

import { Request, Response } from 'express';
import { config } from '../../config/index.js';
import { logger } from '../logger.js';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware.js';

// استيراد prisma و redis كـ ES Modules
import { prisma, redis } from '../../db/index.js';

// ============================================================
// الأنواع والواجهات
// ============================================================

export interface StartupStatus {
  started: boolean;
  startedAt?: string;
  timestamp: string;
  correlationId: string;
  uptime: number;
  nodeVersion: string;
  env: string;
  details: {
    databaseConnected: boolean;
    redisConnected: boolean;
    tracingInitialized: boolean;
    queuesInitialized: boolean;
    initializationDurationMs?: number;
  };
}

export interface StartupOptions {
  includeDetails?: boolean;
}

export interface StartupHook {
  (): Promise<void>;
}

// ============================================================
// الحالة الداخلية
// ============================================================

interface InternalStartupState {
  started: boolean;
  startedAt?: Date;
  initializationDurationMs?: number;
  databaseConnected: boolean;
  redisConnected: boolean;
  tracingInitialized: boolean;
  queuesInitialized: boolean;
}

let startupState: InternalStartupState = {
  started: false,
  startedAt: undefined,
  initializationDurationMs: undefined,
  databaseConnected: false,
  redisConnected: false,
  tracingInitialized: false,
  queuesInitialized: false,
};

let initializationStartTime: number | null = null;
const initializationHooks: StartupHook[] = [];

const DEFAULT_OPTIONS: Required<StartupOptions> = {
  includeDetails: config.env.isDevelopment,
};

// ============================================================
// دوال مساعدة (داخلية)
// ============================================================

function updateStartupComponent<K extends keyof InternalStartupState>(
  component: K,
  value: InternalStartupState[K]
): void {
  if (component === 'started' || component === 'startedAt' || component === 'initializationDurationMs') {
    return;
  }
  startupState[component] = value;
  logger.debug('تحديث حالة بدء التشغيل', {
    component,
    value,
  });
}

// ============================================================
// دوال عامة (API)
// ============================================================

/**
 * تهيئة حالة بدء التشغيل (يُستدعى عند بدء الخادم).
 */
export function initializeStartup(): void {
  const correlationId = getCurrentCorrelationId() || 'startup-init';

  if (startupState.started) {
    logger.warn('تم تهيئة بدء التشغيل مسبقاً، إعادة التعيين', {
      correlationId,
      previousStartedAt: startupState.startedAt,
    });
    startupState = {
      started: false,
      startedAt: undefined,
      initializationDurationMs: undefined,
      databaseConnected: false,
      redisConnected: false,
      tracingInitialized: false,
      queuesInitialized: false,
    };
  }

  initializationStartTime = Date.now();

  setDatabaseConnected(false);
  setRedisConnected(false);
  setTracingInitialized(false);
  setQueuesInitialized(false);

  logger.info('تم تهيئة حالة بدء التشغيل', {
    correlationId,
    initializationStartTime: new Date(initializationStartTime).toISOString(),
  });
}

/**
 * تسجيل اكتمال بدء التشغيل.
 */
export function markStartupComplete(): void {
  const correlationId = getCurrentCorrelationId() || 'startup-complete';

  if (startupState.started) {
    logger.warn('تم وضع علامة على بدء التشغيل مسبقاً', {
      correlationId,
      startedAt: startupState.startedAt,
    });
    return;
  }

  const now = new Date();
  const initializationDurationMs = initializationStartTime
    ? Date.now() - initializationStartTime
    : undefined;

  startupState.started = true;
  startupState.startedAt = now;
  startupState.initializationDurationMs = initializationDurationMs;

  logger.info('✅ اكتمل بدء التشغيل', {
    correlationId,
    startedAt: startupState.startedAt.toISOString(),
    initializationDurationMs: startupState.initializationDurationMs,
    databaseConnected: startupState.databaseConnected,
    redisConnected: startupState.redisConnected,
    tracingInitialized: startupState.tracingInitialized,
    queuesInitialized: startupState.queuesInitialized,
  });
}

/**
 * تسجيل وظيفة تهيئة يجب تنفيذها قبل اكتمال بدء التشغيل.
 */
export function registerStartupHook(hook: StartupHook): void {
  initializationHooks.push(hook);
  logger.debug('تم تسجيل وظيفة تهيئة لبدء التشغيل', {
    hookCount: initializationHooks.length,
  });
}

/**
 * تنفيذ جميع وظائف التهيئة المسجلة.
 */
export async function runStartupHooks(): Promise<void> {
  const correlationId = getCurrentCorrelationId() || 'startup-hooks';

  logger.info('بدء تنفيذ وظائف تهيئة بدء التشغيل', {
    correlationId,
    hookCount: initializationHooks.length,
  });

  const startTime = Date.now();

  for (let i = 0; i < initializationHooks.length; i++) {
    const hook = initializationHooks[i];

    if (typeof hook !== 'function') {
      logger.warn('تم العثور على hook غير صالح في قائمة التهيئة', {
        correlationId,
        hookIndex: i + 1,
        hookType: typeof hook,
      });
      continue;
    }

    try {
      await hook();
      logger.debug('اكتملت وظيفة تهيئة بدء التشغيل', {
        correlationId,
        hookIndex: i + 1,
        totalHooks: initializationHooks.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown';
      logger.error('فشلت وظيفة تهيئة بدء التشغيل', {
        correlationId,
        hookIndex: i + 1,
        totalHooks: initializationHooks.length,
        error: errorMessage,
      });
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info('اكتمل تنفيذ وظائف تهيئة بدء التشغيل', {
    correlationId,
    durationMs,
    hookCount: initializationHooks.length,
  });
}

/**
 * دالة مساعدة لتحديث حالة الاتصال بقاعدة البيانات.
 */
export function setDatabaseConnected(connected: boolean): void {
  updateStartupComponent('databaseConnected', connected);
  if (connected) {
    logger.debug('✅ تم الاتصال بقاعدة البيانات');
  } else {
    logger.warn('⚠️ فقدان الاتصال بقاعدة البيانات');
  }
}

/**
 * دالة مساعدة لتحديث حالة الاتصال بـ Redis.
 */
export function setRedisConnected(connected: boolean): void {
  updateStartupComponent('redisConnected', connected);
  if (connected) {
    logger.debug('✅ تم الاتصال بـ Redis');
  } else {
    logger.warn('⚠️ فقدان الاتصال بـ Redis');
  }
}

/**
 * دالة مساعدة لتحديث حالة تهيئة التتبع (OpenTelemetry).
 */
export function setTracingInitialized(initialized: boolean): void {
  updateStartupComponent('tracingInitialized', initialized);
  if (initialized) {
    logger.debug('✅ تم تهيئة التتبع الموزع');
  } else {
    logger.warn('⚠️ فشل تهيئة التتبع الموزع');
  }
}

/**
 * دالة مساعدة لتحديث حالة تهيئة قوائم الانتظار (BullMQ).
 */
export function setQueuesInitialized(initialized: boolean): void {
  updateStartupComponent('queuesInitialized', initialized);
  if (initialized) {
    logger.debug('✅ تم تهيئة قوائم الانتظار');
  } else {
    logger.warn('⚠️ فشل تهيئة قوائم الانتظار');
  }
}

/**
 * دالة مساعدة لفحص بدء التشغيل (Startup Probe).
 */
export function startupHandler(req: Request, res: Response): void {
  const correlationId = getCurrentCorrelationId() || 'startup-check';
  const startTime = Date.now();

  const options: StartupOptions = {
    ...DEFAULT_OPTIONS,
    ...(req.query && typeof req.query === 'object' ? req.query : {}),
  };

  const result: StartupStatus = {
    started: startupState.started,
    ...(startupState.started && {
      startedAt: startupState.startedAt?.toISOString(),
    }),
    timestamp: new Date().toISOString(),
    correlationId,
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    env: config.env.nodeEnv || 'unknown',
    details: {
      databaseConnected: startupState.databaseConnected,
      redisConnected: startupState.redisConnected,
      tracingInitialized: startupState.tracingInitialized,
      queuesInitialized: startupState.queuesInitialized,
      ...(startupState.started && {
        initializationDurationMs: startupState.initializationDurationMs,
      }),
    },
  };

  const durationMs = Date.now() - startTime;
  const logLevel = startupState.started ? 'debug' : 'info';
  logger[logLevel]('فحص بدء التشغيل', {
    correlationId,
    started: result.started,
    durationMs,
    uptime: result.uptime,
    details: result.details,
  });

  const statusCode = startupState.started ? 200 : 503;
  res.status(statusCode).json(result);
}

/**
 * دالة مساعدة للتحقق من بدء التشغيل (للبرمجة).
 */
export function checkStartup(options: StartupOptions = {}): StartupStatus {
  const correlationId = getCurrentCorrelationId() || 'startup-check';
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    started: startupState.started,
    ...(startupState.started && {
      startedAt: startupState.startedAt?.toISOString(),
    }),
    timestamp: new Date().toISOString(),
    correlationId,
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    env: config.env.nodeEnv || 'unknown',
    details: {
      databaseConnected: startupState.databaseConnected,
      redisConnected: startupState.redisConnected,
      tracingInitialized: startupState.tracingInitialized,
      queuesInitialized: startupState.queuesInitialized,
      ...(startupState.started && {
        initializationDurationMs: startupState.initializationDurationMs,
      }),
    },
  };
}

// ============================================================
// تصدير الكائن الافتراضي
// ============================================================

export default {
  initializeStartup,
  markStartupComplete,
  registerStartupHook,
  runStartupHooks,
  setDatabaseConnected,
  setRedisConnected,
  setTracingInitialized,
  setQueuesInitialized,
  startupHandler,
  checkStartup,
};

