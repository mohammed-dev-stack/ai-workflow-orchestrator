// المسار: backend/src/utils/errorHandler.ts

import { Request, Response, NextFunction } from 'express';
import logger from './logger';

// ============================================
// TYPES
// ============================================

interface ErrorDetails {
  [key: string]: unknown;
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

/**
 * Custom error class with status code
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: ErrorDetails;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    details?: ErrorDetails
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

// ============================================
// ERROR TYPE GUARDS
// ============================================

const isMongoError = (err: unknown): err is { name: string; code: number; keyValue?: ErrorDetails } => {
  return (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: string }).name === 'MongoError'
  );
};

const isCastError = (err: unknown): err is { name: string; kind: string; path: string } => {
  return (
    err !== null &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name: string }).name === 'CastError'
  );
};

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

/**
 * Global error handler middleware
 * Handles all errors thrown in the application
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Default values
  let statusCode = 500;
  let message = 'Internal Server Error';
  let details: ErrorDetails | null = null;
  const isProduction = process.env.NODE_ENV === 'production';

  // Check if it's our custom AppError
  if (err instanceof AppError) {
    statusCode = err.statusCode || 500;
    message = err.message;
    details = err.details || null;
  } else if (err.name === 'ValidationError') {
    // Mongoose validation error
    statusCode = 400;
    message = 'Validation Error';
    details = (err as { errors?: ErrorDetails }).errors || null;
  } else if (isCastError(err)) {
    // Mongoose cast error (invalid ObjectId)
    statusCode = 400;
    message = 'Invalid ID format';
  } else if (isMongoError(err) && err.code === 11000) {
    // Duplicate key error
    statusCode = 409;
    message = 'Duplicate entry found';
    details = err.keyValue || null;
  } else if (err.message && err.message.includes('ECONNREFUSED')) {
    // Database connection error
    statusCode = 503;
    message = 'Database connection unavailable';
  } else if (err.message && (err.message.includes('BullMQ') || err.message.includes('Redis'))) {
    // Queue/Redis error
    statusCode = 503;
    message = 'Queue service temporarily unavailable';
  } else if (err.message && err.message.includes('timeout')) {
    // Timeout errors
    statusCode = 504;
    message = 'Request timeout';
  }

  // Log the error with appropriate severity
  if (statusCode >= 500) {
    logger.error(`❌ Server Error: ${err.message}`, {
      stack: err.stack,
      statusCode,
      path: req.path,
      method: req.method,
      ip: req.ip || req.socket.remoteAddress,
      requestId: req.headers['x-request-id'],
      details,
    });
  } else {
    logger.warn(`⚠️ Client Error: ${err.message}`, {
      statusCode,
      path: req.path,
      method: req.method,
      ip: req.ip || req.socket.remoteAddress,
      requestId: req.headers['x-request-id'],
      details,
    });
  }

  // Build response payload
  const responsePayload: {
    success: boolean;
    message: string;
    details?: ErrorDetails;
    stack?: string;
  } = {
    success: false,
    message,
  };

  // Add details in non-production or for operational errors
  if (details && (!isProduction || err instanceof AppError)) {
    responsePayload.details = details;
  }

  // Add stack trace in development only
  if (!isProduction && err.stack) {
    responsePayload.stack = err.stack;
  }

  res.status(statusCode).json(responsePayload);
};

// ============================================
// NOT FOUND HANDLER
// ============================================

/**
 * Not found handler (404)
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const err = new AppError(
    `Route ${req.method} ${req.originalUrl} not found`,
    404,
    true
  );
  next(err);
};

// ============================================
// ASYNC WRAPPER
// ============================================

/**
 * Async wrapper to catch errors in async route handlers
 * Automatically passes errors to the error handler
 */
export const catchAsync = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): ((req: Request, res: Response, next: NextFunction) => void) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// ============================================
// ERROR FACTORY FUNCTIONS
// ============================================

/**
 * Helper to create common error types
 */
export const errorTypes = {
  badRequest: (message: string = 'Bad Request', details?: ErrorDetails): AppError =>
    new AppError(message, 400, true, details),

  unauthorized: (message: string = 'Unauthorized', details?: ErrorDetails): AppError =>
    new AppError(message, 401, true, details),

  forbidden: (message: string = 'Forbidden', details?: ErrorDetails): AppError =>
    new AppError(message, 403, true, details),

  notFound: (message: string = 'Not Found', details?: ErrorDetails): AppError =>
    new AppError(message, 404, true, details),

  conflict: (message: string = 'Conflict', details?: ErrorDetails): AppError =>
    new AppError(message, 409, true, details),

  validation: (message: string = 'Validation Error', details?: ErrorDetails): AppError =>
    new AppError(message, 422, true, details),

  tooManyRequests: (message: string = 'Too Many Requests', details?: ErrorDetails): AppError =>
    new AppError(message, 429, true, details),

  internal: (message: string = 'Internal Server Error', details?: ErrorDetails): AppError =>
    new AppError(message, 500, false, details),

  serviceUnavailable: (message: string = 'Service Unavailable', details?: ErrorDetails): AppError =>
    new AppError(message, 503, false, details),

  timeout: (message: string = 'Request Timeout', details?: ErrorDetails): AppError =>
    new AppError(message, 504, false, details),
};

// ============================================
// DEFAULT EXPORT
// ============================================

export default errorHandler;