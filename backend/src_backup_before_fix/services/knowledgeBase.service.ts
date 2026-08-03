// ============================================================
// backend/src/services/knowledgeBase.service.ts
// ============================================================
// خدمة إدارة قواعد المعرفة (Knowledge Base Service).
// تم إصلاح مشكلة `updatedBy` (غير موجود في Prisma schema).
// تم إضافة Hard Delete لضمان حذف نهائي من قاعدة البيانات.
// ============================================================

import { randomUUID } from 'crypto';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
  AppError,
} from '../middlewares/errorHandler.middleware.js';
import { withRetryAndThrow } from '../utils/retry.js';

// ============================================================
// 1. واجهات المستودعات (Repositories Interfaces)
// ============================================================

/**
 * واجهة مستودع قاعدة المعرفة.
 */
export interface IKnowledgeBaseRepository {
  findById(id: string): Promise<any>;
  findByTenantId(
    tenantId: string,
    options?: { limit?: number; offset?: number; search?: string }
  ): Promise<{ items: any[]; total: number }>;
  findByName(tenantId: string, name: string): Promise<any>;
  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  softDelete(id: string): Promise<any>;
  restore(id: string): Promise<any>;
  hardDelete(id: string): Promise<any>; // ✅ جديد: حذف فعلي
  countDocuments(knowledgeBaseId: string): Promise<number>;
  findDocuments(
    knowledgeBaseId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ items: any[]; total: number }>;
  deleteDocumentChunks(documentId: string): Promise<any>; // ✅ جديد: حذف مقاطع المستندات
  deleteDocument(documentId: string): Promise<any>; // ✅ جديد: حذف المستند
}

/**
 * واجهة مستودع المستأجر (للتحقق من وجود المستأجر).
 */
export interface ITenantRepositoryForKB {
  findById(tenantId: string): Promise<any>;
}

// ============================================================
// 2. تعريفات البيانات (Data Types)
// ============================================================

/**
 * خيارات إنشاء قاعدة المعرفة.
 */
export interface CreateKnowledgeBaseData {
  name: string;
  description?: string;
  tenantId: string;
  createdBy: string;
  isActive?: boolean;
  tags?: string[];
  idempotencyKey?: string;
}

/**
 * خيارات تحديث قاعدة المعرفة.
 * ✅ تم إزالة `updatedBy` لأنه غير موجود في Prisma schema.
 */
export interface UpdateKnowledgeBaseData {
  knowledgeBaseId: string;
  tenantId: string;
  name?: string;
  description?: string;
  isActive?: boolean;
  tags?: string[];
  idempotencyKey?: string;
  // ❌ removed updatedBy – غير موجود في Prisma
}

/**
 * خيارات جلب قائمة قواعد المعرفة.
 */
export interface ListKnowledgeBasesOptions {
  tenantId: string;
  limit?: number;
  offset?: number;
  search?: string;
  isActive?: boolean;
}

/**
 * نتيجة جلب قائمة قواعد المعرفة.
 */
export interface ListKnowledgeBasesResult {
  items: {
    id: string;
    name: string;
    description: string | null;
    isActive: boolean;
    tags: string[];
    documentCount: number;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
  }[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * تمثيل قاعدة المعرفة.
 */
export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  tenantId: string;
  isActive: boolean;
  tags: string[];
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  deletedAt: Date | null;
}

// ============================================================
// 3. الخدمة الرئيسية (Service)
// ============================================================

/**
 * خدمة إدارة قواعد المعرفة.
 * تحتوي على منطق الأعمال الخالص CRUD مع عزل المستأجرين.
 */
export class KnowledgeBaseService {
  private kbRepo: IKnowledgeBaseRepository;
  private tenantRepo: ITenantRepositoryForKB;

  constructor(kbRepo: IKnowledgeBaseRepository, tenantRepo: ITenantRepositoryForKB) {
    this.kbRepo = kbRepo;
    this.tenantRepo = tenantRepo;
  }

  // ============================================================
  // 3.1 دوال مساعدة (Helpers)
  // ============================================================

