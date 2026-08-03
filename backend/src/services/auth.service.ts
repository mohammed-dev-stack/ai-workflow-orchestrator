// ============================================================
// backend/src/services/auth.service.ts
// ============================================================
// خدمة المصادقة (Authentication Service)
// تم إصلاح أخطاء TypeScript في parseExpiryToSeconds.
// ============================================================

import { compare, hash } from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import {
  UnauthorizedError,
  ValidationError,
  ConflictError,
  NotFoundError,
  InternalServerError,
  AppError,
} from '../middlewares/errorHandler.middleware.js';
import { withRetryAndThrow } from '../utils/retry.js';
import { requireConfig } from '../config/index.js';

// ============================================================
// واجهات المستودعات
// ============================================================

export interface IUserRepository {
  findByEmail(email: string): Promise<any>;
  findById(userId: string): Promise<any>;
  findByTenantIdAndEmail(tenantId: string, email: string): Promise<any>;
  createUser(data: any): Promise<any>;
  updateUser(userId: string, data: any): Promise<any>;
  updateLastLogin(userId: string, loginAt: Date): Promise<void>;
  findByRefreshToken(refreshToken: string): Promise<any>;
  saveRefreshToken(userId: string, refreshToken: string, expiresAt: Date): Promise<void>;
  deleteRefreshToken(userId: string, refreshToken: string): Promise<void>;
  deleteAllRefreshTokens(userId: string): Promise<void>;
}

export interface ITenantRepository {
  findById(tenantId: string): Promise<any>;
  findByDomain(domain: string): Promise<any>;
}

export interface AuthOptions {
  accessTokenExpiry?: string;
  refreshTokenExpiry?: string;
  validateTenant?: boolean;
  idempotencyKey?: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  tenantId?: string;
}

export interface RegisterData {
  email: string;
  password: string;
  fullName: string;
  tenantId?: string;
  role?: 'ADMIN' | 'AGENT' | 'VIEWER';
  phoneNumber?: string;
}

export interface ChangePasswordData {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export interface UpdateProfileData {
  userId: string;
  fullName?: string;
  email?: string;
  phoneNumber?: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    userId: string;
    tenantId: string;
    email: string;
    fullName: string;
    role: string;
    permissions?: string[];
  };
}

export interface TokenValidationResult {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  isValid: boolean;
  error?: string;
}

// ============================================================
// خدمة المصادقة
// ============================================================

export class AuthService {
  private userRepo: IUserRepository;
  private tenantRepo: ITenantRepository;

  constructor(userRepo: IUserRepository, tenantRepo: ITenantRepository) {
    this.userRepo = userRepo;
    this.tenantRepo = tenantRepo;
  }

  // ============================================================
  // دوال مساعدة
  // ============================================================

  private validateEmail(email: string): boolean {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
  }

