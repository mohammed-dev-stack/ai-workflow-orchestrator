// ============================================================
// backend/src/middleware/logging.middleware.ts
// ============================================================
// وسيط التسجيل المنظم (Structured Logging Middleware)
// تم إصلاح مشكلة `Object is possibly 'undefined'` وأخطاء `res.end.apply`.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from './correlation.middleware.js';
import { config } from '../config/index.js';

/**
 * قائمة برؤوس HTTP التي تحتوي على بيانات حساسة ويجب تنقيتها من السجلات.
 */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
  'authentication',
  'proxy-authorization',
]);

/**
 * قائمة بحقول الجسم (body) التي تحتوي على بيانات حساسة ويجب تنقيتها.
 */
const SENSITIVE_BODY_FIELDS = new Set([
  'password',
  'confirmPassword',
  'oldPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'apiSecret',
  'secret',
  'creditCard',
  'cvv',
  'ssn',
  'nationalId',
  'phoneNumber',
  'email',
]);

/**
 * خيارات وسيط التسجيل.
 */
export interface LoggingMiddlewareOptions {
  logRequestBody?: boolean;
  logResponseBody?: boolean;
  excludePaths?: string[];
}

/**
 * القيم الافتراضية لخيارات وسيط التسجيل.
 */
const DEFAULT_OPTIONS: LoggingMiddlewareOptions = {
  logRequestBody: false,
  logResponseBody: false,
  excludePaths: ['/health', '/liveness', '/readiness', '/startup', '/metrics'],
};

/**
 * تنقية الرؤوس (Headers) من البيانات الحساسة.
 */
function sanitizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  const sanitized: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * تنقية جسم الطلب (Body) من البيانات الحساسة.
 * ✅ تم إصلاح مشكلة `parts[0]` المحتملة بأن تكون `undefined`.
 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  if (Array.isArray(body)) {
    return body.map((item) => sanitizeBody(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    const lowerKey = key.toLowerCase();

    if (SENSITIVE_BODY_FIELDS.has(lowerKey)) {
      // ✅ تنظيف جزئي للبريد الإلكتروني مع التحقق من وجود `parts[0]`
      if (lowerKey === 'email' && typeof value === 'string') {
        const parts = value.split('@');
        if (parts.length === 2 && parts[0] && parts[0].length > 2) {
          sanitized[key] = `${parts[0].substring(0, 2)}***@${parts[1]}`;
        } else {
          sanitized[key] = '[REDACTED]';
        }
      } else if (lowerKey === 'phonenumber' && typeof value === 'string' && value.length > 6) {
        const visibleStart = value.substring(0, 3);
        const visibleEnd = value.substring(value.length - 2);
        sanitized[key] = `${visibleStart}***${visibleEnd}`;
      } else {
        sanitized[key] = '[REDACTED]';
      }
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeBody(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * وسيط التسجيل المنظم (Structured Logging Middleware).
 * ✅ تم إصلاح مشكلة `res.end.apply` باستخدام `res.on('finish')` بدلاً من إعادة تعريف `res.end`.
 */
export function loggingMiddleware(options: LoggingMiddlewareOptions = {}): (req: Request, res: Response, next: NextFunction) => void {
  const opts: LoggingMiddlewareOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. التحقق مما إذا كان المسار مستثنى من التسجيل
    if (opts.excludePaths?.includes(req.path)) {
      return next();
    }

    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    // 2. تنقية الرؤوس
    const sanitizedHeaders = sanitizeHeaders(req.headers as Record<string, string | string[] | undefined>);

    // 3. تنقية جسم الطلب (إذا كان مسموحاً)
    let sanitizedBody: any = undefined;
    if (opts.logRequestBody && req.body && Object.keys(req.body).length > 0) {
      try {
        sanitizedBody = sanitizeBody(req.body);
      } catch (error) {
        logger.warn('فشل تنقية جسم الطلب للتسجيل', {
          correlationId,
          error: error instanceof Error ? error.message : 'unknown',
        });
        sanitizedBody = '[UNABLE_TO_SANITIZE]';
      }
    }

    // 4. تسجيل بداية الطلب
    const logEntry = {
      event: 'http.request.start',
      correlationId,
      method: req.method,
      path: req.path,
      query: req.query,
      headers: sanitizedHeaders,
      body: sanitizedBody,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
      timestamp: new Date().toISOString(),
    };

    logger.info(JSON.stringify(logEntry));

    const startTime = Date.now();
    let responseBody: any = undefined;
    let isResponseBodyCaptured = false;

    // 5. تزيين (decorate) دالة res.json لتسجيل جسم الاستجابة
    if (opts.logResponseBody) {
      const originalJson = res.json.bind(res);
      res.json = function (this: Response, body: any): Response {
        try {
          responseBody = sanitizeBody(body);
          isResponseBodyCaptured = true;
        } catch (error) {
          logger.warn('فشل تنقية جسم الاستجابة للتسجيل (json)', {
            correlationId,
            error: error instanceof Error ? error.message : 'unknown',
          });
          responseBody = '[UNABLE_TO_SANITIZE]';
          isResponseBodyCaptured = true;
        }
        return originalJson(body);
      };

      // تزيين دالة res.send لتسجيل جسم الاستجابة
      const originalSend = res.send.bind(res);
      res.send = function (this: Response, body: any): Response {
        try {
          if (typeof body === 'object' && body !== null) {
            responseBody = sanitizeBody(body);
            isResponseBodyCaptured = true;
          } else if (typeof body === 'string') {
            try {
              const parsed = JSON.parse(body);
              responseBody = sanitizeBody(parsed);
              isResponseBodyCaptured = true;
            } catch {
              responseBody = body.substring(0, 1000);
              isResponseBodyCaptured = true;
            }
          } else {
            responseBody = body;
            isResponseBodyCaptured = true;
          }
        } catch (error) {
          logger.warn('فشل تنقية جسم الاستجابة للتسجيل (send)', {
            correlationId,
            error: error instanceof Error ? error.message : 'unknown',
          });
          responseBody = '[UNABLE_TO_SANITIZE]';
          isResponseBodyCaptured = true;
        }
        return originalSend(body);
      };
    }

    // 6. ✅ استخدام `res.on('finish')` بدلاً من إعادة تعريف `res.end`
    // هذا يحل مشكلة `Argument of type 'any[]'` نهائياً.
    res.on('finish', () => {
      const durationMs = Date.now() - startTime;

      // الحصول على حجم الاستجابة
      let contentLength: number = 0;
      const contentLengthHeader = res.getHeader('content-length');
      if (contentLengthHeader) {
        contentLength = typeof contentLengthHeader === 'number' ? contentLengthHeader : parseInt(contentLengthHeader as string) || 0;
      } else if (isResponseBodyCaptured && responseBody) {
        try {
          contentLength = JSON.stringify(responseBody).length;
        } catch {
          contentLength = 0;
        }
      }

      // بناء سجل الانتهاء
      const endLogEntry = {
        event: 'http.request.end',
        correlationId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        statusMessage: res.statusMessage || 'OK',
        durationMs,
        contentLength,
        responseBody: opts.logResponseBody && isResponseBodyCaptured ? responseBody : undefined,
        timestamp: new Date().toISOString(),
      };

      // تسجيل حسب حالة الاستجابة
      const logLevel = res.statusCode >= 400 ? 'error' : 'info';
      if (logLevel === 'error') {
        logger.error(JSON.stringify(endLogEntry));
      } else {
        logger.info(JSON.stringify(endLogEntry));
      }
    });

    // 7. تمرير الطلب إلى الـ middleware التالي
    next();
  };
}

/**
 * وسيط تسجيل الأخطاء (Error Logging Middleware).
 */
export function errorLoggingMiddleware(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

  const errorLogEntry = {
    event: 'http.error',
    correlationId,
    method: req.method,
    path: req.path,
    statusCode: err.statusCode || err.status || 500,
    errorName: err.name || 'Error',
    errorMessage: err.message || 'Unknown error',
    errorStack: err.stack,
    timestamp: new Date().toISOString(),
  };

  logger.error(JSON.stringify(errorLogEntry));
  next(err);
}