  /**
   * التحقق من وجود المستأجر.
   */
  private async validateTenant(tenantId: string, correlationId: string): Promise<void> {
    if (!tenantId) {
      throw new ValidationError('معرف المستأجر مطلوب');
    }

    const tenant = await withRetryAndThrow(
      () => this.tenantRepo.findById(tenantId),
      {
        operationName: 'kb.validateTenant',
        maxAttempts: 3,
        verboseLogging: false,
      }
    );

    if (!tenant) {
      logger.warn('محاولة الوصول إلى مستأجر غير موجود', {
        correlationId,
        tenantId,
      });
      throw new ValidationError('المستأجر غير موجود');
    }
  }

  /**
   * التحقق من صحة الاسم (تنقية المدخلات).
   */
  private validateName(name: string): { valid: boolean; message?: string } {
    if (!name || name.trim().length === 0) {
      return { valid: false, message: 'اسم قاعدة المعرفة مطلوب' };
    }
    const trimmed = name.trim();
    if (trimmed.length < 3) {
      return { valid: false, message: 'اسم قاعدة المعرفة يجب أن يكون 3 أحرف على الأقل' };
    }
    if (trimmed.length > 100) {
      return { valid: false, message: 'اسم قاعدة المعرفة يجب أن لا يتجاوز 100 حرف' };
    }
    if (/[<>{}[\]|\\]/.test(trimmed)) {
      return { valid: false, message: 'اسم قاعدة المعرفة يحتوي على رموز غير مسموح بها' };
    }
    return { valid: true };
  }

  /**
   * التحقق من صحة العلامات (tags).
   */
  private validateTags(tags?: string[]): { valid: boolean; message?: string } {
    if (!tags || tags.length === 0) {
      return { valid: true };
    }
    if (tags.length > 20) {
      return { valid: false, message: 'لا يمكن إضافة أكثر من 20 علامة' };
    }
    for (const tag of tags) {
      if (tag.length > 50) {
        return { valid: false, message: 'كل علامة يجب أن لا تتجاوز 50 حرفاً' };
      }
      if (/[<>{}[\]|\\]/.test(tag)) {
        return { valid: false, message: 'العلامات تحتوي على رموز غير مسموح بها' };
      }
    }
    return { valid: true };
  }

  /**
   * تحويل كائن المستودع إلى KnowledgeBase.
   */
  private mapToKnowledgeBase(kb: any): KnowledgeBase {
    return {
      id: kb.id,
      name: kb.name,
      description: kb.description || null,
      tenantId: kb.tenantId,
      isActive: kb.isActive !== undefined ? kb.isActive : true,
      tags: kb.tags || [],
      documentCount: kb.documentCount || 0,
      createdAt: kb.createdAt,
      updatedAt: kb.updatedAt,
      createdBy: kb.createdBy,
      deletedAt: kb.deletedAt || null,
    };
  }

  // ============================================================
  // 3.2 عمليات الإنشاء والقراءة (Create & Read)
  // ============================================================

  /**
   * إنشاء قاعدة معرفة جديدة.
   */
  async createKnowledgeBase(data: CreateKnowledgeBaseData): Promise<KnowledgeBase> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const {
      name,
      description,
      tenantId,
      createdBy,
      isActive = true,
      tags = [],
      idempotencyKey,
    } = data;

    if (!name || !tenantId || !createdBy) {
      logger.warn('محاولة إنشاء قاعدة معرفة ببيانات ناقصة', {
        correlationId,
        hasName: !!name,
        hasTenantId: !!tenantId,
        hasCreatedBy: !!createdBy,
        idempotencyKey,
      });
      throw new ValidationError('الاسم، معرف المستأجر، والمنشئ مطلوبة');
    }

    const nameValidation = this.validateName(name);
    if (!nameValidation.valid) {
      logger.warn('محاولة إنشاء قاعدة معرفة باسم غير صالح', {
        correlationId,
        name,
        reason: nameValidation.message,
        idempotencyKey,
      });
      throw new ValidationError(nameValidation.message || 'الاسم غير صالح');
    }

    const tagsValidation = this.validateTags(tags);
    if (!tagsValidation.valid) {
      logger.warn('محاولة إنشاء قاعدة معرفة بعلامات غير صالحة', {
        correlationId,
        tags,
        reason: tagsValidation.message,
        idempotencyKey,
      });
      throw new ValidationError(tagsValidation.message || 'العلامات غير صالحة');
    }

    const sanitizedName = name.trim();
    const sanitizedDescription = description?.trim() || null;
    const sanitizedTags = tags.map((t) => t.trim()).filter((t) => t.length > 0);

