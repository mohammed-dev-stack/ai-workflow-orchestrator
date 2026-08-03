// backend/src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';

/**
 * أنواع الأدوار المدعومة في النظام (RBAC).
 * تُستخدم للتحكم في الوصول على مستوى وحدات التحكم.
 */
export type UserRole = 'ADMIN' | 'AGENT' | 'VIEWER';

/**
 * هيكل البيانات المستخرجة من JWT token بعد التحقق.
 * يتم إرفاقها بـ req.user للاستخدام في وحدات التحكم والخدمات.
 */
export interface AuthenticatedUser {
  /** معرف المستخدم الفريد (UUID) */
  userId: string;

  /** معرف المستأجر (الشركة/المؤسسة) */
  tenantId: string;

  /** دور المستخدم في النظام */
  role: UserRole;

  /** البريد الإلكتروني للمستخدم (اختياري، للتوثيق) */
  email?: string;

  /** الاسم الكامل للمستخدم (اختياري، للعرض) */
  fullName?: string;
}

/**
 * توسيع واجهة Express.Request لإضافة حقل user.
 * يُستخدم بعد نجاح المصادقة لتمرير هوية المستخدم إلى وحدات التحكم.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * هيكل Payload JWT المتوقع في التوكن.
 * يجب أن يتطابق مع ما يُصدَر في خدمة المصادقة (auth.service.ts).
 */
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
 * يتحقق من وجود JWT صالح في رأس Authorization، ويستخرج هوية المستخدم.
 * إذا فشل التحقق، يُعيد استجابة 401 (Unauthorized) فوراً (فشل سريع).
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

  const token = authHeader.substring(7); // إزالة 'Bearer '

  // 2. التحقق من صحة التوكن باستخدام JWT_SECRET
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;

    // 3. التحقق من وجود الحقول الإلزامية في الـ Payload
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

    // 4. التحقق من أن الدور (role) مسموح به في النظام
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

    // 5. إرفاق بيانات المستخدم بـ req.user للاستخدام في الخطوات التالية
    req.user = {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      email: decoded.email,
      fullName: decoded.fullName,
    };

    // 6. تسجيل نجاح المصادقة (مع معرّف الارتباط الذي يُضاف في middleware سابق)
    logger.debug('مصادقة ناجحة', {
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      role: decoded.role,
      path: req.path,
    });

    next();
  } catch (error) {
    // 7. معالجة أخطاء JWT المتنوعة (انتهاء الصلاحية، توقيع غير صالح، إلخ)
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
 * وسيط المصادقة مع دعم RBAC (التحكم في الوصول القائم على الأدوار).
 * يُستخدم بعد `authenticate` لتقييد الوصول إلى وحدات تحكم معينة بناءً على دور المستخدم.
 *
 * مثال: `app.get('/admin', authenticate, requireRole(['ADMIN']), adminController);`
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. التأكد من وجود المستخدم في الطلب (تمت المصادقة مسبقاً)
    if (!req.user) {
      logger.error('محاولة الوصول إلى مورد محمي دون مصادقة مسبقة', {
        path: req.path,
        method: req.method,
      });
      res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'يجب المصادقة أولاً للوصول إلى هذا المورد',
      });
      return;
    }

    // 2. التحقق من أن دور المستخدم مسموح به
    const userRole = req.user.role;
    if (!allowedRoles.includes(userRole)) {
      logger.warn('محاولة وصول غير مصرح بها', {
        userId: req.user.userId,
        tenantId: req.user.tenantId,
        role: userRole,
        requiredRoles: allowedRoles,
        path: req.path,
        method: req.method,
      });
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'ليس لديك الصلاحية للوصول إلى هذا المورد',
      });
      return;
    }

    // 3. تسجيل نجاح التحقق من الصلاحية
    logger.debug('تم التحقق من الصلاحيات', {
      userId: req.user.userId,
      role: userRole,
      path: req.path,
    });

    next();
  };
}

/**
 * وسيط اختياري لاستخراج معرف المستأجر من الطلب (إما من التوكن أو من معامل الطلب).
 * يُستخدم في الحالات التي يُسمح فيها بتجاوز معرف المستأجر من التوكن (مثل واجهات الإدارة).
 */
export function extractTenantId(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 1. محاولة استخراج tenantId من التوكن (إذا كان المستخدم مصادقاً)
  if (req.user && req.user.tenantId) {
    // تم استخراج tenantId من التوكن، نمرره إلى next
    next();
    return;
  }

  // 2. محاولة استخراج tenantId من معاملات الطلب (للواجهات العامة أو ويب هوك WhatsApp)
  const tenantIdFromQuery = req.query.tenantId as string | undefined;
  const tenantIdFromBody = req.body?.tenantId as string | undefined;
  const tenantIdFromHeader = req.headers['x-tenant-id'] as string | undefined;

  const tenantId = tenantIdFromQuery || tenantIdFromBody || tenantIdFromHeader;

  if (!tenantId) {
    logger.warn('تعذر تحديد معرف المستأجر', {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(400).json({
      error: 'TENANT_ID_REQUIRED',
      message: 'معرف المستأجر مطلوب (في التوكن، أو header X-Tenant-Id، أو query parameter)',
    });
    return;
  }

  // 3. إضافة tenantId إلى req.user (إذا لم يكن موجوداً)
  if (!req.user) {
    // إنشاء مستخدم مؤقت للويب هوك أو الطلبات العامة
    req.user = {
      userId: 'system', // معرف نظامي للويب هوك
      tenantId,
      role: 'VIEWER', // دور افتراضي للويب هوك
    };
  } else {
    // إذا كان المستخدم موجوداً ولكن tenantId مفقود (حالة نادرة)، نضيفه
    req.user.tenantId = tenantId;
  }

  logger.debug('تم استخراج معرف المستأجر من الطلب', {
    tenantId,
    source: tenantIdFromQuery ? 'query' : tenantIdFromBody ? 'body' : 'header',
    path: req.path,
  });

  next();
}

// ============================================================
// إضافة تصدير اسم بديل (alias) لتوافق استيراد server.ts
// ============================================================

/**
 * اسم بديل لـ `authenticate` للتوافق مع استيرادات `server.ts` وملفات أخرى.
 */
export const authMiddleware = authenticate;

/**
 * تصدير افتراضي للملف لتوحيد الاستيراد.
 */
export default {
  authenticate,
  authMiddleware,
  requireRole,
  extractTenantId,
};
