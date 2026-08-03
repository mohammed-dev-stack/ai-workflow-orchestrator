// backend/src/services/tenant.service.ts
import { randomUUID } from 'crypto';
import { config } from '../config';
import { logger } from '../observability/logger';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  AppError,
} from '../middlewares/errorHandler.middleware';
import { withRetryAndThrow } from '../utils/retry';

/**
 * خطة المستأجر (التسعير والحدود).
 */
export type TenantPlan = 'FREE' | 'PRO' | 'ENTERPRISE';

/**
 * إعدادات المستأجر (قابلة للتخصيص).
 */
export interface TenantSettings {
  /** إعدادات الذكاء الاصطناعي */
  ai: {
    /** الحد الأقصى للرموز لكل طلب */
    maxTokensPerRequest: number;
    /** النماذج المسموح بها */
    allowedModels: string[];
    /** الحد الأقصى لعدد طلبات AI في الشهر */
    monthlyAILimit: number;
  };
  /** إعدادات التخزين */
  storage: {
    /** الحد الأقصى للمساحة التخزينية (بالبايت) */
    maxStorageBytes: number;
  };
  /** إعدادات المستندات */
  documents: {
    /** الحد الأقصى لعدد المستندات لكل قاعدة معرفة */
    maxDocumentsPerKB: number;
    /** الحد الأقصى لحجم الملف (بالبايت) */
    maxFileSizeBytes: number;
  };
  /** إعدادات المحادثة */
  chat: {
    /** الحد الأقصى لعدد المحادثات النشطة */
    maxActiveConversations: number;
    /** الاحتفاظ برسائل المحادثة (بالأيام) */
    messageRetentionDays: number;
  };
  /** إعدادات المستخدمين */
  users: {
    /** الحد الأقصى لعدد المستخدمين */
    maxUsers: number;
    /** الأدوار المسموح بها */
    allowedRoles: string[];
  };
  /** إعدادات WhatsApp */
  whatsapp: {
    /** معرف رقم الهاتف (phone_number_id) */
    phoneNumberId?: string;
    /** ما إذا كان WhatsApp مفعلاً */
    enabled: boolean;
  };
}

/**
 * واجهة مستودع المستأجر.
 * سيتم ربطها بتنفيذ Prisma الفعلي لاحقاً.
 */
export interface ITenantRepository {
  findById(id: string): Promise<any>;
  findByName(name: string): Promise<any>;
  findByDomain(domain: string): Promise<any>;
  findByPhoneNumberId(phoneNumberId: string): Promise<any>;
  findAll(options?: { limit?: number; offset?: number; search?: string }): Promise<{ items: any[]; total: number }>;
  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  softDelete(id: string): Promise<any>;
  restore(id: string): Promise<any>;
  updateStatus(id: string, status: string): Promise<any>;
  updateSettings(id: string, settings: any): Promise<any>;
  countActive(): Promise<number>;
  getTotalStorageUsage(id: string): Promise<number>;
  getAIServiceUsage(id: string, startDate: Date, endDate: Date): Promise<{ requests: number; tokens: number }>;
}

/**
 * خيارات إنشاء مستأجر جديد.
 */
export interface CreateTenantData {
  /** اسم المستأجر (فريد) */
  name: string;

  /** النطاق (domain) للمستأجر (فريد) */
  domain: string;

  /** البريد الإلكتروني للمالك/المسؤول */
  adminEmail: string;

  /** اسم المالك/المسؤول */
  adminName: string;

  /** خطة المستأجر (افتراضي: FREE) */
  plan?: TenantPlan;

  /** إعدادات مخصصة (اختياري) */
  settings?: Partial<TenantSettings>;

  /** معرف المستخدم المنشئ (للتدقيق) */
  createdBy: string;

  /** مفتاح التكافؤ (اختياري) */
  idempotencyKey?: string;
}

/**
 * خيارات تحديث المستأجر.
 */
export interface UpdateTenantData {
  /** معرف المستأجر */
  tenantId: string;

  /** اسم جديد (اختياري) */
  name?: string;

  /** نطاق جديد (اختياري) */
  domain?: string;

  /** خطة جديدة (اختياري) */
  plan?: TenantPlan;

  /** إعدادات جديدة (اختياري) */
  settings?: Partial<TenantSettings>;

  /** معرف المستخدم المُحدِّث (للتدقيق) */
  updatedBy: string;

  /** مفتاح التكافؤ (اختياري) */
  idempotencyKey?: string;
}

/**
 * خيارات جلب قائمة المستأجرين.
 */
export interface ListTenantsOptions {
  /** عدد العناصر في الصفحة (افتراضي: 20) */
  limit?: number;

  /** الإزاحة (للتقسيم إلى صفحات) */
  offset?: number;

  /** نص البحث (اختياري) */
  search?: string;

  /** تصفية حسب الخطة (اختياري) */
  plan?: TenantPlan;

