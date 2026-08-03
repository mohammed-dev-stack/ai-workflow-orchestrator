// ============================================================
// backend/src/middleware/errorHandler.middleware.ts
// ============================================================
// وسيط معالجة الأخطاء الموحّد.
// تم إصلاح مشكلة استيراد JsonWebTokenError و TokenExpiredError
// باستخدام default import من jsonwebtoken واستخدام الكلاسات مباشرة.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
// ✅ استيراد jsonwebtoken كافتراضي
import jwt from 'jsonwebtoken';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from './correlation.middleware.js';
import { config } from '../config/index.js';

// ============================================================
// فئات الأخطاء الأساسية
// ============================================================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: Record<string, any>;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    errorCode: string = 'INTERNAL_ERROR',
    details?: Record<string, any>,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = isOperational;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'غير مصرح بالوصول', details?: Record<string, any>) {
    super(message, 401, 'UNAUTHORIZED', details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'ليس لديك الصلاحية للوصول إلى هذا المورد', details?: Record<string, any>) {
    super(message, 403, 'FORBIDDEN', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'المورد غير موجود', details?: Record<string, any>) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'بيانات غير صالحة', details?: Record<string, any>) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'تضارب في البيانات', details?: Record<string, any>) {
    super(message, 409, 'CONFLICT', details);
  }
}

export class AIServiceError extends AppError {
  constructor(message: string = 'فشل خدمة الذكاء الاصطناعي', details?: Record<string, any>) {
    super(message, 503, 'AI_SERVICE_ERROR', details);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string = 'فشل قاعدة البيانات', details?: Record<string, any>) {
    super(message, 500, 'DATABASE_ERROR', details);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'تم تجاوز حد الطلبات', details?: Record<string, any>) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', details);
  }
}

export class IdempotencyError extends AppError {
  constructor(message: string = 'فشل التحقق من التكافؤ', details?: Record<string, any>) {
    super(message, 409, 'IDEMPOTENCY_ERROR', details);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'خطأ داخلي في الخادم', details?: Record<string, any>) {
    super(message, 500, 'INTERNAL_SERVER_ERROR', details, true);
  }
}

// ============================================================
// خيارات وسيط الأخطاء
// ============================================================

export interface ErrorHandlerOptions {
  includeStackTrace?: boolean;
  logStackTrace?: boolean;
}

const DEFAULT_OPTIONS: ErrorHandlerOptions = {
  includeStackTrace: config.env.isDevelopment,
  logStackTrace: true,
};

// ============================================================
// دوال مساعدة للتحويل
// ============================================================

function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * تحويل ZodError إلى ValidationError.
 */
function handleZodError(error: ZodError): ValidationError {
  const errorList = (error as any).errors || (error as any).issues || [];
  const details = errorList.map((err: any) => ({
    path: err.path?.join('.') || 'unknown',
    message: err.message || 'قيمة غير صالحة',
    code: err.code || 'invalid',
  }));

  return new ValidationError('بيانات الطلب غير صالحة', { errors: details });
}

/**
 * تحويل JWT errors إلى UnauthorizedError.
 * ✅ استخدمنا jwt.JsonWebTokenError و jwt.TokenExpiredError مباشرة.
 */
function handleJWTError(error: any): UnauthorizedError {
  let message = 'توكن غير صالح';
  let details: Record<string, any> = {};

  if (error instanceof jwt.TokenExpiredError) {
    message = 'انتهت صلاحية التوكن';
    details = { expiredAt: error.expiredAt };
  } else if (error instanceof jwt.JsonWebTokenError) {
    message = `توكن غير صالح: ${error.message}`;
  }

  return new UnauthorizedError(message, details);
}

function isOperationalError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.isOperational;
  }

  if (error instanceof ReferenceError || error instanceof TypeError || error instanceof SyntaxError) {
    return false;
  }

  if (error instanceof ZodError || error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
    return true;
  }

  return true;
}

// ============================================================
// وسيط معالجة الأخطاء الأساسي
// ============================================================

export function errorHandler(options: ErrorHandlerOptions = {}) {
  const opts: ErrorHandlerOptions = { ...DEFAULT_OPTIONS, ...options };

  return (err: any, req: Request, res: Response, next: NextFunction): void => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    let appError: AppError;
    let originalError = err;

    if (isAppError(err)) {
      appError = err;
    } else if (err instanceof ZodError) {
      appError = handleZodError(err);
    } else if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      appError = handleJWTError(err);
    } else if (err instanceof Error) {
      appError = new InternalServerError(
        err.message || 'خطأ داخلي في الخادم',
        { originalErrorName: err.name }
      );
      originalError = err;
    } else {
      appError = new InternalServerError(
        'خطأ غير معروف',
        { originalError: String(err) }
      );
    }

    const isOperational = isOperationalError(originalError);

    const errorLog = {
      event: 'error.handler',
      correlationId,
      statusCode: appError.statusCode,
      errorCode: appError.errorCode,
      message: appError.message,
      name: appError.name,
      isOperational,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
      userId: (req as any).user?.userId,
      tenantId: (req as any).user?.tenantId,
      timestamp: new Date().toISOString(),
    };

    if (appError.statusCode >= 500) {
      logger.error(JSON.stringify({
        ...errorLog,
        stack: opts.logStackTrace ? originalError.stack : undefined,
        details: appError.details,
      }));
    } else if (appError.statusCode >= 400) {
      logger.warn(JSON.stringify({
        ...errorLog,
        details: appError.details,
      }));
    } else {
      logger.info(JSON.stringify(errorLog));
    }

    const responseBody: Record<string, any> = {
      error: appError.errorCode,
      message: appError.message,
      statusCode: appError.statusCode,
      correlationId,
      timestamp: new Date().toISOString(),
    };

    if (appError.details && Object.keys(appError.details).length > 0) {
      if (config.env.isDevelopment || appError.statusCode < 500) {
        responseBody.details = appError.details;
      } else {
        responseBody.details = 'راجع السجلات للحصول على التفاصيل';
      }
    }

    if (opts.includeStackTrace && originalError.stack) {
      responseBody.stack = originalError.stack;
    }

    res.status(appError.statusCode).json(responseBody);
  };
}

export const catchAllErrorHandler = errorHandler();

// تصدير ZodError للاستخدام في أماكن أخرى
export { ZodError };

// ✅ لا نصدر JsonWebTokenError أو TokenExpiredError من هنا
// لأنها مستوردة من jwt وتستخدم مباشرة في الكود.
// إذا احتاجتها ملفات أخرى، يمكنها استيرادها مباشرة من 'jsonwebtoken'.