  private validatePassword(password: string): { valid: boolean; message?: string } {
    if (password.length < 8) {
      return { valid: false, message: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' };
    }
    if (!/[A-Z]/.test(password)) {
      return { valid: false, message: 'كلمة المرور يجب أن تحتوي على حرف كبير واحد على الأقل' };
    }
    if (!/[a-z]/.test(password)) {
      return { valid: false, message: 'كلمة المرور يجب أن تحتوي على حرف صغير واحد على الأقل' };
    }
    if (!/[0-9]/.test(password)) {
      return { valid: false, message: 'كلمة المرور يجب أن تحتوي على رقم واحد على الأقل' };
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      return { valid: false, message: 'كلمة المرور يجب أن تحتوي على حرف خاص واحد على الأقل' };
    }
    return { valid: true };
  }

  /**
   * توليد JWT (Access Token).
   * ✅ تم إصلاح: استخدام as any لتجاوز مشكلة نوع expiresIn.
   */
  private generateAccessToken(
    userId: string,
    tenantId: string,
    role: string,
    email: string,
    fullName: string
  ): string {
    const payload = {
      userId,
      tenantId,
      role,
      email,
      fullName,
    };
    const expiresIn = config.jwt.expiry || '7d';
    const secret = requireConfig(config.jwt.secret, 'JWT_SECRET');
    // ✅ استخدام as any لتجاوز مشكلة نوع expiresIn (StringValue vs string)
    return jwt.sign(payload, secret, { expiresIn: expiresIn as any });
  }

  private generateRefreshToken(): string {
    return randomUUID();
  }

  /**
   * تحويل مدة الصلاحية من نص (مثل '7d') إلى ثواني.
   * ✅ تم إصلاح بالكامل: التحقق الآمن من match[1] و match[2] و units[unitStr].
   */
  private parseExpiryToSeconds(expiry: string): number {
    const units: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
      w: 604800,
    };

    const match = expiry.match(/^(\d+)([smhdw])$/);
    if (!match) {
      // إذا لم يتطابق النمط، نستخدم القيمة الافتراضية (7 أيام)
      return 604800;
    }

    // استخراج الأجزاء مع التحقق من وجودها
    const valueStr = match[1];
    const unitStr = match[2];
    if (!valueStr || !unitStr) {
      return 604800;
    }

    const value = parseInt(valueStr, 10);
    const multiplier = units[unitStr];
    if (multiplier === undefined) {
      return 604800;
    }

    return value * multiplier;
  }

  private calculateRefreshTokenExpiry(refreshTokenExpiry: string): Date {
    const seconds = this.parseExpiryToSeconds(refreshTokenExpiry);
    return new Date(Date.now() + seconds * 1000);
  }

  // ============================================================
  // تسجيل الدخول (Login)
  // ============================================================

  async login(credentials: LoginCredentials, options: AuthOptions = {}): Promise<AuthResponse> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { email, password, tenantId: providedTenantId } = credentials;
    const {
      validateTenant = true,
      idempotencyKey,
      accessTokenExpiry = config.jwt.expiry || '7d',
      refreshTokenExpiry = '30d',
    } = options;

    if (!email || !password) {
      logger.warn('محاولة تسجيل دخول ببيانات ناقصة', {
        correlationId,
        hasEmail: !!email,
        hasPassword: !!password,
        idempotencyKey,
      });
      throw new ValidationError('البريد الإلكتروني وكلمة المرور مطلوبان');
    }

    if (!this.validateEmail(email)) {
      logger.warn('محاولة تسجيل دخول ببريد إلكتروني غير صالح', {
        correlationId,
        email,
        idempotencyKey,
      });
      throw new ValidationError('البريد الإلكتروني غير صالح');
    }

    const sanitizedEmail = email.trim().toLowerCase();
    const sanitizedPassword = password.trim();