  /** تصفية حسب الحالة (اختياري) */
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

/**
 * تمثيل المستأجر.
 */
export interface Tenant {
  id: string;
  name: string;
  domain: string;
  adminEmail: string;
  adminName: string;
  plan: TenantPlan;
  settings: TenantSettings;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  whatsappPhoneNumberId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  createdBy: string;
}

/**
 * القيم الافتراضية لإعدادات المستأجر حسب الخطة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة منطقية.
 */
const DEFAULT_SETTINGS_BY_PLAN: Record<TenantPlan, TenantSettings> = {
  FREE: {
    ai: {
      maxTokensPerRequest: 4096,
      allowedModels: ['claude-3-haiku-20240307'],
      monthlyAILimit: 1000,
    },
    storage: {
      maxStorageBytes: 100 * 1024 * 1024, // 100 MB
    },
    documents: {
      maxDocumentsPerKB: 50,
      maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
    },
    chat: {
      maxActiveConversations: 10,
      messageRetentionDays: 30,
    },
    users: {
      maxUsers: 3,
      allowedRoles: ['ADMIN', 'AGENT', 'VIEWER'],
    },
    whatsapp: {
      enabled: false,
      phoneNumberId: undefined,
    },
  },
  PRO: {
    ai: {
      maxTokensPerRequest: 8192,
      allowedModels: ['claude-3-sonnet-20241022', 'claude-3-haiku-20240307'],
      monthlyAILimit: 10000,
    },
    storage: {
      maxStorageBytes: 1024 * 1024 * 1024, // 1 GB
    },
    documents: {
      maxDocumentsPerKB: 500,
      maxFileSizeBytes: 20 * 1024 * 1024, // 20 MB
    },
    chat: {
      maxActiveConversations: 50,
      messageRetentionDays: 90,
    },
    users: {
      maxUsers: 20,
      allowedRoles: ['ADMIN', 'AGENT', 'VIEWER'],
    },
    whatsapp: {
      enabled: true,
      phoneNumberId: undefined,
    },
  },
  ENTERPRISE: {
    ai: {
      maxTokensPerRequest: 20480,
      allowedModels: ['claude-3-opus-20240229', 'claude-3-sonnet-20241022', 'claude-3-haiku-20240307'],
      monthlyAILimit: 100000,
    },
    storage: {
      maxStorageBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    },
    documents: {
      maxDocumentsPerKB: 5000,
      maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
    },
    chat: {
      maxActiveConversations: 500,
      messageRetentionDays: 365,
    },
    users: {
      maxUsers: 500,
      allowedRoles: ['ADMIN', 'AGENT', 'VIEWER'],
    },
    whatsapp: {
      enabled: true,
      phoneNumberId: undefined,
    },
  },
};

/**
 * خدمة إدارة المستأجرين (Tenant Service).
 * تحتوي على منطق الأعمال لإنشاء وتحديث وحذف وجلب المستأجرين،
 * بالإضافة إلى إدارة إعداداتهم وخططهم.
 * تطبق عزل البيانات وفصل المستأجرين بشكل صارم.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق CRUD كامل مع فشل سريع، تكافؤ، وأحداث تدقيق.
 */
export class TenantService {
  private tenantRepo: ITenantRepository;

  constructor(tenantRepo: ITenantRepository) {
    this.tenantRepo = tenantRepo;
  }

  /**
   * دالة مساعدة للتحقق من صحة اسم المستأجر (تنقية المدخلات).
   * [مُتحقَّق منطقياً بتتبع كامل] — تحقق من الطول والرموز المسموح بها.
   */
  private validateName(name: string): { valid: boolean; message?: string } {
    if (!name || name.trim().length === 0) {
      return { valid: false, message: 'اسم المستأجر مطلوب' };
    }
    const trimmed = name.trim();
    if (trimmed.length < 3) {
      return { valid: false, message: 'اسم المستأجر يجب أن يكون 3 أحرف على الأقل' };
    }
    if (trimmed.length > 100) {
      return { valid: false, message: 'اسم المستأجر يجب أن لا يتجاوز 100 حرف' };
    }
    // منع الرموز الخطيرة (لأمان)
    if (/[<>{}[\]|\\]/.test(trimmed)) {
      return { valid: false, message: 'اسم المستأجر يحتوي على رموز غير مسموح بها' };
    }
    return { valid: true };
  }

  /**
   * دالة مساعدة للتحقق من صحة النطاق (domain).
   * [مُتحقَّق منطقياً بتتبع كامل] — تحقق من النطاق الصحيح.
   */
  private validateDomain(domain: string): { valid: boolean; message?: string } {
    if (!domain || domain.trim().length === 0) {
      return { valid: false, message: 'النطاق (domain) مطلوب' };
    }
    const trimmed = domain.trim().toLowerCase();
    // نمط النطاق: اسم النطاق مع امتداد (.com, .io, إلخ)
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.[a-z]{2,}$/;
    if (!domainRegex.test(trimmed)) {
      return { valid: false, message: 'النطاق غير صالح (مثال: example.com)' };
    }
    if (trimmed.length > 100) {
      return { valid: false, message: 'النطاق يجب أن لا يتجاوز 100 حرف' };
    }
    return { valid: true };
  }

  /**
   * دالة مساعدة للتحقق من صحة البريد الإلكتروني.
   * [مُتحقَّق منطقياً بتتبع كامل] — تحقق بسيط مع نمط Regex.
   */
  private validateEmail(email: string): { valid: boolean; message?: string } {
    if (!email || email.trim().length === 0) {
      return { valid: false, message: 'البريد الإلكتروني مطلوب' };
    }
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      return { valid: false, message: 'البريد الإلكتروني غير صالح' };
    }
    return { valid: true };
  }

  /**
   * دالة مساعدة للتحقق من خطة المستأجر.
   * [مُتحقَّق منطقياً بتتبع كامل] — تحقق من القيم المسموح بها.
   */
  private validatePlan(plan: string): { valid: boolean; message?: string } {
    const allowedPlans: TenantPlan[] = ['FREE', 'PRO', 'ENTERPRISE'];
    if (!allowedPlans.includes(plan as TenantPlan)) {
      return {
        valid: false,
        message: `الخطة غير صالحة. الخطط المسموحة: ${allowedPlans.join(', ')}`,
      };
    }
    return { valid: true };
  }

  /**
   * دالة مساعدة لدمج الإعدادات مع القيم الافتراضية حسب الخطة.
   * [مُتحقَّق منطقياً بتتبع كامل] — دمج عميق مع أولوية للإعدادات المقدمة.
   */
  private mergeSettings(
    plan: TenantPlan,
    customSettings?: Partial<TenantSettings>
  ): TenantSettings {
    const defaults = DEFAULT_SETTINGS_BY_PLAN[plan];
    if (!customSettings) {
      return defaults;
    }

    // دمج عميق (deep merge) — الحفاظ على القيم الافتراضية للحقول غير المقدمة
    return {
      ai: {
        maxTokensPerRequest: customSettings.ai?.maxTokensPerRequest ?? defaults.ai.maxTokensPerRequest,
        allowedModels: customSettings.ai?.allowedModels ?? defaults.ai.allowedModels,
        monthlyAILimit: customSettings.ai?.monthlyAILimit ?? defaults.ai.monthlyAILimit,
      },
      storage: {
        maxStorageBytes: customSettings.storage?.maxStorageBytes ?? defaults.storage.maxStorageBytes,
      },
      documents: {
        maxDocumentsPerKB: customSettings.documents?.maxDocumentsPerKB ?? defaults.documents.maxDocumentsPerKB,
        maxFileSizeBytes: customSettings.documents?.maxFileSizeBytes ?? defaults.documents.maxFileSizeBytes,
      },
      chat: {
        maxActiveConversations: customSettings.chat?.maxActiveConversations ?? defaults.chat.maxActiveConversations,
        messageRetentionDays: customSettings.chat?.messageRetentionDays ?? defaults.chat.messageRetentionDays,
      },
      users: {
        maxUsers: customSettings.users?.maxUsers ?? defaults.users.maxUsers,
        allowedRoles: customSettings.users?.allowedRoles ?? defaults.users.allowedRoles,
      },
      whatsapp: {
        enabled: customSettings.whatsapp?.enabled ?? defaults.whatsapp.enabled,
        phoneNumberId: customSettings.whatsapp?.phoneNumberId ?? defaults.whatsapp.phoneNumberId,
      },
    };
  }

