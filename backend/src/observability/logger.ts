// backend/src/observability/logger.ts
import pino, { Logger as PinoLogger, LoggerOptions as PinoLoggerOptions, Level } from 'pino';

const options: PinoLoggerOptions = {
  level: 'info',
};
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import { trace, context } from '@opentelemetry/api';

/**
 * واجهة المُسجل المُصدَّر بتوقيع عام واحد.
 */
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

class LoggerSingleton {
  private static instance: PinoLogger | null = null;

  static getInstance(options: LoggerOptions = {}): PinoLogger {
    if (!this.instance) {
      this.instance = this.createLogger(options);
    }
    return this.instance;
  }

  private static createLogger(options: LoggerOptions): PinoLogger {
    const {
      level = config.observability.logLevel || 'info',
      prettyPrint = config.env.isDevelopment,
      serviceName = 'whatsapp-ai-agent',
      includeTimestamp = true,
    } = options;

    const pinoOptions: PinoLoggerOptions = {
  level,
  name: serviceName,
  formatters: {
    level: (label: string) => ({ level: label }),
    ...(includeTimestamp && {
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    }),
    bindings: (bindings: Record<string, any>) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
      service: serviceName,
      env: config.env.nodeEnv,
    }),
    log: (obj) => ({
      msg: obj.message,   // بديل عن messageKey
      err: obj.error,     // بديل عن errorKey
    }),
  },
  ...(prettyPrint && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: true,
      },
    },
  }),
  base: {
    service: serviceName,
    env: config.env.nodeEnv,
  },
};


    const logger = pino(pinoOptions);

    // تسجيل بدء التشغيل
    logger.info({
  msg: 'تم تهيئة المُسجل',
  level,
  prettyPrint,
  serviceName,
  env: config.env.nodeEnv,
});


    return logger;
  }

  static resetInstance(): void {
    this.instance = null;
  }
}

/**
 * المُسجل الداخلي (Pino).
 */
const pinoLogger = LoggerSingleton.getInstance();

/**
 * دالة مساعدة لإنشاء ILogger من PinoLogger.
 */
function wrapPinoLogger(pino: PinoLogger): ILogger {
  // الحصول على مستوى التسجيل الحالي
  let currentLevel = pino.level;

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

/**
 * المُسجل المُصدَّر (ILogger).
 * جميع الدوال لها توقيع عام واحد: (message: string, meta?: Record<string, unknown>) => void
 */
export const logger = wrapPinoLogger(pinoLogger);

export function createChildLogger(bindings: Record<string, any>): ILogger {
  const correlationId = getCurrentCorrelationId() || bindings.correlationId || randomUUID();
  const { correlationId: _, ...restBindings } = bindings;
  return logger.child({
    correlationId,
    ...restBindings,
  });
}

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

export function getLogLevel(): string {
  return logger.level;
}

export function setLogLevel(level: Level): void {
  logger.level = level;
  logger.info('تم تغيير مستوى التسجيل', { level });
}

export default logger;

export type { PinoLogger, Level };

