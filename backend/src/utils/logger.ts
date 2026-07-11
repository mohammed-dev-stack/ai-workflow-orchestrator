// المسار: backend/src/utils/logger.ts

import winston from 'winston';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// ============================================
// LOG DIRECTORY SETUP
// ============================================

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ============================================
// LOG LEVELS & COLORS
// ============================================

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'cyan',
};

winston.addColors(colors);

// ============================================
// LOG LEVEL DETECTION
// ============================================

const getLogLevel = (): string => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'info';
};

// ============================================
// CUSTOM FORMATS
// ============================================

// Console format (development)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    const metaKeys = Object.keys(meta);

    // Filter out sensitive data
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'authorization'];
    const filteredMeta: Record<string, unknown> = {};

    for (const key of metaKeys) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        filteredMeta[key] = '[REDACTED]';
      } else {
        filteredMeta[key] = meta[key];
      }
    }

    if (Object.keys(filteredMeta).length > 0) {
      metaStr = `\n${JSON.stringify(filteredMeta, null, 2)}`;
    }

    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// File format (production)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// HTTP log format
const httpFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, method, url, status, responseTime, ip, requestId }) => {
    return `[${timestamp}] ${level}: ${method} ${url} ${status} ${responseTime || '-'}ms - ${ip || '-'} [${requestId || '-'}]`;
  })
);

// ============================================
// SENSITIVE DATA FILTERING
// ============================================

const sensitiveFields = [
  'password',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'session',
  'creditCard',
  'cvv',
  'ssn',
];

export const redactSensitiveData = (data: unknown): unknown => {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    if (sensitiveFields.some((field) => keyLower.includes(field))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
};

// ============================================
// MAIN LOGGER INSTANCE
// ============================================

const logger = winston.createLogger({
  level: getLogLevel(),
  levels,
  format: fileFormat,
  transports: [
    // Console transport
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          )
        : consoleFormat,
      handleExceptions: true,
    }),

    // Error log file
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
    }),

    // Combined log file
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: fileFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
  exitOnError: false,
});

// ============================================
// HTTP LOGGER
// ============================================

export const httpLogger = winston.createLogger({
  level: 'http',
  levels,
  format: httpFormat,
  transports: [
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.printf(({ level, message }) => `${level}: ${message}`)
          ),
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'http.log'),
      format: fileFormat,
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// ============================================
// LOGGER HELPERS
// ============================================

/**
 * Create a child logger with module context
 */
export const getLogger = (module: string): winston.Logger => {
  return logger.child({ module });
};

/**
 * HTTP request logging middleware
 */
export const logHttp = (req: Request, res: Response, next: NextFunction): void => {
  const start = Date.now();
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();

  // Store requestId in request object for later use
  (req as Request & { requestId: string }).requestId = requestId;

  res.on('finish', (): void => {
    const responseTime = Date.now() - start;
    httpLogger.http({
      message: 'HTTP Request',
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      responseTime,
      ip: req.ip || req.socket.remoteAddress,
      requestId,
      userAgent: req.get('user-agent'),
    });
  });

  next();
};

// ============================================
// LOGGER UTILITIES
// ============================================

/**
 * Log a message with sensitive data redaction
 */
export const logSecure = (
  level: keyof typeof levels,
  message: string,
  data?: Record<string, unknown>
): void => {
  const redactedData = data ? redactSensitiveData(data) : undefined;
  logger.log(level, message, redactedData);
};

/**
 * Log an error with full context
 */
export const logError = (
  error: Error,
  context?: Record<string, unknown>,
  message?: string
): void => {
  const errorContext = {
    ...context,
    errorName: error.name,
    errorMessage: error.message,
    stack: error.stack,
  };
  const redactedContext = redactSensitiveData(errorContext) as Record<string, unknown>;
  logger.error(message || error.message, redactedContext);
};

/**
 * Create a request-scoped logger
 */
export const createRequestLogger = (req: Request): winston.Logger => {
  const requestId = (req as Request & { requestId: string }).requestId || crypto.randomUUID();
  const correlationId = (req.headers['x-correlation-id'] as string) || requestId;

  return logger.child({
    requestId,
    correlationId,
    ip: req.ip || req.socket.remoteAddress,
    method: req.method,
    path: req.path,
  });
};
export default logger;
