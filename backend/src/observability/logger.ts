// ============================================================
// backend/src/observability/logger.ts
// ============================================================
// نظام التسجيل المتقدم (Pino + OpenTelemetry).
// تم إصلاح التبعية الدائرية مع config/index.ts عن طريق استخدام envConfig مباشرة.
// ============================================================

import pino, { Logger as PinoLogger, Level } from 'pino';
import { randomUUID } from 'crypto';
import { trace } from '@opentelemetry/api';
import { envConfig } from '../config/env.schema.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';

// ============================================================
// 1. تحديد الإعدادات الأساسية
// ============================================================

/**
 * مستوى التسجيل من envConfig أو القيمة الافتراضية.
 */
const LOG_LEVEL = envConfig?.LOG_LEVEL || 'info';

/**
 * بيئة التشغيل (development/production/test).
 */
const NODE_ENV = envConfig?.NODE_ENV || 'development';

/**
 * اسم الخدمة.
 */
const SERVICE_NAME = 'whatsapp-ai-agent';

// ============================================================
// 2. واجهة المُسجل المُوحَّدة (ILogger)
// ============================================================

export interface ILogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
  child: (bindings: Record<string, any>) => ILogger;
  level: string;
}

export interface LoggerOptions {
  level?: Level;
  prettyPrint?: boolean;
  serviceName?: string;
  includeTimestamp?: boolean;
}

// ============================================================
// 3. إنشاء المُسجل الأساسي (Pino)
// ============================================================

/**
 * إعدادات Pino.
 */
const pinoOptions: pino.LoggerOptions = {
  level: LOG_LEVEL,
  name: SERVICE_NAME,
  formatters: {
    level: (label: string) => ({ level: label }),
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    bindings: (bindings: Record<string, any>) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
      service: SERVICE_NAME,
      env: NODE_ENV,
    }),
    log: (obj) => ({
      msg: obj.message,
      err: obj.error,
    }),
  },
  base: {
    service: SERVICE_NAME,
    env: NODE_ENV,
  },
};

/**
 * إضافة التنسيق الجميل (pretty print) في بيئة التطوير.
 */
if (NODE_ENV === 'development') {
  pinoOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      singleLine: true,
    },
  };
}

/**
 * إنشاء المُسجل الأساسي.
 */
const pinoLogger: PinoLogger = pino(pinoOptions);

// ============================================================
// 4. ربط المُسجل بواجهة ILogger
// ============================================================

let currentLevel = pinoLogger.level;

function wrapPinoLogger(pino: PinoLogger): ILogger {
  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      pino.info(meta ? { message, ...meta } : { message });
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      pino.warn(meta ? { message, ...meta } : { message });
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      pino.error(meta ? { message, ...meta } : { message });
    },
    debug: (message: string, meta?: Record<string, unknown>) => {
      pino.debug(meta ? { message, ...meta } : { message });
    },
    child: (bindings: Record<string, any>) => {
      const correlationId = getCurrentCorrelationId() || bindings.correlationId;
      if (correlationId && !bindings.correlationId) {
        bindings.correlationId = correlationId;
      }
      const childPino = pino.child(bindings);
      return wrapPinoLogger(childPino);
    },
    get level() {
      return currentLevel;
    },
    set level(val: string) {
      currentLevel = val;
      pino.level = val as Level;
    },
  };
}

// ============================================================
// 5. التصدير الرئيسي
// ============================================================

/**
 * المُسجل المُصدَّر (ILogger).
 */
export const logger = wrapPinoLogger(pinoLogger);

/**
 * إنشاء مُسجل فرعي (بمعرف تتبّع).
 */
export function createChildLogger(bindings: Record<string, any>): ILogger {
  const correlationId = getCurrentCorrelationId() || bindings.correlationId || randomUUID();
  const { correlationId: _, ...restBindings } = bindings;
  return logger.child({
    correlationId,
    ...restBindings,
  });
}