    await this.validateTenant(tenantId, correlationId);

    // التحقق من عدم وجود اسم مكرر في نفس المستأجر (حتى المحذوفة)
    let existingKB: any;
    try {
      existingKB = await withRetryAndThrow(
        () => this.kbRepo.findByName(tenantId, sanitizedName),
        {
          operationName: 'kb.create.checkDuplicate',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        logger.error('فشل التحقق من وجود قاعدة المعرفة أثناء الإنشاء', {
          correlationId,
          tenantId,
          name: sanitizedName,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        throw new InternalServerError('فشل التحقق من الاسم، يرجى المحاولة مرة أخرى');
      }
    }

    if (existingKB) {
      logger.warn('محاولة إنشاء قاعدة معرفة باسم مكرر', {
        correlationId,
        tenantId,
        name: sanitizedName,
        existingKBId: existingKB.id,
        idempotencyKey,
      });
      throw new ConflictError('توجد قاعدة معرفة بنفس الاسم في هذا المستأجر');
    }

    const kbData = {
      name: sanitizedName,
      description: sanitizedDescription,
      tenantId,
      isActive,
      tags: sanitizedTags,
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    let newKB: any;
    try {
      newKB = await withRetryAndThrow(
        () => this.kbRepo.create(kbData),
        {
          operationName: 'kb.create',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل إنشاء قاعدة المعرفة', {
        correlationId,
        tenantId,
        name: sanitizedName,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل إنشاء قاعدة المعرفة، يرجى المحاولة مرة أخرى');
    }

    logger.info('تم إنشاء قاعدة معرفة جديدة', {
      correlationId,
      knowledgeBaseId: newKB.id,
      name: newKB.name,
      tenantId: newKB.tenantId,
      createdBy,
      idempotencyKey,
      event: 'kb.create.success',
    });

    return this.mapToKnowledgeBase(newKB);
  }

  /**
   * جلب قاعدة معرفة بواسطة المعرف (مع التحقق من الصلاحيات).
   */
  async getKnowledgeBaseById(knowledgeBaseId: string, tenantId: string): Promise<KnowledgeBase> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!knowledgeBaseId || !tenantId) {
      throw new ValidationError('معرف قاعدة المعرفة ومعرف المستأجر مطلوبان');
    }

    await this.validateTenant(tenantId, correlationId);

    let kb: any;
    try {
      kb = await withRetryAndThrow(
        () => this.kbRepo.findById(knowledgeBaseId),
        {
          operationName: 'kb.getById',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('قاعدة المعرفة غير موجودة', {
          correlationId,
          knowledgeBaseId,
          tenantId,
        });
        throw new NotFoundError('قاعدة المعرفة غير موجودة');
      }
      logger.error('فشل جلب قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب قاعدة المعرفة، يرجى المحاولة مرة أخرى');
    }

    if (!kb) {
      throw new NotFoundError('قاعدة المعرفة غير موجودة');
    }

    if (kb.tenantId !== tenantId) {
      logger.warn('محاولة الوصول إلى قاعدة معرفة لا تنتمي للمستأجر', {
        correlationId,
        knowledgeBaseId,
        requestedTenantId: tenantId,
        actualTenantId: kb.tenantId,
      });
      throw new ForbiddenError('ليس لديك صلاحية الوصول إلى هذه قاعدة المعرفة');
    }

    if (kb.deletedAt) {
      logger.warn('محاولة الوصول إلى قاعدة معرفة محذوفة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        deletedAt: kb.deletedAt,
      });
      throw new NotFoundError('قاعدة المعرفة غير موجودة');
    }

    logger.debug('تم جلب قاعدة المعرفة', {
      correlationId,
      knowledgeBaseId,
      tenantId,
    });

    return this.mapToKnowledgeBase(kb);
  }

  /**
   * جلب قائمة قواعد المعرفة لمستأجر معين.
   */
  async listKnowledgeBases(options: ListKnowledgeBasesOptions): Promise<ListKnowledgeBasesResult> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const {
      tenantId,
      limit = config.pagination.defaultLimit,
      offset = 0,
      search,
      isActive,
    } = options;

    if (!tenantId) {
      throw new ValidationError('معرف المستأجر مطلوب');
    }

    const safeLimit = Math.min(Math.max(1, limit), config.pagination.maxLimit);
    const safeOffset = Math.max(0, offset);

    await this.validateTenant(tenantId, correlationId);

    let result: { items: any[]; total: number };
    try {
      result = await withRetryAndThrow(
        () =>
          this.kbRepo.findByTenantId(tenantId, {
            limit: safeLimit,
            offset: safeOffset,
            search,
          }),
        {
          operationName: 'kb.list',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل جلب قائمة قواعد المعرفة', {
        correlationId,
        tenantId,
        limit: safeLimit,
        offset: safeOffset,
        search,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب قائمة قواعد المعرفة، يرجى المحاولة مرة أخرى');
    }

    let filteredItems = result.items;
    if (isActive !== undefined) {
      filteredItems = filteredItems.filter((item) => item.isActive === isActive);
    }

    const itemsWithCount = await Promise.all(
      filteredItems.map(async (item) => {
        let documentCount = 0;
        try {
          documentCount = await this.kbRepo.countDocuments(item.id);
        } catch (error) {
          logger.warn('فشل حساب عدد المستندات لقاعدة المعرفة', {
            correlationId,
            knowledgeBaseId: item.id,
            error: error instanceof Error ? error.message : 'unknown',
          });
        }
        return {
          ...item,
          documentCount,
        };
      })
    );

    logger.debug('تم جلب قائمة قواعد المعرفة', {
      correlationId,
      tenantId,
      total: result.total,
      returned: itemsWithCount.length,
      limit: safeLimit,
      offset: safeOffset,
    });

    return {
      items: itemsWithCount.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        isActive: item.isActive,
        tags: item.tags || [],
        documentCount: item.documentCount || 0,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        createdBy: item.createdBy,
      })),
      total: result.total,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  // ============================================================
  // 3.3 عمليات التحديث (Update)
  // ============================================================

  /**
   * تحديث قاعدة معرفة موجودة.
   * ✅ تم إزالة `updatedBy` لأنه غير موجود في Prisma schema.
   */
  async updateKnowledgeBase(data: UpdateKnowledgeBaseData): Promise<KnowledgeBase> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const {
      knowledgeBaseId,
      tenantId,
      name,
      description,
      isActive,
      tags,
      idempotencyKey,
    } = data;

    if (!knowledgeBaseId || !tenantId) {
      logger.warn('محاولة تحديث قاعدة معرفة ببيانات ناقصة', {
        correlationId,
        hasKnowledgeBaseId: !!knowledgeBaseId,
        hasTenantId: !!tenantId,
        idempotencyKey,
      });
      throw new ValidationError('معرف قاعدة المعرفة ومعرف المستأجر مطلوبة');
    }

    await this.validateTenant(tenantId, correlationId);

    let existingKB: any;
    try {
      existingKB = await withRetryAndThrow(
        () => this.kbRepo.findById(knowledgeBaseId),
        {
          operationName: 'kb.update.getExisting',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('قاعدة المعرفة غير موجودة للتحديث', {
          correlationId,
          knowledgeBaseId,
          tenantId,
          idempotencyKey,
        });
        throw new NotFoundError('قاعدة المعرفة غير موجودة');
      }
      logger.error('فشل جلب قاعدة المعرفة للتحديث', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل تحديث قاعدة المعرفة، يرجى المحاولة مرة أخرى');
    }

    if (!existingKB) {
      throw new NotFoundError('قاعدة المعرفة غير موجودة');
    }

    if (existingKB.tenantId !== tenantId) {
      logger.warn('محاولة تحديث قاعدة معرفة لا تنتمي للمستأجر', {
        correlationId,
        knowledgeBaseId,
        requestedTenantId: tenantId,
        actualTenantId: existingKB.tenantId,
        idempotencyKey,
      });
      throw new ForbiddenError('ليس لديك صلاحية تحديث هذه قاعدة المعرفة');
    }

    if (existingKB.deletedAt) {
      logger.warn('محاولة تحديث قاعدة معرفة محذوفة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        deletedAt: existingKB.deletedAt,
        idempotencyKey,
      });
      throw new NotFoundError('قاعدة المعرفة غير موجودة');
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (name !== undefined) {
      const nameValidation = this.validateName(name);
      if (!nameValidation.valid) {
        logger.warn('محاولة تحديث قاعدة معرفة باسم غير صالح', {
          correlationId,
          name,
          reason: nameValidation.message,
          idempotencyKey,
        });
        throw new ValidationError(nameValidation.message || 'الاسم غير صالح');
      }
      const sanitizedName = name.trim();

      if (sanitizedName !== existingKB.name) {
        let duplicateKB: any;
        try {
          duplicateKB = await withRetryAndThrow(
            () => this.kbRepo.findByName(tenantId, sanitizedName),
            {
              operationName: 'kb.update.checkDuplicate',
              idempotencyKey,
              maxAttempts: 3,
              verboseLogging: false,
            }
          );
        } catch (error) {
          if (!(error instanceof NotFoundError)) {
            logger.error('فشل التحقق من الاسم المكرر أثناء التحديث', {
              correlationId,
              tenantId,
              name: sanitizedName,
              error: error instanceof Error ? error.message : 'unknown',
              idempotencyKey,
            });
            throw new InternalServerError('فشل تحديث قاعدة المعرفة، يرجى المحاولة مرة أخرى');
          }
        }

        if (duplicateKB && duplicateKB.id !== knowledgeBaseId) {
          logger.warn('محاولة تحديث قاعدة معرفة باسم مكرر', {
            correlationId,
            tenantId,
            name: sanitizedName,
            existingKBId: duplicateKB.id,
            idempotencyKey,
          });
          throw new ConflictError('توجد قاعدة معرفة أخرى بنفس الاسم في هذا المستأجر');
        }

        updateData.name = sanitizedName;
      }
    }

    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    if (tags !== undefined) {
      const tagsValidation = this.validateTags(tags);
      if (!tagsValidation.valid) {
        logger.warn('محاولة تحديث قاعدة معرفة بعلامات غير صالحة', {
          correlationId,
          tags,
          reason: tagsValidation.message,
          idempotencyKey,
        });
        throw new ValidationError(tagsValidation.message || 'العلامات غير صالحة');
      }
      updateData.tags = tags.map((t) => t.trim()).filter((t) => t.length > 0);
    }

    let updatedKB: any;
    try {
      updatedKB = await withRetryAndThrow(
        () => this.kbRepo.update(knowledgeBaseId, updateData),
        {
          operationName: 'kb.update',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل تحديث قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل تحديث قاعدة المعرفة، يرجى المحاولة مرة أخرى');
    }

    logger.info('تم تحديث قاعدة المعرفة', {
      correlationId,
      knowledgeBaseId: updatedKB.id,
      name: updatedKB.name,
      tenantId: updatedKB.tenantId,
      updatedFields: Object.keys(updateData).filter((k) => k !== 'updatedAt'),
      idempotencyKey,
      event: 'kb.update.success',
    });

    return this.mapToKnowledgeBase(updatedKB);
  }

  // ============================================================
  // 3.4 عمليات الحذف (Delete)
  // ============================================================

  /**
   * حذف قاعدة معرفة (حذف ناعم – Soft Delete).
   * تُستخدم للحذف العادي مع إمكانية الاستعادة.
   */
  async deleteKnowledgeBase(
    knowledgeBaseId: string,
    tenantId: string,
    deletedBy: string
  ): Promise<void> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!knowledgeBaseId || !tenantId || !deletedBy) {
      throw new ValidationError('معرف قاعدة المعرفة، معرف المستأجر، والمُحذِف مطلوبة');
    }

    await this.validateTenant(tenantId, correlationId);

    let existingKB: any;
    try {
      existingKB = await withRetryAndThrow(
        () => this.kbRepo.findById(knowledgeBaseId),
        {
          operationName: 'kb.delete.getExisting',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('قاعدة المعرفة غير موجودة للحذف', {
          correlationId,
          knowledgeBaseId,
          tenantId,
        });
        throw new NotFoundError('قاعدة المعرفة غير موجودة');
      }
      logger.error('فشل جلب قاعدة المعرفة للحذف', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حذف قاعدة المعرفة، يرجى المحاولة مرة أخرى');
    }

    if (!existingKB) {
      throw new NotFoundError('قاعدة المعرفة غير موجودة');
    }

    if (existingKB.tenantId !== tenantId) {
      logger.warn('محاولة حذف قاعدة معرفة لا تنتمي للمستأجر', {
        correlationId,
        knowledgeBaseId,
        requestedTenantId: tenantId,
        actualTenantId: existingKB.tenantId,
      });
      throw new ForbiddenError('ليس لديك صلاحية حذف هذه قاعدة المعرفة');
    }

    if (existingKB.deletedAt) {
      logger.warn('محاولة حذف قاعدة معرفة محذوفة بالفعل', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        deletedAt: existingKB.deletedAt,
      });
      throw new NotFoundError('قاعدة المعرفة غير موجودة');
    }

    try {
      await withRetryAndThrow(
        () => this.kbRepo.softDelete(knowledgeBaseId),
        {
          operationName: 'kb.delete',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل حذف قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل حذف قاعدة المعرفة، يرجى المحاولة مرة أخرى');
    }

    logger.info('تم حذف قاعدة المعرفة (حذف ناعم)', {
      correlationId,
      knowledgeBaseId,
      name: existingKB.name,
      tenantId,
      deletedBy,
      event: 'kb.delete.success',
    });
  }

  /**
   * ✅ حذف قاعدة معرفة نهائياً (Hard Delete).
   * يحذف القاعدة وجميع المستندات ومقاطعها المرتبطة – لا يمكن التراجع عنه.
   * يجب استخدامه فقط من قبل Admin مع تأكيد إضافي.
   */
  async hardDeleteKnowledgeBase(
    knowledgeBaseId: string,
    tenantId: string,
    deletedBy: string
  ): Promise<void> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!knowledgeBaseId || !tenantId || !deletedBy) {
      throw new ValidationError('معرف قاعدة المعرفة، معرف المستأجر، والمُحذِف مطلوبة');
    }

    await this.validateTenant(tenantId, correlationId);

    let existingKB: any;
    try {
      existingKB = await withRetryAndThrow(
        () => this.kbRepo.findById(knowledgeBaseId),
        {
          operationName: 'kb.hardDelete.getExisting',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('قاعدة المعرفة غير موجودة للحذف النهائي', {
          correlationId,
          knowledgeBaseId,
          tenantId,
        });
        throw new NotFoundError('قاعدة المعرفة غير موجودة');
      }
      logger.error('فشل جلب قاعدة المعرفة للحذف النهائي', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل الحذف النهائي، يرجى المحاولة مرة أخرى');
    }

    if (!existingKB) {
      throw new NotFoundError('قاعدة المعرفة غير موجودة');
    }

    if (existingKB.tenantId !== tenantId) {
      logger.warn('محاولة حذف قاعدة معرفة لا تنتمي للمستأجر', {
        correlationId,
        knowledgeBaseId,
        requestedTenantId: tenantId,
        actualTenantId: existingKB.tenantId,
      });
      throw new ForbiddenError('ليس لديك صلاحية حذف هذه قاعدة المعرفة نهائياً');
    }

    // ✅ 1. حذف جميع المستندات المرتبطة (مع مقاطعها)
    let documents: { items: any[] };
    try {
      documents = await this.kbRepo.findDocuments(knowledgeBaseId);
    } catch (error) {
      logger.error('فشل جلب المستندات المرتبطة بالقاعدة', {
        correlationId,
        knowledgeBaseId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب المستندات، يرجى المحاولة مرة أخرى');
    }

    for (const doc of documents.items) {
      try {
        // حذف مقاطع المستند
        await this.kbRepo.deleteDocumentChunks(doc.id);
        // حذف المستند نفسه
        await this.kbRepo.deleteDocument(doc.id);
      } catch (error) {
        logger.error('فشل حذف المستند المرتبط', {
          correlationId,
          documentId: doc.id,
          knowledgeBaseId,
          error: error instanceof Error ? error.message : 'unknown',
        });
        // نستمر رغم فشل بعض المستندات، لكن نسجل التحذير
      }
    }

    // ✅ 2. حذف قاعدة المعرفة نهائياً
    try {
      await withRetryAndThrow(
        () => this.kbRepo.hardDelete(knowledgeBaseId),
        {
          operationName: 'kb.hardDelete',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل الحذف النهائي لقاعدة المعرفة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل حذف قاعدة المعرفة نهائياً، يرجى المحاولة مرة أخرى');
    }

    logger.info('تم حذف قاعدة المعرفة نهائياً (Hard Delete)', {
      correlationId,
      knowledgeBaseId,
      name: existingKB.name,
      tenantId,
      deletedBy,
      event: 'kb.hardDelete.success',
    });
  }

  /**
   * استعادة قاعدة معرفة محذوفة (Restore).
   */
  async restoreKnowledgeBase(
    knowledgeBaseId: string,
    tenantId: string,
    restoredBy: string
  ): Promise<KnowledgeBase> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!knowledgeBaseId || !tenantId || !restoredBy) {
      throw new ValidationError('معرف قاعدة المعرفة، معرف المستأجر، والمُستعيد مطلوبة');
    }

    await this.validateTenant(tenantId, correlationId);

    let existingKB: any;
    try {
      existingKB = await withRetryAndThrow(
        () => this.kbRepo.findById(knowledgeBaseId),
        {
          operationName: 'kb.restore.getExisting',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        logger.warn('قاعدة المعرفة غير موجودة للاستعادة', {
          correlationId,
          knowledgeBaseId,
          tenantId,
        });
        throw new NotFoundError('قاعدة المعرفة غير موجودة');
      }
      logger.error('فشل جلب قاعدة المعرفة للاستعادة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل استعادة قاعدة المعرفة، يرجى المحاولة مرة أخرى');
    }

    if (!existingKB) {
      throw new NotFoundError('قاعدة المعرفة غير موجودة');
    }

    if (existingKB.tenantId !== tenantId) {
      logger.warn('محاولة استعادة قاعدة معرفة لا تنتمي للمستأجر', {
        correlationId,
        knowledgeBaseId,
        requestedTenantId: tenantId,
        actualTenantId: existingKB.tenantId,
      });
      throw new ForbiddenError('ليس لديك صلاحية استعادة هذه قاعدة المعرفة');
    }

    if (!existingKB.deletedAt) {
      logger.warn('محاولة استعادة قاعدة معرفة غير محذوفة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
      });
      throw new ConflictError('قاعدة المعرفة غير محذوفة');
    }

    let restoredKB: any;
    try {
      restoredKB = await withRetryAndThrow(
        () => this.kbRepo.restore(knowledgeBaseId),
        {
          operationName: 'kb.restore',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل استعادة قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل استعادة قاعدة المعرفة، يرجى المحاولة مرة أخرى');
    }

    logger.info('تم استعادة قاعدة المعرفة', {
      correlationId,
      knowledgeBaseId: restoredKB.id,
      name: restoredKB.name,
      tenantId,
      restoredBy,
      event: 'kb.restore.success',
    });

    return this.mapToKnowledgeBase(restoredKB);
  }

  // ============================================================
  // 3.5 عمليات إحصائية (Statistics)
  // ============================================================

  /**
   * جلب عدد المستندات في قاعدة معرفة.
   */
  async getDocumentCount(knowledgeBaseId: string, tenantId: string): Promise<number> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!knowledgeBaseId || !tenantId) {
      throw new ValidationError('معرف قاعدة المعرفة ومعرف المستأجر مطلوبان');
    }

    await this.validateTenant(tenantId, correlationId);

    let kb: any;
    try {
      kb = await withRetryAndThrow(
        () => this.kbRepo.findById(knowledgeBaseId),
        {
          operationName: 'kb.countDocs.getKB',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundError('قاعدة المعرفة غير موجودة');
      }
      logger.error('فشل جلب قاعدة المعرفة لحساب المستندات', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حساب المستندات، يرجى المحاولة مرة أخرى');
    }

    if (!kb) {
      throw new NotFoundError('قاعدة المعرفة غير موجودة');
    }

    if (kb.tenantId !== tenantId) {
      throw new ForbiddenError('ليس لديك صلاحية الوصول إلى هذه قاعدة المعرفة');
    }

    let count: number;
    try {
      count = await withRetryAndThrow(
        () => this.kbRepo.countDocuments(knowledgeBaseId),
        {
          operationName: 'kb.countDocs',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل حساب المستندات', {
        correlationId,
        knowledgeBaseId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل حساب المستندات، يرجى المحاولة مرة أخرى');
    }

    logger.debug('تم حساب عدد المستندات', {
      correlationId,
      knowledgeBaseId,
      tenantId,
      count,
    });

    return count;
  }
}