    let user: any;
    try {
      if (providedTenantId) {
        user = await withRetryAndThrow(
          () => this.userRepo.findByTenantIdAndEmail(providedTenantId, sanitizedEmail),
          {
            operationName: 'auth.login.findUserByTenant',
            idempotencyKey,
            maxAttempts: 3,
            verboseLogging: false,
          }
        );
      } else {
        user = await withRetryAndThrow(
          () => this.userRepo.findByEmail(sanitizedEmail),
          {
            operationName: 'auth.login.findUserByEmail',
            idempotencyKey,
            maxAttempts: 3,
            verboseLogging: false,
          }
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('فشل البحث عن المستخدم أثناء تسجيل الدخول', {
        correlationId,
        email: sanitizedEmail,
        tenantId: providedTenantId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل البحث عن المستخدم، يرجى المحاولة مرة أخرى');
    }

    if (!user) {
      logger.warn('محاولة تسجيل دخول بمستخدم غير موجود', {
        correlationId,
        email: sanitizedEmail,
        tenantId: providedTenantId,
        idempotencyKey,
      });
      throw new UnauthorizedError('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    if (validateTenant && providedTenantId) {
      const tenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(providedTenantId),
        {
          operationName: 'auth.login.validateTenant',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
      if (!tenant) {
        logger.warn('محاولة تسجيل دخول لمستأجر غير موجود', {
          correlationId,
          tenantId: providedTenantId,
          email: sanitizedEmail,
          idempotencyKey,
        });
        throw new ValidationError('المستأجر غير موجود');
      }
      if (user.tenantId !== providedTenantId) {
        logger.warn('محاولة تسجيل دخول لمستخدم لا ينتمي للمستأجر المحدد', {
          correlationId,
          userId: user.id,
          userTenantId: user.tenantId,
          providedTenantId,
          idempotencyKey,
        });
        throw new UnauthorizedError('المستخدم لا ينتمي إلى هذا المستأجر');
      }
    }

    const isPasswordValid = await compare(sanitizedPassword, user.passwordHash);
    if (!isPasswordValid) {
      logger.warn('محاولة تسجيل دخول بكلمة مرور غير صحيحة', {
        correlationId,
        userId: user.id,
        email: sanitizedEmail,
        tenantId: user.tenantId,
        idempotencyKey,
      });
      throw new UnauthorizedError('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }

    if (user.status === 'BLOCKED' || user.status === 'INACTIVE') {
      logger.warn('محاولة تسجيل دخول من مستخدم محظور أو غير نشط', {
        correlationId,
        userId: user.id,
        email: sanitizedEmail,
        status: user.status,
        idempotencyKey,
      });
      throw new UnauthorizedError('الحساب غير نشط أو محظور، يرجى التواصل مع الدعم');
    }

    try {
      await this.userRepo.updateLastLogin(user.id, new Date());
    } catch (error) {
      logger.error('فشل تحديث آخر تسجيل دخول', {
        correlationId,
        userId: user.id,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
    }

    const accessToken = this.generateAccessToken(
      user.id,
      user.tenantId,
      user.role,
      user.email,
      user.fullName
    );
    const refreshToken = this.generateRefreshToken();

    const refreshTokenExpiryDate = this.calculateRefreshTokenExpiry(refreshTokenExpiry);
    try {
      await this.userRepo.saveRefreshToken(user.id, refreshToken, refreshTokenExpiryDate);
    } catch (error) {
      logger.error('فشل حفظ Refresh Token', {
        correlationId,
        userId: user.id,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل حفظ جلسة المصادقة، يرجى المحاولة مرة أخرى');
    }

    const expiresInSeconds = this.parseExpiryToSeconds(accessTokenExpiry);

    logger.info('تسجيل دخول ناجح', {
      correlationId,
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
      idempotencyKey,
      event: 'auth.login.success',
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: expiresInSeconds,
      user: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        permissions: user.permissions || [],
      },
    };
  }

  // ============================================================
  // تسجيل مستخدم جديد (Register)
  // ============================================================

  async register(data: RegisterData, options: AuthOptions = {}): Promise<AuthResponse> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { email, password, fullName, tenantId: providedTenantId, role = 'VIEWER', phoneNumber } = data;
    const {
      validateTenant = true,
      idempotencyKey,
      accessTokenExpiry = config.jwt.expiry || '7d',
      refreshTokenExpiry = '30d',
    } = options;

    if (!email || !password || !fullName) {
      logger.warn('محاولة تسجيل ببيانات ناقصة', {
        correlationId,
        hasEmail: !!email,
        hasPassword: !!password,
        hasFullName: !!fullName,
        idempotencyKey,
      });
      throw new ValidationError('البريد الإلكتروني، كلمة المرور، والاسم الكامل مطلوبة');
    }

    if (!this.validateEmail(email)) {
      logger.warn('محاولة تسجيل ببريد إلكتروني غير صالح', {
        correlationId,
        email,
        idempotencyKey,
      });
      throw new ValidationError('البريد الإلكتروني غير صالح');
    }

    const passwordValidation = this.validatePassword(password);
    if (!passwordValidation.valid) {
      logger.warn('محاولة تسجيل بكلمة مرور ضعيفة', {
        correlationId,
        email,
        reason: passwordValidation.message,
        idempotencyKey,
      });
      throw new ValidationError(passwordValidation.message || 'كلمة المرور ضعيفة');
    }

    const sanitizedEmail = email.trim().toLowerCase();
    const sanitizedFullName = fullName.trim();
    const sanitizedPhone = phoneNumber?.trim();

    let tenantId = providedTenantId;
    if (validateTenant && !tenantId) {
      logger.warn('محاولة تسجيل بدون معرف مستأجر', {
        correlationId,
        email: sanitizedEmail,
        idempotencyKey,
      });
      throw new ValidationError('معرف المستأجر مطلوب');
    }

    if (validateTenant && tenantId) {
      const tenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(tenantId as string),
        {
          operationName: 'auth.register.validateTenant',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
      if (!tenant) {
        logger.warn('محاولة تسجيل لمستأجر غير موجود', {
          correlationId,
          tenantId,
          email: sanitizedEmail,
          idempotencyKey,
        });
        throw new ValidationError('المستأجر غير موجود');
      }
    }

    let existingUser: any;
    try {
      if (tenantId) {
        existingUser = await this.userRepo.findByTenantIdAndEmail(tenantId, sanitizedEmail);
      } else {
        existingUser = await this.userRepo.findByEmail(sanitizedEmail);
      }
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        logger.error('فشل التحقق من وجود المستخدم أثناء التسجيل', {
          correlationId,
          email: sanitizedEmail,
          tenantId,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        throw new InternalServerError('فشل التحقق من البريد الإلكتروني، يرجى المحاولة مرة أخرى');
      }
    }

    if (existingUser) {
      logger.warn('محاولة تسجيل ببريد إلكتروني موجود مسبقاً', {
        correlationId,
        email: sanitizedEmail,
        tenantId,
        existingUserId: existingUser.id,
        idempotencyKey,
      });
      throw new ConflictError('البريد الإلكتروني مستخدم بالفعل');
    }

    const passwordHash = await hash(password, 10);

    const newUserData = {
      email: sanitizedEmail,
      passwordHash,
      fullName: sanitizedFullName,
      tenantId: tenantId || '',
      role,
      phoneNumber: sanitizedPhone,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let newUser: any;
    try {
      newUser = await withRetryAndThrow(
        () => this.userRepo.createUser(newUserData),
        {
          operationName: 'auth.register.createUser',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل إنشاء المستخدم أثناء التسجيل', {
        correlationId,
        email: sanitizedEmail,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      if (error instanceof AppError) throw error;
      throw new InternalServerError('فشل إنشاء المستخدم، يرجى المحاولة مرة أخرى');
    }

    logger.info('تسجيل مستخدم جديد ناجح', {
      correlationId,
      userId: newUser.id,
      email: newUser.email,
      tenantId: newUser.tenantId,
      role: newUser.role,
      idempotencyKey,
      event: 'auth.register.success',
    });

    const accessToken = this.generateAccessToken(
      newUser.id,
      newUser.tenantId,
      newUser.role,
      newUser.email,
      newUser.fullName
    );
    const refreshToken = this.generateRefreshToken();

    const refreshTokenExpiryDate = this.calculateRefreshTokenExpiry(refreshTokenExpiry);
    try {
      await this.userRepo.saveRefreshToken(newUser.id, refreshToken, refreshTokenExpiryDate);
    } catch (error) {
      logger.error('فشل حفظ Refresh Token أثناء التسجيل', {
        correlationId,
        userId: newUser.id,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل حفظ جلسة المصادقة، يرجى المحاولة مرة أخرى');
    }

    const expiresInSeconds = this.parseExpiryToSeconds(accessTokenExpiry);

    return {
      accessToken,
      refreshToken,
      expiresIn: expiresInSeconds,
      user: {
        userId: newUser.id,
        tenantId: newUser.tenantId,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        permissions: newUser.permissions || [],
      },
    };
  }

  // ============================================================
  // تحديث توكن الوصول (Refresh Token)
  // ============================================================

  async refreshAccessToken(refreshToken: string, options: Partial<AuthOptions> = {}): Promise<AuthResponse> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { accessTokenExpiry = config.jwt.expiry || '7d', idempotencyKey } = options;

    if (!refreshToken) {
      logger.warn('محاولة تحديث توكن بدون Refresh Token', {
        correlationId,
        idempotencyKey,
      });
      throw new ValidationError('Refresh Token مطلوب');
    }

    let tokenRecord: any;
    try {
      tokenRecord = await withRetryAndThrow(
        () => this.userRepo.findByRefreshToken(refreshToken),
        {
          operationName: 'auth.refresh.findToken',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('Refresh Token غير موجود', {
          correlationId,
          idempotencyKey,
        });
        throw new UnauthorizedError('Refresh Token غير صالح أو منتهي الصلاحية');
      }
      logger.error('فشل البحث عن Refresh Token', {
        correlationId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل تحديث التوكن، يرجى المحاولة مرة أخرى');
    }

    if (!tokenRecord) {
      throw new UnauthorizedError('Refresh Token غير صالح أو منتهي الصلاحية');
    }

    if (tokenRecord.expiresAt && new Date(tokenRecord.expiresAt) < new Date()) {
      logger.warn('Refresh Token منتهي الصلاحية', {
        correlationId,
        userId: tokenRecord.userId,
        expiresAt: tokenRecord.expiresAt,
        idempotencyKey,
      });
      throw new UnauthorizedError('Refresh Token منتهي الصلاحية، يرجى تسجيل الدخول مرة أخرى');
    }

    let user: any;
    try {
      user = await withRetryAndThrow(
        () => this.userRepo.findById(tokenRecord.userId),
        {
          operationName: 'auth.refresh.findUser',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل البحث عن المستخدم أثناء تحديث التوكن', {
        correlationId,
        userId: tokenRecord.userId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل تحديث التوكن، يرجى المحاولة مرة أخرى');
    }

    if (!user) {
      logger.warn('مستخدم غير موجود مع Refresh Token صالح', {
        correlationId,
        userId: tokenRecord.userId,
        idempotencyKey,
      });
      throw new UnauthorizedError('المستخدم غير موجود');
    }

    if (user.status === 'BLOCKED' || user.status === 'INACTIVE') {
      logger.warn('محاولة تحديث توكن لمستخدم محظور أو غير نشط', {
        correlationId,
        userId: user.id,
        status: user.status,
        idempotencyKey,
      });
      throw new UnauthorizedError('الحساب غير نشط أو محظور');
    }

    const newAccessToken = this.generateAccessToken(
      user.id,
      user.tenantId,
      user.role,
      user.email,
      user.fullName
    );

    const newRefreshToken = this.generateRefreshToken();
    const refreshTokenExpiry = '30d';
    const refreshTokenExpiryDate = this.calculateRefreshTokenExpiry(refreshTokenExpiry);

    try {
      await this.userRepo.deleteRefreshToken(user.id, refreshToken);
      await this.userRepo.saveRefreshToken(user.id, newRefreshToken, refreshTokenExpiryDate);
    } catch (error) {
      logger.error('فشل تحديث Refresh Token', {
        correlationId,
        userId: user.id,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
    }

    const expiresInSeconds = this.parseExpiryToSeconds(accessTokenExpiry);

    logger.info('تحديث توكن ناجح', {
      correlationId,
      userId: user.id,
      idempotencyKey,
      event: 'auth.refresh.success',
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: expiresInSeconds,
      user: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        permissions: user.permissions || [],
      },
    };
  }

  // ============================================================
  // تسجيل الخروج (Logout) و Logout All
  // ============================================================

  async logout(userId: string, refreshToken: string): Promise<void> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!userId || !refreshToken) {
      throw new ValidationError('معرف المستخدم و Refresh Token مطلوبان');
    }

    try {
      await this.userRepo.deleteRefreshToken(userId, refreshToken);
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        logger.error('فشل حذف Refresh Token أثناء تسجيل الخروج', {
          correlationId,
          userId,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    logger.info('تسجيل خروج ناجح', {
      correlationId,
      userId,
      event: 'auth.logout.success',
    });
  }

  async logoutAll(userId: string): Promise<void> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!userId) {
      throw new ValidationError('معرف المستخدم مطلوب');
    }

    try {
      await this.userRepo.deleteAllRefreshTokens(userId);
    } catch (error) {
      logger.error('فشل حذف جميع Refresh Tokens أثناء تسجيل الخروج الكامل', {
        correlationId,
        userId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }

    logger.info('تسجيل خروج من جميع الأجهزة ناجح', {
      correlationId,
      userId,
      event: 'auth.logoutAll.success',
    });
  }

  // ============================================================
  // تغيير كلمة المرور
  // ============================================================

  async changePassword(data: ChangePasswordData, options: { idempotencyKey?: string } = {}): Promise<void> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { userId, currentPassword, newPassword } = data;
    const { idempotencyKey } = options;

    if (!userId || !currentPassword || !newPassword) {
      throw new ValidationError('معرف المستخدم، كلمة المرور الحالية، وكلمة المرور الجديدة مطلوبة');
    }

    const passwordValidation = this.validatePassword(newPassword);
    if (!passwordValidation.valid) {
      logger.warn('محاولة تغيير كلمة مرور ضعيفة', {
        correlationId,
        userId,
        reason: passwordValidation.message,
        idempotencyKey,
      });
      throw new ValidationError(passwordValidation.message || 'كلمة المرور ضعيفة');
    }

    let user: any;
    try {
      user = await withRetryAndThrow(
        () => this.userRepo.findById(userId),
        {
          operationName: 'auth.changePassword.findUser',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل البحث عن المستخدم أثناء تغيير كلمة المرور', {
        correlationId,
        userId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل تغيير كلمة المرور، يرجى المحاولة مرة أخرى');
    }

    if (!user) {
      throw new NotFoundError('المستخدم غير موجود');
    }

    const isPasswordValid = await compare(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      logger.warn('محاولة تغيير كلمة مرور بكلمة مرور حالية غير صحيحة', {
        correlationId,
        userId,
        idempotencyKey,
      });
      throw new UnauthorizedError('كلمة المرور الحالية غير صحيحة');
    }

    const newPasswordHash = await hash(newPassword, 10);

    try {
      await this.userRepo.updateUser(userId, {
        passwordHash: newPasswordHash,
        updatedAt: new Date(),
      });
    } catch (error) {
      logger.error('فشل تحديث كلمة المرور', {
        correlationId,
        userId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل تغيير كلمة المرور، يرجى المحاولة مرة أخرى');
    }

    try {
      await this.userRepo.deleteAllRefreshTokens(userId);
    } catch (error) {
      logger.warn('فشل حذف Refresh Tokens بعد تغيير كلمة المرور', {
        correlationId,
        userId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
    }

    logger.info('تغيير كلمة المرور ناجح', {
      correlationId,
      userId,
      event: 'auth.changePassword.success',
    });
  }

  // ============================================================
  // تحديث الملف الشخصي
  // ============================================================

  async updateProfile(data: UpdateProfileData, options: { idempotencyKey?: string } = {}): Promise<AuthResponse['user']> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { userId, fullName, email, phoneNumber } = data;
    const { idempotencyKey } = options;

    if (!userId) {
      throw new ValidationError('معرف المستخدم مطلوب');
    }

    if (email && !this.validateEmail(email)) {
      logger.warn('محاولة تحديث بريد إلكتروني غير صالح', {
        correlationId,
        userId,
        email,
        idempotencyKey,
      });
      throw new ValidationError('البريد الإلكتروني غير صالح');
    }

    const sanitizedFullName = fullName?.trim();
    const sanitizedEmail = email?.trim().toLowerCase();
    const sanitizedPhone = phoneNumber?.trim();

    let user: any;
    try {
      user = await withRetryAndThrow(
        () => this.userRepo.findById(userId),
        {
          operationName: 'auth.updateProfile.findUser',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل البحث عن المستخدم أثناء تحديث الملف الشخصي', {
        correlationId,
        userId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل تحديث الملف الشخصي، يرجى المحاولة مرة أخرى');
    }

    if (!user) {
      throw new NotFoundError('المستخدم غير موجود');
    }

    if (sanitizedEmail && sanitizedEmail !== user.email) {
      const existingUser = await this.userRepo.findByTenantIdAndEmail(
        user.tenantId,
        sanitizedEmail
      ).catch(() => null);
      if (existingUser && existingUser.id !== userId) {
        logger.warn('محاولة تحديث بريد إلكتروني مستخدم بالفعل', {
          correlationId,
          userId,
          email: sanitizedEmail,
          existingUserId: existingUser.id,
          idempotencyKey,
        });
        throw new ConflictError('البريد الإلكتروني مستخدم بالفعل');
      }
    }

    const updateData: any = {
      updatedAt: new Date(),
    };
    if (sanitizedFullName) updateData.fullName = sanitizedFullName;
    if (sanitizedEmail) updateData.email = sanitizedEmail;
    if (sanitizedPhone !== undefined) updateData.phoneNumber = sanitizedPhone;

    let updatedUser: any;
    try {
      updatedUser = await withRetryAndThrow(
        () => this.userRepo.updateUser(userId, updateData),
        {
          operationName: 'auth.updateProfile.updateUser',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل تحديث المستخدم', {
        correlationId,
        userId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل تحديث الملف الشخصي، يرجى المحاولة مرة أخرى');
    }

    logger.info('تحديث الملف الشخصي ناجح', {
      correlationId,
      userId,
      updatedFields: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
      event: 'auth.updateProfile.success',
    });

    return {
      userId: updatedUser.id,
      tenantId: updatedUser.tenantId,
      email: updatedUser.email,
      fullName: updatedUser.fullName,
      role: updatedUser.role,
      permissions: updatedUser.permissions || [],
    };
  }

  // ============================================================
  // التحقق من صحة توكن الوصول
  // ============================================================

  validateAccessToken(token: string): TokenValidationResult {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!token) {
      return {
        userId: '',
        tenantId: '',
        email: '',
        role: '',
        isValid: false,
        error: 'التوكن مطلوب',
      };
    }

    try {
      const secret = requireConfig(config.jwt.secret, 'JWT_SECRET');
      const decoded = jwt.verify(token, secret) as any;

      if (!decoded.userId || !decoded.tenantId || !decoded.role || !decoded.email) {
        logger.warn('توكن JWT يفتقد حقولاً إلزامية', {
          correlationId,
          decoded,
        });
        return {
          userId: '',
          tenantId: '',
          email: '',
          role: '',
          isValid: false,
          error: 'التوكن غير صالح',
        };
      }

      return {
        userId: decoded.userId,
        tenantId: decoded.tenantId,
        email: decoded.email,
        role: decoded.role,
        isValid: true,
      };
    } catch (error) {
      let errorMessage = 'التوكن غير صالح';
      if (error instanceof jwt.TokenExpiredError) {
        errorMessage = 'انتهت صلاحية التوكن';
      } else if (error instanceof jwt.JsonWebTokenError) {
        errorMessage = `التوكن غير صالح: ${error.message}`;
      }

      logger.warn('فشل التحقق من التوكن', {
        correlationId,
        error: errorMessage,
      });

      return {
        userId: '',
        tenantId: '',
        email: '',
        role: '',
        isValid: false,
        error: errorMessage,
      };
    }
  }
}