/**
 * تسجيل خطأ مع كامل التفاصيل.
 */
export function logError(
  message: string,
  error: Error,
  context: Record<string, any> = {}
): void {
  const correlationId = getCurrentCorrelationId() || context.correlationId || randomUUID();
  logger.error(message, {
    correlationId,
    errorName: error.name,
    errorMessage: error.message,
    stack: error.stack,
    ...context,
  });
}

/**
 * تسجيل خطأ تشغيلي (غير حرج).
 */
export function logOperationalError(
  message: string,
  error: Error | string,
  context: Record<string, any> = {}
): void {
  const correlationId = getCurrentCorrelationId() || context.correlationId || randomUUID();
  const errorObj = typeof error === 'string' ? new Error(error) : error;
  logger.warn(message, {
    correlationId,
    errorName: errorObj.name || 'OperationalError',
    errorMessage: errorObj.message || String(error),
    ...context,
    operational: true,
  });
}

/**
 * إنشاء مُسجل لعملية محددة (قياس المدة، النجاح، الفشل).
 */
export function createOperationLogger(
  operationName: string,
  context: Record<string, any> = {}
): {
  start: () => void;
  end: (result?: Record<string, any>) => void;
  error: (error: Error, result?: Record<string, any>) => void;
} {
  const correlationId = getCurrentCorrelationId() || context.correlationId || randomUUID();
  const startTime = Date.now();
  const operationId = randomUUID();

  return {
    start: () => {
      logger.info('operation.start', {
        operationName,
        operationId,
        correlationId,
        ...context,
      });
    },
    end: (result: Record<string, any> = {}) => {
      const durationMs = Date.now() - startTime;
      logger.info('operation.end', {
        operationName,
        operationId,
        correlationId,
        durationMs,
        ...result,
        ...context,
      });
    },
    error: (error: Error, result: Record<string, any> = {}) => {
      const durationMs = Date.now() - startTime;
      logger.error('operation.error', {
        operationName,
        operationId,
        correlationId,
        durationMs,
        errorName: error.name,
        errorMessage: error.message,
        stack: error.stack,
        ...result,
        ...context,
      });
    },
  };
}

/**
 * تسجيل مقياس رقمي (Metric).
 */
export function logMetric(
  metricName: string,
  value: number,
  tags: Record<string, string | number | boolean> = {}
): void {
  const correlationId = getCurrentCorrelationId() || randomUUID();
  logger.info('metric', {
    metricName,
    value,
    correlationId,
    tags,
    timestamp: new Date().toISOString(),
  });
}

/**
 * تسجيل تتبّع (Trace) مع دعم OpenTelemetry.
 */
export function logTrace(
  traceName: string,
  data: Record<string, any> = {}
): void {
  const correlationId = getCurrentCorrelationId() || data.correlationId || randomUUID();

  let traceId: string | undefined;
  let spanId: string | undefined;
  try {
    const currentSpan = trace.getActiveSpan();
    if (currentSpan) {
      const spanContext = currentSpan.spanContext();
      if (spanContext) {
        traceId = spanContext.traceId;
        spanId = spanContext.spanId;
      }
    }
  } catch {
    // تجاهل أخطاء OpenTelemetry
  }

  logger.debug('trace', {
    traceName,
    correlationId,
    traceId,
    spanId,
    ...data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * الحصول على مستوى التسجيل الحالي.
 */
export function getLogLevel(): string {
  return logger.level;
}

/**
 * تغيير مستوى التسجيل.
 */
export function setLogLevel(level: Level): void {
  logger.level = level;
  logger.info('تم تغيير مستوى التسجيل', { level });
}

// ============================================================
// 6. تصدير أنواع للاستخدام الخارجي
// ============================================================

export type { PinoLogger, Level };

// ============================================================
// 7. تصدير افتراضي
// ============================================================

export default logger;