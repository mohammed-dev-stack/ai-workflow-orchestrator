// ============================================================
// backend/src/routes/auth.routes.ts
// ============================================================
// مسارات المصادقة — Login مع دعم tenantId فارغ أو null.
// تم إصلاح مخطط LoginSchema لقبول null و empty string وتحويلها إلى undefined.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthService } from '../services/auth.service.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import {
  ValidationError,
  UnauthorizedError,
  ConflictError,
  InternalServerError,
} from '../middlewares/errorHandler.middleware.js';

import { repositories } from '../db/index.js';
import { withRetryAndThrow } from '../utils/retry.js';

/**
 * مخططات التحقق من صحة المدخلات (Zod Schemas) — الفشل السريع.
 * ✅ تم إصلاح LoginSchema لقبول null و empty string وتحويلها إلى undefined.
 */
const LoginSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صالح').min(1, 'البريد الإلكتروني مطلوب'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
  tenantId: z
    .union([z.string().uuid('معرف المستأجر غير صالح'), z.literal(''), z.null()])
    .optional()
    .transform((val) => {
      // تحويل '' و null إلى undefined
      if (val === '' || val === null) return undefined;
      return val;
    }),
});

const RegisterSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صالح').min(1, 'البريد الإلكتروني مطلوب'),
  password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'),
  fullName: z.string().min(1, 'الاسم الكامل مطلوب').max(100, 'الاسم الكامل طويل جداً'),
  tenantId: z
    .union([z.string().uuid('معرف المستأجر غير صالح'), z.literal(''), z.null()])
    .optional()
    .transform((val) => {
      if (val === '' || val === null) return undefined;
      return val;
    }),
  role: z.enum(['ADMIN', 'AGENT', 'VIEWER']).optional(),
  phoneNumber: z.string().optional(),
});

const RefreshTokenSchema = z.object({
  refreshToken: z.string().uuid('Refresh Token غير صالح').min(1, 'Refresh Token مطلوب'),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'كلمة المرور الحالية مطلوبة'),
  newPassword: z.string().min(8, 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل'),
});

const UpdateProfileSchema = z.object({
  fullName: z.string().min(1, 'الاسم الكامل مطلوب').max(100, 'الاسم الكامل طويل جداً').optional(),
  email: z.string().email('البريد الإلكتروني غير صالح').optional(),
  phoneNumber: z.string().optional(),
});

const LogoutSchema = z.object({
  refreshToken: z.string().uuid('Refresh Token غير صالح').min(1, 'Refresh Token مطلوب'),
});

/**
 * مصنع (Factory) لإنشاء مسارات المصادقة مع حقن التبعيات.
 */