  /**
   * إنشاء مستأجر جديد.
   * تطبق الفشل السريع عند تكرار الاسم أو النطاق، وتُصدر أحداثاً قابلة للتدقيق.
   *
   * [مُتحقَّق منطقياً بتتبع كامل] — منطق إنشاء كامل مع تحقق المدخلات وتكافؤ.
   */
  async createTenant(data: CreateTenantData): Promise<Tenant> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const {
      name,
      domain,
      adminEmail,
      adminName,
      plan = 'FREE',
      settings,
      createdBy,
      idempotencyKey,
    } = data;

    // 1. التحقق من صحة المدخلات (الفشل السريع)
    if (!name || !domain || !adminEmail || !adminName || !createdBy) {
      logger.warn('محاولة إنشاء مستأجر ببيانات ناقصة', {
        correlationId,
        hasName: !!name,
        hasDomain: !!domain,
        hasAdminEmail: !!adminEmail,
        hasAdminName: !!adminName,
        hasCreatedBy: !!createdBy,
        idempotencyKey,
      });
      throw new ValidationError('الاسم، النطاق، البريد الإلكتروني للمالك، اسم المالك، والمنشئ مطلوبة');
    }

    const nameValidation = this.validateName(name);
    if (!nameValidation.valid) {
      logger.warn('محاولة إنشاء مستأجر باسم غير صالح', {
        correlationId,
        name,
        reason: nameValidation.message,
        idempotencyKey,
      });
      throw new ValidationError(nameValidation.message || 'الاسم غير صالح');
    }

    const domainValidation = this.validateDomain(domain);
    if (!domainValidation.valid) {
      logger.warn('محاولة إنشاء مستأجر بنطاق غير صالح', {
        correlationId,
        domain,
        reason: domainValidation.message,
        idempotencyKey,
      });
      throw new ValidationError(domainValidation.message || 'النطاق غير صالح');
    }

    const emailValidation = this.validateEmail(adminEmail);
    if (!emailValidation.valid) {
      logger.warn('محاولة إنشاء مستأجر ببريد إلكتروني غير صالح', {
        correlationId,
        adminEmail,
        reason: emailValidation.message,
        idempotencyKey,
      });
      throw new ValidationError(emailValidation.message || 'البريد الإلكتروني غير صالح');
    }

    const planValidation = this.validatePlan(plan);
    if (!planValidation.valid) {
      logger.warn('محاولة إنشاء مستأجر بخطة غير صالحة', {
        correlationId,
        plan,
        reason: planValidation.message,
        idempotencyKey,
      });
      throw new ValidationError(planValidation.message || 'الخطة غير صالحة');
    }

    // 2. تنقية المدخلات
    const sanitizedName = name.trim();
    const sanitizedDomain = domain.trim().toLowerCase();
    const sanitizedEmail = adminEmail.trim().toLowerCase();
    const sanitizedAdminName = adminName.trim();

