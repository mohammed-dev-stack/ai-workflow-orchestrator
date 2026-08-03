// ============================================================
// backend/src/routes/knowledgeBase.routes.ts
// ============================================================
// مسارات قواعد المعرفة (Knowledge Base Routes).
// تم إضافة نقاط نهاية للحذف النهائي (Hard Delete) مع معامل force.
// تم إزالة الحقل updatedBy من طلب التحديث (غير موجود في Prisma).
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { KnowledgeBaseService } from '../services/knowledgeBase.service';
import { logger } from '../observability/logger';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware';
import { requireRole, AuthenticatedUser } from '../middlewares/auth.middleware';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
} from '../middlewares/errorHandler.middleware';
import { config } from '../config';

// استيراد المستودعات
import { repositories } from '../db';

// ============================================================
// مخططات التحقق من صحة المدخلات (Zod Schemas)
// ============================================================

const CreateKnowledgeBaseSchema = z.object({
  name: z.string()
    .min(3, 'الاسم يجب أن يكون 3 أحرف على الأقل')
    .max(100, 'الاسم يجب أن لا يتجاوز 100 حرف')
    .regex(/^[^<>{}[\]|\\]+$/, 'الاسم يحتوي على رموز غير مسموح بها'),
  description: z.string().max(1000, 'الوصف طويل جداً').optional(),
  isActive: z.boolean().optional(),
  tags: z.array(z.string().max(50, 'العلامة طويلة جداً')).max(20, 'لا يمكن إضافة أكثر من 20 علامة').optional(),
});

const UpdateKnowledgeBaseSchema = z.object({
  name: z.string()
    .min(3, 'الاسم يجب أن يكون 3 أحرف على الأقل')
    .max(100, 'الاسم يجب أن لا يتجاوز 100 حرف')
    .regex(/^[^<>{}[\]|\\]+$/, 'الاسم يحتوي على رموز غير مسموح بها')
    .optional(),
  description: z.string().max(1000, 'الوصف طويل جداً').optional(),
  isActive: z.boolean().optional(),
  tags: z.array(z.string().max(50, 'العلامة طويلة جداً')).max(20, 'لا يمكن إضافة أكثر من 20 علامة').optional(),
});