export function createAuthRoutes(
  authService: AuthService
): Router {
  const router = Router();

  /**
   * POST /api/auth/login
   * تسجيل الدخول.
   */
  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      // 1. التحقق من صحة المدخلات (الفشل السريع)
      const validatedData = LoginSchema.parse(req.body);

      // 2. تنقية المدخلات
      const sanitizedEmail = validatedData.email.trim().toLowerCase();
      const sanitizedPassword = validatedData.password.trim();

      // 3. استدعاء خدمة المصادقة
      const result = await authService.login({
        email: sanitizedEmail,
        password: sanitizedPassword,
        tenantId: validatedData.tenantId,
      });

      logger.info('تسجيل دخول ناجح عبر API', {
        correlationId,
        userId: result.user.userId,
        tenantId: result.user.tenantId,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/register
   * تسجيل مستخدم جديد.
   */
  router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      const validatedData = RegisterSchema.parse(req.body);
      const sanitizedEmail = validatedData.email.trim().toLowerCase();
      const sanitizedPassword = validatedData.password.trim();
      const sanitizedFullName = validatedData.fullName.trim();
      const sanitizedPhone = validatedData.phoneNumber?.trim();

      const result = await authService.register({
        email: sanitizedEmail,
        password: sanitizedPassword,
        fullName: sanitizedFullName,
        tenantId: validatedData.tenantId,
        role: validatedData.role,
        phoneNumber: sanitizedPhone,
      });

      logger.info('تسجيل مستخدم جديد ناجح عبر API', {
        correlationId,
        userId: result.user.userId,
        tenantId: result.user.tenantId,
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/refresh
   * تحديث توكن الوصول (Refresh Token).
   */
  router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      const validatedData = RefreshTokenSchema.parse(req.body);
      const result = await authService.refreshAccessToken(validatedData.refreshToken);

      logger.info('تحديث توكن ناجح عبر API', {
        correlationId,
        userId: result.user.userId,
        tenantId: result.user.tenantId,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/logout
   * تسجيل الخروج.
   */
  router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new UnauthorizedError('يجب المصادقة أولاً');
      }

      const validatedData = LogoutSchema.parse(req.body);
      await authService.logout(req.user.userId, validatedData.refreshToken);

      logger.info('تسجيل خروج ناجح عبر API', {
        correlationId,
        userId: req.user.userId,
        tenantId: req.user.tenantId,
      });

      res.status(200).json({
        success: true,
        message: 'تم تسجيل الخروج بنجاح',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/logout-all
   * تسجيل الخروج من جميع الأجهزة.
   */
  router.post('/logout-all', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new UnauthorizedError('يجب المصادقة أولاً');
      }

      await authService.logoutAll(req.user.userId);

      logger.info('تسجيل خروج من جميع الأجهزة ناجح عبر API', {
        correlationId,
        userId: req.user.userId,
        tenantId: req.user.tenantId,
      });

      res.status(200).json({
        success: true,
        message: 'تم تسجيل الخروج من جميع الأجهزة بنجاح',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/change-password
   * تغيير كلمة المرور (يتطلب مصادقة).
   */
  router.post('/change-password', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new UnauthorizedError('يجب المصادقة أولاً');
      }

      const validatedData = ChangePasswordSchema.parse(req.body);
      const sanitizedCurrentPassword = validatedData.currentPassword.trim();
      const sanitizedNewPassword = validatedData.newPassword.trim();

      await authService.changePassword({
        userId: req.user.userId,
        currentPassword: sanitizedCurrentPassword,
        newPassword: sanitizedNewPassword,
      });

      logger.info('تغيير كلمة المرور ناجح عبر API', {
        correlationId,
        userId: req.user.userId,
        tenantId: req.user.tenantId,
      });

      res.status(200).json({
        success: true,
        message: 'تم تغيير كلمة المرور بنجاح',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PUT /api/auth/profile
   * تحديث الملف الشخصي (يتطلب مصادقة).
   */
  router.put('/profile', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new UnauthorizedError('يجب المصادقة أولاً');
      }

      const validatedData = UpdateProfileSchema.parse(req.body);
      const sanitizedFullName = validatedData.fullName?.trim();
      const sanitizedEmail = validatedData.email?.trim().toLowerCase();
      const sanitizedPhone = validatedData.phoneNumber?.trim();

      const updatedUser = await authService.updateProfile({
        userId: req.user.userId,
        fullName: sanitizedFullName,
        email: sanitizedEmail,
        phoneNumber: sanitizedPhone,
      });

      logger.info('تحديث الملف الشخصي ناجح عبر API', {
        correlationId,
        userId: req.user.userId,
        tenantId: req.user.tenantId,
      });

      res.status(200).json({
        success: true,
        data: updatedUser,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/auth/me
   * الحصول على معلومات المستخدم الحالي (يتطلب مصادقة).
   */
  router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new UnauthorizedError('يجب المصادقة أولاً');
      }

      res.status(200).json({
        success: true,
        data: {
          userId: req.user.userId,
          tenantId: req.user.tenantId,
          email: req.user.email,
          fullName: req.user.fullName,
          role: req.user.role,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/validate
   * التحقق من صحة توكن الوصول (للخدمات الأخرى).
   */
  router.post('/validate', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedError('توكن مطلوب');
      }

      const token = authHeader.substring(7);
      const result = authService.validateAccessToken(token);

      res.status(200).json({
        success: result.isValid,
        data: result.isValid ? {
          userId: result.userId,
          tenantId: result.tenantId,
          email: result.email,
          role: result.role,
        } : null,
        error: result.isValid ? undefined : result.error,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * إنشاء مثيل AuthService مع التبعيات (حقن يدوي).
 */
function createAuthService(): AuthService {
  const userRepo = {
    findByEmail: (email: string) => repositories.user.findByEmail(email),
    findById: (id: string) => repositories.user.findById(id),
    findByTenantIdAndEmail: (tenantId: string, email: string) =>
      repositories.user.findByTenantIdAndEmail(tenantId, email),
    createUser: (data: any) => repositories.user.create(data),
    updateUser: (id: string, data: any) => repositories.user.update(id, data),
    updateLastLogin: (userId: string, loginAt: Date) =>
      repositories.user.updateLastLogin(userId, loginAt),
    findByRefreshToken: (refreshToken: string) =>
      repositories.user.findByRefreshToken(refreshToken),
    saveRefreshToken: (userId: string, refreshToken: string, expiresAt: Date) =>
      repositories.user.saveRefreshToken(userId, refreshToken, expiresAt),
    deleteRefreshToken: (userId: string, refreshToken: string) =>
      repositories.user.deleteRefreshToken(userId, refreshToken),
    deleteAllRefreshTokens: (userId: string) =>
      repositories.user.deleteAllRefreshTokens(userId),
  };

  const tenantRepo = {
    findById: (id: string) => repositories.tenant.findById(id),
    findByDomain: (domain: string) => repositories.tenant.findByDomain(domain),
  };

  return new AuthService(userRepo as any, tenantRepo as any);
}

const authService = createAuthService();
const authRoutes = createAuthRoutes(authService);

export default authRoutes;