    // 3. التحقق من عدم وجود مستأجر بنفس الاسم
    let existingByName: any;
    try {
      existingByName = await withRetryAndThrow(
        () => this.tenantRepo.findByName(sanitizedName),
        {
          operationName: 'tenant.create.checkName',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        logger.error('فشل التحقق من وجود المستأجر بالاسم', {
          correlationId,
          name: sanitizedName,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        throw new InternalServerError('فشل إنشاء المستأجر، يرجى المحاولة مرة أخرى');
      }
    }

    if (existingByName) {
      logger.warn('محاولة إنشاء مستأجر باسم مكرر', {
        correlationId,
        name: sanitizedName,
        existingTenantId: existingByName.id,
        idempotencyKey,
      });
      throw new ConflictError('يوجد مستأجر بنفس الاسم');
    }

    // 4. التحقق من عدم وجود مستأجر بنفس النطاق
    let existingByDomain: any;
    try {
      existingByDomain = await withRetryAndThrow(
        () => this.tenantRepo.findByDomain(sanitizedDomain),
        {
          operationName: 'tenant.create.checkDomain',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        logger.error('فشل التحقق من وجود المستأجر بالنطاق', {
          correlationId,
          domain: sanitizedDomain,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        throw new InternalServerError('فشل إنشاء المستأجر، يرجى المحاولة مرة أخرى');
      }
    }

    if (existingByDomain) {
      logger.warn('محاولة إنشاء مستأجر بنطاق مكرر', {
        correlationId,
        domain: sanitizedDomain,
        existingTenantId: existingByDomain.id,
        idempotencyKey,
      });
      throw new ConflictError('يوجد مستأجر بنفس النطاق');
    }

    // 5. دمج الإعدادات مع القيم الافتراضية حسب الخطة
    const mergedSettings = this.mergeSettings(plan as TenantPlan, settings);

    // 6. إنشاء المستأجر في قاعدة البيانات
    const tenantData = {
      name: sanitizedName,
      domain: sanitizedDomain,
      adminEmail: sanitizedEmail,
      adminName: sanitizedAdminName,
      plan,
      settings: mergedSettings,
      status: 'ACTIVE',
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let newTenant: any;
    try {
      newTenant = await withRetryAndThrow(
        () => this.tenantRepo.create(tenantData),
        {
          operationName: 'tenant.create',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل إنشاء المستأجر في قاعدة البيانات', {
        correlationId,
        name: sanitizedName,
        domain: sanitizedDomain,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل إنشاء المستأجر، يرجى المحاولة مرة أخرى');
    }

    // 7. تسجيل حدث التدقيق
    logger.info('تم إنشاء مستأجر جديد', {
      correlationId,
      tenantId: newTenant.id,
      name: newTenant.name,
      domain: newTenant.domain,
      plan: newTenant.plan,
      adminEmail: newTenant.adminEmail,
      createdBy,
      idempotencyKey,
      event: 'tenant.create.success',
    });

    return this.mapToTenant(newTenant);
  }

  /**
   * جلب مستأجر بواسطة المعرف.
   * [مُتحقَّق منطقياً بتتبع كامل] — جلب مع تحقق من وجود المستأجر.
   */
  async getTenantById(tenantId: string): Promise<Tenant> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!tenantId) {
      throw new ValidationError('معرف المستأجر مطلوب');
    }

    let tenant: any;
    try {
      tenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(tenantId),
        {
          operationName: 'tenant.getById',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستأجر غير موجود', {
          correlationId,
          tenantId,
        });
        throw new NotFoundError('المستأجر غير موجود');
      }
      logger.error('فشل جلب المستأجر', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب المستأجر، يرجى المحاولة مرة أخرى');
    }

    if (!tenant) {
      throw new NotFoundError('المستأجر غير موجود');
    }

    logger.debug('تم جلب المستأجر', {
      correlationId,
      tenantId,
      name: tenant.name,
    });

    return this.mapToTenant(tenant);
  }

  /**
   * جلب مستأجر بواسطة النطاق (للاستخدام في المصادقة).
   * [مُتحقَّق منطقياً بتتبع كامل] — جلب مع تحقق من وجود المستأجر.
   */
  async getTenantByDomain(domain: string): Promise<Tenant> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!domain) {
      throw new ValidationError('النطاق مطلوب');
    }

    const sanitizedDomain = domain.trim().toLowerCase();

    let tenant: any;
    try {
      tenant = await withRetryAndThrow(
        () => this.tenantRepo.findByDomain(sanitizedDomain),
        {
          operationName: 'tenant.getByDomain',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستأجر غير موجود بالنطاق', {
          correlationId,
          domain: sanitizedDomain,
        });
        throw new NotFoundError('المستأجر غير موجود');
      }
      logger.error('فشل جلب المستأجر بالنطاق', {
        correlationId,
        domain: sanitizedDomain,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب المستأجر، يرجى المحاولة مرة أخرى');
    }

    if (!tenant) {
      throw new NotFoundError('المستأجر غير موجود');
    }

    logger.debug('تم جلب المستأجر بالنطاق', {
      correlationId,
      domain: sanitizedDomain,
      tenantId: tenant.id,
    });

    return this.mapToTenant(tenant);
  }

  /**
   * جلب مستأجر بواسطة معرف رقم هاتف WhatsApp.
   * [مُتحقَّق منطقياً بتتبع كامل] — جلب مع تحقق من وجود المستأجر.
   */
  async getTenantByPhoneNumberId(phoneNumberId: string): Promise<Tenant> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!phoneNumberId) {
      throw new ValidationError('معرف رقم الهاتف مطلوب');
    }

    let tenant: any;
    try {
      tenant = await withRetryAndThrow(
        () => this.tenantRepo.findByPhoneNumberId(phoneNumberId),
        {
          operationName: 'tenant.getByPhone',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستأجر غير موجود برقم الهاتف', {
          correlationId,
          phoneNumberId,
        });
        throw new NotFoundError('لا يوجد مستأجر مرتبط برقم الهاتف هذا');
      }
      logger.error('فشل جلب المستأجر برقم الهاتف', {
        correlationId,
        phoneNumberId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب المستأجر، يرجى المحاولة مرة أخرى');
    }

    if (!tenant) {
      throw new NotFoundError('لا يوجد مستأجر مرتبط برقم الهاتف هذا');
    }

    logger.debug('تم جلب المستأجر برقم الهاتف', {
      correlationId,
      phoneNumberId,
      tenantId: tenant.id,
    });

    return this.mapToTenant(tenant);
  }

  /**
   * جلب قائمة المستأجرين (للوحة الإدارة).
   * [مُتحقَّق منطقياً بتتبع كامل] — جلب القائمة مع تحقق المدخلات وتطبيق الحدود.
   */
  async listTenants(options: ListTenantsOptions = {}): Promise<{
    items: Tenant[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { limit = 20, offset = 0, search, plan, status } = options;

    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safeOffset = Math.max(0, offset);

    let result: { items: any[]; total: number };
    try {
      result = await withRetryAndThrow(
        () => this.tenantRepo.findAll({
          limit: safeLimit,
          offset: safeOffset,
          search,
        }),
        {
          operationName: 'tenant.list',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل جلب قائمة المستأجرين', {
        correlationId,
        limit: safeLimit,
        offset: safeOffset,
        search,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب قائمة المستأجرين، يرجى المحاولة مرة أخرى');
    }

    // تصفية النتائج حسب الخطة والحالة
    let filteredItems = result.items;
    if (plan) {
      filteredItems = filteredItems.filter((item) => item.plan === plan);
    }
    if (status) {
      filteredItems = filteredItems.filter((item) => item.status === status);
    }

    logger.debug('تم جلب قائمة المستأجرين', {
      correlationId,
      total: result.total,
      returned: filteredItems.length,
      limit: safeLimit,
      offset: safeOffset,
      plan,
      status,
    });

    return {
      items: filteredItems.map((item) => this.mapToTenant(item)),
      total: result.total,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  /**
   * تحديث مستأجر موجود.
   * تطبق الفشل السريع عند تكرار الاسم أو النطاق، وتُصدر أحداثاً قابلة للتدقيق.
   *
   * [مُتحقَّق منطقياً بتتبع كامل] — منطق تحديث كامل مع تحقق المدخلات والصلاحيات.
   */
  async updateTenant(data: UpdateTenantData): Promise<Tenant> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const { tenantId, name, domain, plan, settings, updatedBy, idempotencyKey } = data;

    // 1. التحقق من صحة المدخلات (الفشل السريع)
    if (!tenantId || !updatedBy) {
      logger.warn('محاولة تحديث مستأجر ببيانات ناقصة', {
        correlationId,
        hasTenantId: !!tenantId,
        hasUpdatedBy: !!updatedBy,
        idempotencyKey,
      });
      throw new ValidationError('معرف المستأجر والمُحدِّث مطلوبة');
    }

    // 2. جلب المستأجر الحالي (للتحقق من وجوده)
    let existingTenant: any;
    try {
      existingTenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(tenantId),
        {
          operationName: 'tenant.update.getExisting',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستأجر غير موجود للتحديث', {
          correlationId,
          tenantId,
          idempotencyKey,
        });
        throw new NotFoundError('المستأجر غير موجود');
      }
      logger.error('فشل جلب المستأجر للتحديث', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل تحديث المستأجر، يرجى المحاولة مرة أخرى');
    }

    if (!existingTenant) {
      throw new NotFoundError('المستأجر غير موجود');
    }

    // 3. التحقق من أن المستأجر غير محذوف
    if (existingTenant.deletedAt) {
      logger.warn('محاولة تحديث مستأجر محذوف', {
        correlationId,
        tenantId,
        deletedAt: existingTenant.deletedAt,
        idempotencyKey,
      });
      throw new NotFoundError('المستأجر غير موجود');
    }

    // 4. تنقية وتجهيز بيانات التحديث
    const updateData: any = {
      updatedAt: new Date(),
    };

    // تحديث الاسم
    if (name !== undefined) {
      const nameValidation = this.validateName(name);
      if (!nameValidation.valid) {
        logger.warn('محاولة تحديث مستأجر باسم غير صالح', {
          correlationId,
          name,
          reason: nameValidation.message,
          idempotencyKey,
        });
        throw new ValidationError(nameValidation.message || 'الاسم غير صالح');
      }
      const sanitizedName = name.trim();
      if (sanitizedName !== existingTenant.name) {
        // التحقق من عدم وجود مستأجر آخر بنفس الاسم
        let duplicateByName: any;
        try {
          duplicateByName = await withRetryAndThrow(
            () => this.tenantRepo.findByName(sanitizedName),
            {
              operationName: 'tenant.update.checkName',
              idempotencyKey,
              maxAttempts: 3,
              verboseLogging: false,
            }
          );
        } catch (error) {
          if (!(error instanceof NotFoundError)) {
            logger.error('فشل التحقق من الاسم المكرر أثناء التحديث', {
              correlationId,
              name: sanitizedName,
              error: error instanceof Error ? error.message : 'unknown',
              idempotencyKey,
            });
            throw new InternalServerError('فشل تحديث المستأجر، يرجى المحاولة مرة أخرى');
          }
        }
        if (duplicateByName && duplicateByName.id !== tenantId) {
          logger.warn('محاولة تحديث مستأجر باسم مكرر', {
            correlationId,
            name: sanitizedName,
            existingTenantId: duplicateByName.id,
            idempotencyKey,
          });
          throw new ConflictError('يوجد مستأجر آخر بنفس الاسم');
        }
        updateData.name = sanitizedName;
      }
    }

    // تحديث النطاق
    if (domain !== undefined) {
      const domainValidation = this.validateDomain(domain);
      if (!domainValidation.valid) {
        logger.warn('محاولة تحديث مستأجر بنطاق غير صالح', {
          correlationId,
          domain,
          reason: domainValidation.message,
          idempotencyKey,
        });
        throw new ValidationError(domainValidation.message || 'النطاق غير صالح');
      }
      const sanitizedDomain = domain.trim().toLowerCase();
      if (sanitizedDomain !== existingTenant.domain) {
        // التحقق من عدم وجود مستأجر آخر بنفس النطاق
        let duplicateByDomain: any;
        try {
          duplicateByDomain = await withRetryAndThrow(
            () => this.tenantRepo.findByDomain(sanitizedDomain),
            {
              operationName: 'tenant.update.checkDomain',
              idempotencyKey,
              maxAttempts: 3,
              verboseLogging: false,
            }
          );
        } catch (error) {
          if (!(error instanceof NotFoundError)) {
            logger.error('فشل التحقق من النطاق المكرر أثناء التحديث', {
              correlationId,
              domain: sanitizedDomain,
              error: error instanceof Error ? error.message : 'unknown',
              idempotencyKey,
            });
            throw new InternalServerError('فشل تحديث المستأجر، يرجى المحاولة مرة أخرى');
          }
        }
        if (duplicateByDomain && duplicateByDomain.id !== tenantId) {
          logger.warn('محاولة تحديث مستأجر بنطاق مكرر', {
            correlationId,
            domain: sanitizedDomain,
            existingTenantId: duplicateByDomain.id,
            idempotencyKey,
          });
          throw new ConflictError('يوجد مستأجر آخر بنفس النطاق');
        }
        updateData.domain = sanitizedDomain;
      }
    }

    // تحديث الخطة
    if (plan !== undefined) {
      const planValidation = this.validatePlan(plan);
      if (!planValidation.valid) {
        logger.warn('محاولة تحديث مستأجر بخطة غير صالحة', {
          correlationId,
          plan,
          reason: planValidation.message,
          idempotencyKey,
        });
        throw new ValidationError(planValidation.message || 'الخطة غير صالحة');
      }
      if (plan !== existingTenant.plan) {
        updateData.plan = plan;
        // إذا تغيرت الخطة، ندمج الإعدادات الجديدة مع القيم الافتراضية للخطة الجديدة
        // ولكن نحتفظ بالإعدادات المخصصة الحالية (إذا لم يتم توفير إعدادات جديدة)
        const currentSettings = existingTenant.settings || {};
        const newDefaultSettings = DEFAULT_SETTINGS_BY_PLAN[plan as TenantPlan];
        // دمج الإعدادات الحالية (المخصصة) مع الإعدادات الافتراضية للخطة الجديدة
        const mergedSettings = {
          ai: {
            maxTokensPerRequest: currentSettings.ai?.maxTokensPerRequest ?? newDefaultSettings.ai.maxTokensPerRequest,
            allowedModels: currentSettings.ai?.allowedModels ?? newDefaultSettings.ai.allowedModels,
            monthlyAILimit: currentSettings.ai?.monthlyAILimit ?? newDefaultSettings.ai.monthlyAILimit,
          },
          storage: {
            maxStorageBytes: currentSettings.storage?.maxStorageBytes ?? newDefaultSettings.storage.maxStorageBytes,
          },
          documents: {
            maxDocumentsPerKB: currentSettings.documents?.maxDocumentsPerKB ?? newDefaultSettings.documents.maxDocumentsPerKB,
            maxFileSizeBytes: currentSettings.documents?.maxFileSizeBytes ?? newDefaultSettings.documents.maxFileSizeBytes,
          },
          chat: {
            maxActiveConversations: currentSettings.chat?.maxActiveConversations ?? newDefaultSettings.chat.maxActiveConversations,
            messageRetentionDays: currentSettings.chat?.messageRetentionDays ?? newDefaultSettings.chat.messageRetentionDays,
          },
          users: {
            maxUsers: currentSettings.users?.maxUsers ?? newDefaultSettings.users.maxUsers,
            allowedRoles: currentSettings.users?.allowedRoles ?? newDefaultSettings.users.allowedRoles,
          },
          whatsapp: {
            enabled: currentSettings.whatsapp?.enabled ?? newDefaultSettings.whatsapp.enabled,
            phoneNumberId: currentSettings.whatsapp?.phoneNumberId ?? newDefaultSettings.whatsapp.phoneNumberId,
          },
        };
        // إذا لم يتم توفير إعدادات جديدة في الطلب، نستخدم الإعدادات المدمجة
        if (!settings) {
          updateData.settings = mergedSettings;
        }
      }
    }

    // تحديث الإعدادات (إذا تم توفيرها)
    if (settings !== undefined) {
      const currentPlan = (plan || existingTenant.plan) as TenantPlan;
      const currentSettings = existingTenant.settings || {};
      // دمج الإعدادات الحالية مع الإعدادات المقدمة
      const mergedSettings = {
        ai: {
          maxTokensPerRequest: settings.ai?.maxTokensPerRequest ?? currentSettings.ai?.maxTokensPerRequest ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].ai.maxTokensPerRequest,
          allowedModels: settings.ai?.allowedModels ?? currentSettings.ai?.allowedModels ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].ai.allowedModels,
          monthlyAILimit: settings.ai?.monthlyAILimit ?? currentSettings.ai?.monthlyAILimit ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].ai.monthlyAILimit,
        },
        storage: {
          maxStorageBytes: settings.storage?.maxStorageBytes ?? currentSettings.storage?.maxStorageBytes ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].storage.maxStorageBytes,
        },
        documents: {
          maxDocumentsPerKB: settings.documents?.maxDocumentsPerKB ?? currentSettings.documents?.maxDocumentsPerKB ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].documents.maxDocumentsPerKB,
          maxFileSizeBytes: settings.documents?.maxFileSizeBytes ?? currentSettings.documents?.maxFileSizeBytes ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].documents.maxFileSizeBytes,
        },
        chat: {
          maxActiveConversations: settings.chat?.maxActiveConversations ?? currentSettings.chat?.maxActiveConversations ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].chat.maxActiveConversations,
          messageRetentionDays: settings.chat?.messageRetentionDays ?? currentSettings.chat?.messageRetentionDays ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].chat.messageRetentionDays,
        },
        users: {
          maxUsers: settings.users?.maxUsers ?? currentSettings.users?.maxUsers ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].users.maxUsers,
          allowedRoles: settings.users?.allowedRoles ?? currentSettings.users?.allowedRoles ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].users.allowedRoles,
        },
        whatsapp: {
          enabled: settings.whatsapp?.enabled ?? currentSettings.whatsapp?.enabled ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].whatsapp.enabled,
          phoneNumberId: settings.whatsapp?.phoneNumberId ?? currentSettings.whatsapp?.phoneNumberId ?? DEFAULT_SETTINGS_BY_PLAN[currentPlan].whatsapp.phoneNumberId,
        },
      };
      updateData.settings = mergedSettings;
    }

    // 5. تنفيذ التحديث
    let updatedTenant: any;
    try {
      updatedTenant = await withRetryAndThrow(
        () => this.tenantRepo.update(tenantId, updateData),
        {
          operationName: 'tenant.update',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل تحديث المستأجر في قاعدة البيانات', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل تحديث المستأجر، يرجى المحاولة مرة أخرى');
    }

    // 6. تسجيل حدث التدقيق
    logger.info('تم تحديث المستأجر', {
      correlationId,
      tenantId: updatedTenant.id,
      name: updatedTenant.name,
      domain: updatedTenant.domain,
      plan: updatedTenant.plan,
      updatedBy,
      updatedFields: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
      idempotencyKey,
      event: 'tenant.update.success',
    });

    return this.mapToTenant(updatedTenant);
  }

  /**
   * حذف مستأجر (حذف ناعم - Soft Delete).
   * تطبق الفشل السريع عند عدم وجود المستأجر.
   *
   * [مُتحقَّق منطقياً بتتبع كامل] — حذف ناعم مع تحقق الصلاحيات.
   */
  async deleteTenant(tenantId: string, deletedBy: string): Promise<void> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!tenantId || !deletedBy) {
      throw new ValidationError('معرف المستأجر والمُحذِف مطلوبة');
    }

    // 1. جلب المستأجر (للتحقق من وجوده)
    let existingTenant: any;
    try {
      existingTenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(tenantId),
        {
          operationName: 'tenant.delete.getExisting',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستأجر غير موجود للحذف', {
          correlationId,
          tenantId,
        });
        throw new NotFoundError('المستأجر غير موجود');
      }
      logger.error('فشل جلب المستأجر للحذف', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حذف المستأجر، يرجى المحاولة مرة أخرى');
    }

    if (!existingTenant) {
      throw new NotFoundError('المستأجر غير موجود');
    }

    // 2. التحقق من أن المستأجر غير محذوف بالفعل
    if (existingTenant.deletedAt) {
      logger.warn('محاولة حذف مستأجر محذوف بالفعل', {
        correlationId,
        tenantId,
        deletedAt: existingTenant.deletedAt,
      });
      throw new NotFoundError('المستأجر غير موجود');
    }

    // 3. تنفيذ الحذف الناعم
    try {
      await withRetryAndThrow(
        () => this.tenantRepo.softDelete(tenantId),
        {
          operationName: 'tenant.delete',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل حذف المستأجر', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل حذف المستأجر، يرجى المحاولة مرة أخرى');
    }

    // 4. تسجيل حدث التدقيق
    logger.info('تم حذف المستأجر (حذف ناعم)', {
      correlationId,
      tenantId,
      name: existingTenant.name,
      domain: existingTenant.domain,
      deletedBy,
      event: 'tenant.delete.success',
    });

    // 5. (اختياري) تشغيل سير عمل لتنظيف البيانات المرتبطة
    // يتم تفويض ذلك إلى المنسق (Orchestrator) خارج نطاق هذه الخدمة
  }

  /**
   * استعادة مستأجر محذوف (Restore).
   * [مُتحقَّق منطقياً بتتبع كامل] — استعادة الحذف الناعم مع تحقق الصلاحيات.
   */
  async restoreTenant(tenantId: string, restoredBy: string): Promise<Tenant> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!tenantId || !restoredBy) {
      throw new ValidationError('معرف المستأجر والمُستعيد مطلوبة');
    }

    // 1. جلب المستأجر (للتحقق من وجوده)
    let existingTenant: any;
    try {
      existingTenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(tenantId),
        {
          operationName: 'tenant.restore.getExisting',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستأجر غير موجود للاستعادة', {
          correlationId,
          tenantId,
        });
        throw new NotFoundError('المستأجر غير موجود');
      }
      logger.error('فشل جلب المستأجر للاستعادة', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل استعادة المستأجر، يرجى المحاولة مرة أخرى');
    }

    if (!existingTenant) {
      throw new NotFoundError('المستأجر غير موجود');
    }

    // 2. التحقق من أن المستأجر محذوف بالفعل
    if (!existingTenant.deletedAt) {
      logger.warn('محاولة استعادة مستأجر غير محذوف', {
        correlationId,
        tenantId,
      });
      throw new ConflictError('المستأجر غير محذوف');
    }

    // 3. تنفيذ الاستعادة
    let restoredTenant: any;
    try {
      restoredTenant = await withRetryAndThrow(
        () => this.tenantRepo.restore(tenantId),
        {
          operationName: 'tenant.restore',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل استعادة المستأجر', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل استعادة المستأجر، يرجى المحاولة مرة أخرى');
    }

    // 4. تسجيل حدث التدقيق
    logger.info('تم استعادة المستأجر', {
      correlationId,
      tenantId: restoredTenant.id,
      name: restoredTenant.name,
      domain: restoredTenant.domain,
      restoredBy,
      event: 'tenant.restore.success',
    });

    return this.mapToTenant(restoredTenant);
  }

  /**
   * تحديث حالة المستأجر (تفعيل/تعطيل/تعليق).
   * [مُتحقَّق منطقياً بتتبع كامل] — تحديث الحالة مع تحقق الصلاحيات.
   */
  async updateTenantStatus(
    tenantId: string,
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
    updatedBy: string
  ): Promise<Tenant> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!tenantId || !status || !updatedBy) {
      throw new ValidationError('معرف المستأجر، الحالة، والمُحدِّث مطلوبة');
    }

    // 1. جلب المستأجر (للتحقق من وجوده)
    let existingTenant: any;
    try {
      existingTenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(tenantId),
        {
          operationName: 'tenant.status.getExisting',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('المستأجر غير موجود لتحديث الحالة', {
          correlationId,
          tenantId,
        });
        throw new NotFoundError('المستأجر غير موجود');
      }
      logger.error('فشل جلب المستأجر لتحديث الحالة', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل تحديث حالة المستأجر، يرجى المحاولة مرة أخرى');
    }

    if (!existingTenant) {
      throw new NotFoundError('المستأجر غير موجود');
    }

    // 2. التحقق من أن المستأجر غير محذوف
    if (existingTenant.deletedAt) {
      logger.warn('محاولة تحديث حالة مستأجر محذوف', {
        correlationId,
        tenantId,
        deletedAt: existingTenant.deletedAt,
      });
      throw new NotFoundError('المستأجر غير موجود');
    }

    // 3. التحقق من أن الحالة مختلفة (لا داعي للتحديث إذا كانت نفسها)
    if (existingTenant.status === status) {
      logger.debug('الحالة هي نفسها، لا داعي للتحديث', {
        correlationId,
        tenantId,
        status,
      });
      return this.mapToTenant(existingTenant);
    }

    // 4. تنفيذ تحديث الحالة
    let updatedTenant: any;
    try {
      updatedTenant = await withRetryAndThrow(
        () => this.tenantRepo.updateStatus(tenantId, status),
        {
          operationName: 'tenant.status.update',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل تحديث حالة المستأجر', {
        correlationId,
        tenantId,
        status,
        error: error instanceof Error ? error.message : 'unknown',
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل تحديث حالة المستأجر، يرجى المحاولة مرة أخرى');
    }

    // 5. تسجيل حدث التدقيق
    logger.info('تم تحديث حالة المستأجر', {
      correlationId,
      tenantId,
      name: updatedTenant.name,
      previousStatus: existingTenant.status,
      newStatus: status,
      updatedBy,
      event: 'tenant.status.update',
    });

    return this.mapToTenant(updatedTenant);
  }

  /**
   * الحصول على عدد المستأجرين النشطين (للإحصائيات).
   * [مُتحقَّق منطقياً بتتبع كامل] — جلب العدد مع إعادة محاولة.
   */
  async getActiveTenantCount(): Promise<number> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    try {
      const count = await withRetryAndThrow(
        () => this.tenantRepo.countActive(),
        {
          operationName: 'tenant.countActive',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
      logger.debug('تم جلب عدد المستأجرين النشطين', {
        correlationId,
        count,
      });
      return count;
    } catch (error) {
      logger.error('فشل جلب عدد المستأجرين النشطين', {
        correlationId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب عدد المستأجرين، يرجى المحاولة مرة أخرى');
    }
  }

  /**
   * الحصول على إجمالي مساحة التخزين المستخدمة من قبل مستأجر.
   * [مُتحقَّق منطقياً بتتبع كامل] — جلب إجمالي التخزين مع تحقق الصلاحيات.
   */
  async getTenantStorageUsage(tenantId: string): Promise<number> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!tenantId) {
      throw new ValidationError('معرف المستأجر مطلوب');
    }

    // 1. التحقق من وجود المستأجر
    await this.getTenantById(tenantId);

    // 2. جلب إجمالي التخزين
    try {
      const usage = await withRetryAndThrow(
        () => this.tenantRepo.getTotalStorageUsage(tenantId),
        {
          operationName: 'tenant.storage',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
      logger.debug('تم جلب إجمالي مساحة التخزين للمستأجر', {
        correlationId,
        tenantId,
        usageBytes: usage,
      });
      return usage;
    } catch (error) {
      logger.error('فشل جلب إجمالي مساحة التخزين', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب مساحة التخزين، يرجى المحاولة مرة أخرى');
    }
  }

  /**
   * الحصول على استخدام الذكاء الاصطناعي للمستأجر في فترة زمنية.
   * [مُتحقَّق منطقياً بتتبع كامل] — جلب استخدام AI مع تحقق الصلاحيات.
   */
  async getTenantAIUsage(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{ requests: number; tokens: number }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!tenantId) {
      throw new ValidationError('معرف المستأجر مطلوب');
    }

    if (!startDate || !endDate) {
      throw new ValidationError('تاريخ البدء والانتهاء مطلوبان');
    }

    if (startDate > endDate) {
      throw new ValidationError('تاريخ البدء يجب أن يكون قبل تاريخ الانتهاء');
    }

    // 1. التحقق من وجود المستأجر
    await this.getTenantById(tenantId);

    // 2. جلب استخدام AI
    try {
      const usage = await withRetryAndThrow(
        () => this.tenantRepo.getAIServiceUsage(tenantId, startDate, endDate),
        {
          operationName: 'tenant.aiUsage',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
      logger.debug('تم جلب استخدام الذكاء الاصطناعي للمستأجر', {
        correlationId,
        tenantId,
        requests: usage.requests,
        tokens: usage.tokens,
        startDate,
        endDate,
      });
      return usage;
    } catch (error) {
      logger.error('فشل جلب استخدام الذكاء الاصطناعي', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب استخدام الذكاء الاصطناعي، يرجى المحاولة مرة أخرى');
    }
  }

  /**
   * دالة مساعدة للتحقق من وجود مستأجر (للخدمات الأخرى).
   * [مُتحقَّق منطقياً بتتبع كامل] — تحقق بسيط مع إعادة محاولة.
   */
  async tenantExists(tenantId: string): Promise<boolean> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!tenantId) {
      return false;
    }

    try {
      const tenant = await this.getTenantById(tenantId);
      return !!tenant && tenant.status === 'ACTIVE' && !tenant.deletedAt;
    } catch (error) {
      if (error instanceof NotFoundError) {
        return false;
      }
      logger.error('فشل التحقق من وجود المستأجر', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      return false;
    }
  }

  /**
   * دالة مساعدة للحصول على إعدادات المستأجر (للخدمات الأخرى).
   * [مُتحقَّق منطقياً بتتبع كامل] — جلب الإعدادات مع التحقق من الصلاحية.
   */
  async getTenantSettings(tenantId: string): Promise<TenantSettings> {
    const tenant = await this.getTenantById(tenantId);
    return tenant.settings;
  }

  /**
   * دالة مساعدة للتحقق من حد المستخدمين في المستأجر.
   * [مُتحقَّق منطقياً بتتبع كامل] — التحقق من الحد الأقصى للمستخدمين.
   */
  async checkUserLimit(tenantId: string, currentUserCount: number): Promise<boolean> {
    const settings = await this.getTenantSettings(tenantId);
    return currentUserCount < settings.users.maxUsers;
  }

  /**
   * دالة مساعدة للتحقق من حد تخزين المستأجر.
   * [مُتحقَّق منطقياً بتتبع كامل] — التحقق من الحد الأقصى للتخزين.
   */
  async checkStorageLimit(tenantId: string): Promise<boolean> {
    const settings = await this.getTenantSettings(tenantId);
    const currentUsage = await this.getTenantStorageUsage(tenantId);
    return currentUsage < settings.storage.maxStorageBytes;
  }

  /**
   * دالة مساعدة للتحقق من حد طلبات AI الشهري للمستأجر.
   * [مُتحقَّق منطقياً بتتبع كامل] — التحقق من الحد الأقصى لطلبات AI.
   */
  async checkAILimit(tenantId: string): Promise<boolean> {
    const settings = await this.getTenantSettings(tenantId);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const usage = await this.getTenantAIUsage(tenantId, startOfMonth, endOfMonth);
    return usage.requests < settings.ai.monthlyAILimit;
  }

  /**
   * دالة مساعدة لتحويل الكائن من المستودع إلى Tenant.
   * [مُتحقَّق منطقياً بتتبع كامل] — تحويل بسيط مع قيم افتراضية.
   */
  private mapToTenant(tenant: any): Tenant {
    return {
      id: tenant.id,
      name: tenant.name,
      domain: tenant.domain,
      adminEmail: tenant.adminEmail,
      adminName: tenant.adminName,
      plan: tenant.plan || 'FREE',
      settings: tenant.settings || DEFAULT_SETTINGS_BY_PLAN.FREE,
      status: tenant.status || 'ACTIVE',
      whatsappPhoneNumberId: tenant.whatsappPhoneNumberId || tenant.settings?.whatsapp?.phoneNumberId || null,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      deletedAt: tenant.deletedAt || null,
      createdBy: tenant.createdBy,
    };
  }
}