const ListKnowledgeBasesSchema = z.object({
  limit: z.coerce.number().int().positive().max(config.pagination.maxLimit).default(config.pagination.defaultLimit),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

const KnowledgeBaseIdSchema = z.object({
  id: z.string().uuid('معرف قاعدة المعرفة غير صالح'),
});

const RestoreKnowledgeBaseSchema = z.object({
  restoredBy: z.string().uuid('معرف المستخدم غير صالح'),
});

// ============================================================
// مصنع (Factory) لإنشاء مسارات قواعد المعرفة
// ============================================================

export function createKnowledgeBaseRoutes(
  knowledgeBaseService: KnowledgeBaseService
): Router {
  const router = Router();

  /**
   * GET /api/knowledge-bases
   * جلب قائمة قواعد المعرفة للمستأجر الحالي.
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedQuery = ListKnowledgeBasesSchema.parse(req.query);

      const result = await knowledgeBaseService.listKnowledgeBases({
        tenantId: req.user.tenantId,
        limit: validatedQuery.limit,
        offset: validatedQuery.offset,
        search: validatedQuery.search,
        isActive: validatedQuery.isActive === 'true' ? true : validatedQuery.isActive === 'false' ? false : undefined,
      });

      logger.debug('تم جلب قائمة قواعد المعرفة', {
        correlationId,
        tenantId: req.user.tenantId,
        total: result.total,
        returned: result.items.length,
      });

      res.status(200).json({
        success: true,
        data: result.items,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/knowledge-bases/:id
   * جلب قاعدة معرفة بواسطة المعرف.
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = KnowledgeBaseIdSchema.parse(req.params);

      const kb = await knowledgeBaseService.getKnowledgeBaseById(
        validatedParams.id,
        req.user.tenantId
      );

      logger.debug('تم جلب قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId: kb.id,
        tenantId: req.user.tenantId,
      });

      res.status(200).json({
        success: true,
        data: kb,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/knowledge-bases
   * إنشاء قاعدة معرفة جديدة (يتطلب دور ADMIN).
   */
  router.post('/', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedData = CreateKnowledgeBaseSchema.parse(req.body);

      const sanitizedName = validatedData.name.trim();
      const sanitizedDescription = validatedData.description?.trim() || undefined;
      const sanitizedTags = validatedData.tags?.map(t => t.trim()).filter(t => t.length > 0) || [];

      const newKB = await knowledgeBaseService.createKnowledgeBase({
        name: sanitizedName,
        description: sanitizedDescription,
        tenantId: req.user.tenantId,
        createdBy: req.user.userId,
        isActive: validatedData.isActive !== undefined ? validatedData.isActive : true,
        tags: sanitizedTags,
        idempotencyKey: req.headers['x-idempotency-key'] as string || undefined,
      });

      logger.info('تم إنشاء قاعدة معرفة جديدة', {
        correlationId,
        knowledgeBaseId: newKB.id,
        name: newKB.name,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(201).json({
        success: true,
        data: newKB,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PUT /api/knowledge-bases/:id
   * تحديث قاعدة معرفة موجودة (يتطلب دور ADMIN).
   * ✅ تم إزالة updatedBy لأنه غير موجود في Prisma schema.
   */
  router.put('/:id', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = KnowledgeBaseIdSchema.parse(req.params);
      const validatedData = UpdateKnowledgeBaseSchema.parse(req.body);

      const sanitizedName = validatedData.name?.trim();
      const sanitizedDescription = validatedData.description?.trim();
      const sanitizedTags = validatedData.tags?.map(t => t.trim()).filter(t => t.length > 0);

      // ✅ removed updatedBy from call
      const updatedKB = await knowledgeBaseService.updateKnowledgeBase({
        knowledgeBaseId: validatedParams.id,
        tenantId: req.user.tenantId,
        name: sanitizedName,
        description: sanitizedDescription,
        isActive: validatedData.isActive,
        tags: sanitizedTags,
        idempotencyKey: req.headers['x-idempotency-key'] as string || undefined,
      });

      logger.info('تم تحديث قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId: updatedKB.id,
        name: updatedKB.name,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        data: updatedKB,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/knowledge-bases/:id
   * حذف قاعدة معرفة (حذف ناعم – Soft Delete، يتطلب دور ADMIN).
   */
  router.delete('/:id', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = KnowledgeBaseIdSchema.parse(req.params);

      await knowledgeBaseService.deleteKnowledgeBase(
        validatedParams.id,
        req.user.tenantId,
        req.user.userId
      );

      logger.info('تم حذف قاعدة المعرفة (حذف ناعم)', {
        correlationId,
        knowledgeBaseId: validatedParams.id,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        message: 'تم حذف قاعدة المعرفة بنجاح',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * ✅ DELETE /api/knowledge-bases/:id/hard
   * حذف قاعدة معرفة نهائياً (Hard Delete – يتطلب دور ADMIN).
   * يحذف القاعدة وجميع المستندات ومقاطعها المرتبطة – لا يمكن التراجع عنه.
   */
  router.delete('/:id/hard', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = KnowledgeBaseIdSchema.parse(req.params);

      // ✅ استدعاء الحذف النهائي
      await knowledgeBaseService.hardDeleteKnowledgeBase(
        validatedParams.id,
        req.user.tenantId,
        req.user.userId
      );

      logger.info('تم حذف قاعدة المعرفة نهائياً (Hard Delete)', {
        correlationId,
        knowledgeBaseId: validatedParams.id,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        message: 'تم حذف قاعدة المعرفة نهائياً بنجاح',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/knowledge-bases/:id/restore
   * استعادة قاعدة معرفة محذوفة (يتطلب دور ADMIN).
   */
  router.post('/:id/restore', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = KnowledgeBaseIdSchema.parse(req.params);
      const validatedBody = RestoreKnowledgeBaseSchema.parse(req.body);

      const restoredKB = await knowledgeBaseService.restoreKnowledgeBase(
        validatedParams.id,
        req.user.tenantId,
        validatedBody.restoredBy || req.user.userId
      );

      logger.info('تم استعادة قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId: restoredKB.id,
        name: restoredKB.name,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        data: restoredKB,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/knowledge-bases/:id/documents/count
   * الحصول على عدد المستندات في قاعدة معرفة.
   */
  router.get('/:id/documents/count', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = KnowledgeBaseIdSchema.parse(req.params);

      const count = await knowledgeBaseService.getDocumentCount(
        validatedParams.id,
        req.user.tenantId
      );

      logger.debug('تم حساب عدد المستندات في قاعدة المعرفة', {
        correlationId,
        knowledgeBaseId: validatedParams.id,
        tenantId: req.user.tenantId,
        count,
      });

      res.status(200).json({
        success: true,
        data: { count },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

// ============================================================
// إنشاء مثيل KnowledgeBaseService مع التبعيات
// ============================================================

function createKnowledgeBaseService(): KnowledgeBaseService {
  const kbRepo = {
    findById: (id: string) => repositories.knowledgeBase.findById(id),
    findByTenantId: (tenantId: string, options?: { limit?: number; offset?: number; search?: string }) =>
      repositories.knowledgeBase.findByTenantId(tenantId, options),
    findByName: (tenantId: string, name: string) =>
      repositories.knowledgeBase.findByName(tenantId, name),
    create: (data: any) => repositories.knowledgeBase.create(data),
    update: (id: string, data: any) => repositories.knowledgeBase.update(id, data),
    softDelete: (id: string) => repositories.knowledgeBase.softDelete(id),
    restore: (id: string) => repositories.knowledgeBase.restore(id),
    // ✅ دوال الحذف النهائي (تم إضافتها في KnowledgeBaseRepository)
    hardDelete: (id: string) => repositories.knowledgeBase.hardDelete(id),
    deleteDocument: (id: string) => repositories.knowledgeBase.deleteDocument(id),
    deleteDocumentChunks: (documentId: string) =>
      repositories.knowledgeBase.deleteDocumentChunks(documentId),
    countDocuments: (knowledgeBaseId: string) =>
      repositories.knowledgeBase.countDocuments(knowledgeBaseId),
    findDocuments: (knowledgeBaseId: string, options?: { limit?: number; offset?: number }) =>
      repositories.knowledgeBase.findDocuments(knowledgeBaseId, options),
  };

  const tenantRepo = {
    findById: (id: string) => repositories.tenant.findById(id),
  };

  return new KnowledgeBaseService(kbRepo as any, tenantRepo as any);
}

/**
 * إنشاء المسارات وتصديرها كـ Router.
 */
const knowledgeBaseService = createKnowledgeBaseService();
const knowledgeBaseRoutes = createKnowledgeBaseRoutes(knowledgeBaseService);

export default knowledgeBaseRoutes;

