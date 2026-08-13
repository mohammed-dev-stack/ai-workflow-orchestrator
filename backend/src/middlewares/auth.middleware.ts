// ============================================================
// backend/src/middleware/auth.middleware.ts
// ============================================================
// وسيط المصادقة (JWT + RBAC) — الحل الأمني النهائي.
// ✅ تم إعادة كتابته بالكامل لاستخدام jwt.verify مع مفتاح config.jwt.secret.
// ✅ لا يقرأ أي شيء من user-id هيدر، بل يعتمد كلياً على Bearer Token.
// ✅ يدعم الأدوار: ADMIN | AGENT | VIEWER (متوافق مع Prisma Schema).
// ============================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';

/**
 * أنواع الأدوار المدعومة في النظام (RBAC).
 * يجب أن تتطابق مع enum UserRole في prisma/schema.prisma.
 */
export type UserRole = 'ADMIN' | 'AGENT' | 'VIEWER';

/**
 * هيكل البيانات المستخرجة من JWT token بعد التحقق.
 * يتم إرفاقها بـ req.user للاستخدام في وحدات التحكم والخدمات.
 */
export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: UserRole;
  email?: string;
  fullName?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

interface JWTPayload {
  userId: string;
  tenantId: string;
  role: UserRole;
  email?: string;
  fullName?: string;
  iat: number;
  exp: number;
}

/**
 * وسيط المصادقة الأساسي.
 * يتحقق من وجود JWT صالح في رأس Authorization (Bearer token).
 * يستخدم config.jwt.secret مباشرة من المصدر الموحد (SSoT).
 */
export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 1. استخراج التوكن من رأس Authorization
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('طلب بدون توكن مصادقة', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'الرجاء تقديم توكن مصادقة صالح (Bearer token)',
    });
    return;
  }

  const token = authHeader.substring(7);

  // 2. التحقق من صحة التوكن باستخدام JWT_SECRET من الإعدادات الموحدة
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;

    if (!decoded.userId || !decoded.tenantId || !decoded.role) {
      logger.error('توكن JWT يفتقد حقولاً إلزامية', {
        userId: decoded.userId,
        tenantId: decoded.tenantId,
        role: decoded.role,
      });
      res.status(401).json({
        error: 'INVALID_TOKEN',
        message: 'التوكن غير صالح أو يفتقد بيانات المستخدم',
      });
      return;
    }

    // 3. التحقق من أن الدور (role) مسموح به في النظام
    const allowedRoles: UserRole[] = ['ADMIN', 'AGENT', 'VIEWER'];
    if (!allowedRoles.includes(decoded.role)) {
      logger.error('دور غير مسموح به في التوكن', {
        role: decoded.role,
        userId: decoded.userId,
      });
      res.status(401).json({
        error: 'INVALID_ROLE',
        message: 'الدور المحدد في التوكن غير مسموح به',
      });
      return;
    }

    // 4. إرفاق بيانات المستخدم بـ req.user
    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      email: decoded.email,
      fullName: decoded.fullName,
    };

    logger.debug('مصادقة ناجحة', {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      path: req.path,
    });

    next();
  } catch (error) {
    let errorMessage = 'توكن غير صالح';
    let errorCode = 'INVALID_TOKEN';

    if (error instanceof jwt.TokenExpiredError) {
      errorMessage = 'انتهت صلاحية التوكن';
      errorCode = 'TOKEN_EXPIRED';
    } else if (error instanceof jwt.JsonWebTokenError) {
      errorMessage = 'التوكن غير صالح (توقيع أو تنسيق)';
      errorCode = 'INVALID_TOKEN_SIGNATURE';
    }

    logger.warn('فشل التحقق من JWT', {
      error: errorMessage,
      errorCode,
      path: req.path,
      ip: req.ip,
    });

    res.status(401).json({
      error: errorCode,
      message: errorMessage,
    });
    return;
  }
}

/**
 * وسيط المصادقة مع دعم RBAC.
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'يجب المصادقة أولاً للوصول إلى هذا المورد',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('محاولة وصول غير مصرح بها', {
        userId: req.user.userId,
        role: req.user.role,
        requiredRoles: allowedRoles,
        path: req.path,
      });
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'ليس لديك الصلاحية للوصول إلى هذا المورد',
      });
      return;
    }

    next();
  };
}

export const authMiddleware = authenticate;
export default {
  authenticate,
  authMiddleware,
  requireRole,
};