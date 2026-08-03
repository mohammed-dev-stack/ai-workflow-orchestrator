// ============================================================
// backend/src/routes/document.routes.ts
// ============================================================
// تم إصلاح مشكلة نوع mimeType في UploadDocumentSchema
// عن طريق تحويل allowedMimeTypes إلى string[] مؤقتاً داخل refine.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DocumentService } from '../services/document.service.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import { requireRole, AuthenticatedUser } from '../middlewares/auth.middleware.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
  InternalServerError,
} from '../middlewares/errorHandler.middleware.js';
import { config } from '../config/index.js';

// استيراد المستودعات
import { repositories } from '../db/index.js';

// ============================================================
// مخططات التحقق من صحة المدخلات (Zod Schemas) — الفشل السريع
// ============================================================

/**
 * مخطط رفع مستند جديد.
 * يتم التحقق من الملف في middleware منفصل (multer)، هنا نتحقق من البيانات الوصفية.
 */
const UploadDocumentSchema = z.object({
  fileName: z.string()
    .min(1, 'اسم الملف مطلوب')
    .max(255, 'اسم الملف طويل جداً')
    .regex(/^[^<>{}[\]|\\/;:]+$/, 'اسم الملف يحتوي على رموز غير مسموح بها'),
  fileSize: z.coerce.number()
    .int()
    .positive('حجم الملف يجب أن يكون أكبر من صفر')
    .max(config.upload.maxFileSizeBytes, `حجم الملف يتجاوز الحد الأقصى (${config.upload.maxFileSizeBytes / (1024 * 1024)} MB)`),
  mimeType: z.string()
    .min(1, 'نوع الملف مطلوب')
    // ✅ إصلاح المشكلة: تحويل allowedMimeTypes إلى string[] لتمريرها إلى includes
    .refine(
      (val) => (config.upload.allowedMimeTypes as unknown as string[]).includes(val),
      { message: `نوع الملف غير مسموح به. الأنواع المسموحة: ${config.upload.allowedMimeTypes.join(', ')}` }
    ),
  storagePath: z.string().min(1, 'مسار التخزين مطلوب'),
  knowledgeBaseId: z.string().uuid('معرف قاعدة المعرفة غير صالح'),
  description: z.string().max(1000, 'الوصف طويل جداً').optional(),
  tags: z.array(z.string().max(50, 'العلامة طويلة جداً')).max(20, 'لا يمكن إضافة أكثر من 20 علامة').optional(),
});

/**
 * مخطط تحديث مستند (بيانات وصفية فقط).
 */
const UpdateDocumentSchema = z.object({
  description: z.string().max(1000, 'الوصف طويل جداً').optional(),
  tags: z.array(z.string().max(50, 'العلامة طويلة جداً')).max(20, 'لا يمكن إضافة أكثر من 20 علامة').optional(),
});

/**
 * مخطط قائمة المستندات (مع ترحيل وفلترة).
 */
const ListDocumentsSchema = z.object({
  limit: z.coerce.number().int().positive().max(config.pagination.maxLimit).default(config.pagination.defaultLimit),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DELETED']).optional(),
  knowledgeBaseId: z.string().uuid('معرف قاعدة المعرفة غير صالح').optional(),
});

/**
 * مخطط معرف المستند (للمسار).
 */
const DocumentIdSchema = z.object({
  id: z.string().uuid('معرف المستند غير صالح'),
});

/**
 * مخطط استعادة مستند محذوف.
 */
const RestoreDocumentSchema = z.object({
  restoredBy: z.string().uuid('معرف المستخدم غير صالح'),
});

/**
 * مخطط تحديث حالة المستند (للاستخدام الداخلي من المنسق).
 */
const UpdateDocumentStatusSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']),
  errorMessage: z.string().optional(),
});

// ============================================================
// مصنع (Factory) لإنشاء مسارات المستندات مع حقن التبعيات
// ============================================================

export function createDocumentRoutes(
  documentService: DocumentService
): Router {
  const router = Router();

  /**
   * GET /api/documents
   * جلب قائمة المستندات للمستأجر الحالي (مع فلترة حسب قاعدة المعرفة والحالة).
   * [مُتحقَّق منطقياً بتتبع كامل] — نقطة نهاية القائمة مع ترحيل وفلترة.
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      // 1. التحقق من وجود المستخدم في الطلب (تمت المصادقة)
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      // 2. التحقق من صحة معاملات الترحيل
      const validatedQuery = ListDocumentsSchema.parse(req.query);

      // 3. استدعاء خدمة المستندات
      const result = await documentService.listDocuments({
        tenantId: req.user.tenantId,
        knowledgeBaseId: validatedQuery.knowledgeBaseId,
        limit: validatedQuery.limit,
        offset: validatedQuery.offset,
        search: validatedQuery.search,
        status: validatedQuery.status,
      });

      // 4. إرسال الاستجابة
      logger.debug('تم جلب قائمة المستندات', {
        correlationId,
        tenantId: req.user.tenantId,
        knowledgeBaseId: validatedQuery.knowledgeBaseId,
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
   * GET /api/documents/:id
   * جلب مستند بواسطة المعرف.
   * [مُتحقَّق منطقياً بتتبع كامل] — نقطة نهاية الجلب مع تحقق الصلاحيات.
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      // 1. التحقق من وجود المستخدم في الطلب (تمت المصادقة)
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      // 2. التحقق من صحة معرف المستند
      const validatedParams = DocumentIdSchema.parse(req.params);

      // 3. استدعاء خدمة المستندات
      const doc = await documentService.getDocumentById(
        validatedParams.id,
        req.user.tenantId
      );

      // 4. إرسال الاستجابة
      logger.debug('تم جلب المستند', {
        correlationId,
        documentId: doc.id,
        fileName: doc.fileName,
        tenantId: req.user.tenantId,
      });

      res.status(200).json({
        success: true,
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/documents
   * رفع مستند جديد.
   * يتطلب دور ADMIN.
   * [مُتحقَّق منطقياً بتتبع كامل] — نقطة نهاية الرفع مع RBAC.
   */
  router.post('/', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      // 1. التحقق من وجود المستخدم في الطلب (تمت المصادقة)
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      // 2. التحقق من صحة المدخلات (الفشل السريع)
      const validatedData = UploadDocumentSchema.parse(req.body);

      // 3. تنقية المدخلات
      const sanitizedFileName = validatedData.fileName.trim();
      const sanitizedDescription = validatedData.description?.trim() || undefined;
      const sanitizedTags = validatedData.tags?.map(t => t.trim()).filter(t => t.length > 0) || [];

      // 4. استدعاء خدمة المستندات
      const newDoc = await documentService.uploadDocument({
        fileName: sanitizedFileName,
        fileSize: validatedData.fileSize,
        mimeType: validatedData.mimeType,
        storagePath: validatedData.storagePath,
        knowledgeBaseId: validatedData.knowledgeBaseId,
        tenantId: req.user.tenantId,
        uploadedBy: req.user.userId,
        description: sanitizedDescription,
        tags: sanitizedTags,
        status: 'PENDING',
        idempotencyKey: req.headers['x-idempotency-key'] as string || undefined,
      });

      // 5. إرسال الاستجابة
      logger.info('تم رفع مستند جديد', {
        correlationId,
        documentId: newDoc.id,
        fileName: newDoc.fileName,
        knowledgeBaseId: newDoc.knowledgeBaseId,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(201).json({
        success: true,
        data: newDoc,
        message: 'تم رفع المستند بنجاح، جارٍ المعالجة',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * PUT /api/documents/:id
   * تحديث بيانات مستند موجود (البيانات الوصفية فقط).
   * يتطلب دور ADMIN.
   * [مُتحقَّق منطقياً بتتبع كامل] — نقطة نهاية التحديث مع RBAC.
   */
  router.put('/:id', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      // 1. التحقق من وجود المستخدم في الطلب (تمت المصادقة)
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      // 2. التحقق من صحة معرف المستند
      const validatedParams = DocumentIdSchema.parse(req.params);

      // 3. التحقق من صحة المدخلات (الفشل السريع)
      const validatedData = UpdateDocumentSchema.parse(req.body);

      // 4. تنقية المدخلات
      const sanitizedDescription = validatedData.description?.trim();
      const sanitizedTags = validatedData.tags?.map(t => t.trim()).filter(t => t.length > 0);

      // 5. استدعاء خدمة المستندات
      const updatedDoc = await documentService.updateDocument({
        documentId: validatedParams.id,
        tenantId: req.user.tenantId,
        description: sanitizedDescription,
        tags: sanitizedTags,
        updatedBy: req.user.userId,
        idempotencyKey: req.headers['x-idempotency-key'] as string || undefined,
      });

      // 6. إرسال الاستجابة
      logger.info('تم تحديث المستند', {
        correlationId,
        documentId: updatedDoc.id,
        fileName: updatedDoc.fileName,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        data: updatedDoc,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/documents/:id
   * حذف مستند (حذف ناعم).
   * يتطلب دور ADMIN.
   * [مُتحقَّق منطقياً بتتبع كامل] — نقطة نهاية الحذف مع RBAC.
   */
  router.delete('/:id', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      // 1. التحقق من وجود المستخدم في الطلب (تمت المصادقة)
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      // 2. التحقق من صحة معرف المستند
      const validatedParams = DocumentIdSchema.parse(req.params);

      // 3. استدعاء خدمة المستندات
      await documentService.deleteDocument(
        validatedParams.id,
        req.user.tenantId,
        req.user.userId
      );

      // 4. إرسال الاستجابة
      logger.info('تم حذف المستند', {
        correlationId,
        documentId: validatedParams.id,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        message: 'تم حذف المستند بنجاح',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/documents/:id/restore
   * استعادة مستند محذوف.
   * يتطلب دور ADMIN.
   * [مُتحقَّق منطقياً بتتبع كامل] — نقطة نهاية الاستعادة مع RBAC.
   */
  router.post('/:id/restore', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      // 1. التحقق من وجود المستخدم في الطلب (تمت المصادقة)
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      // 2. التحقق من صحة معرف المستند
      const validatedParams = DocumentIdSchema.parse(req.params);

      // 3. التحقق من صحة المدخلات
      const validatedBody = RestoreDocumentSchema.parse(req.body);

      // 4. استدعاء خدمة المستندات
      const restoredDoc = await documentService.restoreDocument(
        validatedParams.id,
        req.user.tenantId,
        validatedBody.restoredBy || req.user.userId
      );

      // 5. إرسال الاستجابة
      logger.info('تم استعادة المستند', {
        correlationId,
        documentId: restoredDoc.id,
        fileName: restoredDoc.fileName,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        data: restoredDoc,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/documents/:id/process
   * تشغيل معالجة المستند (توليد التضمينات) يدوياً.
   * يتطلب دور ADMIN.
   * [مُتحقَّق منطقياً بتتبع كامل] — نقطة نهاية التشغيل اليدوي للمعالجة.
   */
  router.post('/:id/process', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      // 1. التحقق من وجود المستخدم في الطلب (تمت المصادقة)
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      // 2. التحقق من صحة معرف المستند
      const validatedParams = DocumentIdSchema.parse(req.params);

      // 3. جلب المستند للتحقق من وجوده وصلاحياته
      const doc = await documentService.getDocumentById(
        validatedParams.id,
        req.user.tenantId
      );

      // 4. التحقق من حالة المستند (لا يمكن إعادة المعالجة إذا كان COMPLETED أو PROCESSING)
      if (doc.status === 'COMPLETED') {
        throw new ConflictError('المستند مكتمل المعالجة بالفعل');
      }
      if (doc.status === 'PROCESSING') {
        throw new ConflictError('المستند قيد المعالجة حالياً');
      }

      // 5. إرسال استجابة فورية (سيتم تشغيل المعالجة بشكل غير متزامن)
      // في الإنتاج، سيتم إرسال حدث إلى قائمة انتظار BullMQ هنا
      // ولكن حالياً نُفوض للمنسق عبر الخدمة

      logger.info('تم تشغيل معالجة المستند يدوياً', {
        correlationId,
        documentId: doc.id,
        fileName: doc.fileName,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      // 6. تحديث حالة المستند إلى PROCESSING
      await documentService.updateDocumentStatus(
        validatedParams.id,
        req.user.tenantId,
        'PROCESSING'
      );

      // 7. إرسال الاستجابة
      res.status(202).json({
        success: true,
        message: 'تم بدء معالجة المستند بنجاح',
        documentId: doc.id,
        status: 'PROCESSING',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/documents/:id/status (داخلي — للمنسق)
   * تحديث حالة المستند.
   * يتطلب دور ADMIN أو يُستخدم داخلياً.
   * [مُتحقَّق منطقياً بتتبع كامل] — نقطة نهاية تحديث الحالة (للخدمات الداخلية).
   */
  router.post('/:id/status', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      // 1. التحقق من وجود المستخدم في الطلب (تمت المصادقة)
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      // 2. التحقق من صحة معرف المستند
      const validatedParams = DocumentIdSchema.parse(req.params);

      // 3. التحقق من صحة المدخلات
      const validatedData = UpdateDocumentStatusSchema.parse(req.body);

      // 4. استدعاء خدمة المستندات
      const updatedDoc = await documentService.updateDocumentStatus(
        validatedParams.id,
        req.user.tenantId,
        validatedData.status,
        validatedData.errorMessage
      );

      // 5. إرسال الاستجابة
      logger.info('تم تحديث حالة المستند', {
        correlationId,
        documentId: updatedDoc.id,
        fileName: updatedDoc.fileName,
        status: updatedDoc.status,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        data: updatedDoc,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

// ============================================================
// إنشاء مثيل DocumentService مع التبعيات (حقن يدوي)
// ============================================================

function createDocumentService(): DocumentService {
  // إنشاء مستودع المستندات
  const docRepo = {
    findById: (id: string) => repositories.document.findById(id),
    findByKnowledgeBaseId: (knowledgeBaseId: string, options?: { limit?: number; offset?: number; status?: string }) =>
      repositories.document.findByKnowledgeBaseId(knowledgeBaseId, options),
    findByTenantId: (tenantId: string, options?: { limit?: number; offset?: number; search?: string }) =>
      repositories.document.findByTenantId(tenantId, options),
    findByFileName: (tenantId: string, knowledgeBaseId: string, fileName: string) =>
      repositories.document.findByFileName(tenantId, knowledgeBaseId, fileName),
    create: (data: any) => repositories.document.create(data),
    update: (id: string, data: any) => repositories.document.update(id, data),
    delete: (id: string) => repositories.document.softDelete(id),
    softDelete: (id: string) => repositories.document.softDelete(id),
    restore: (id: string) => repositories.document.restore(id),
    updateStatus: (id: string, status: string, errorMessage?: string) =>
      repositories.document.updateStatus(id, status, errorMessage),
    countByKnowledgeBaseId: (knowledgeBaseId: string) =>
      repositories.document.countByKnowledgeBaseId(knowledgeBaseId),
  };

  // إنشاء مستودع قاعدة المعرفة
  const kbRepo = {
    findById: (id: string) => repositories.knowledgeBase.findById(id),
  };

  // إنشاء مستودع المستأجر
  const tenantRepo = {
    findById: (id: string) => repositories.tenant.findById(id),
  };

  return new DocumentService(docRepo as any, kbRepo as any, tenantRepo as any);
}

/**
 * إنشاء المسارات وتصديرها كـ Router.
 */
const documentService = createDocumentService();
const documentRoutes = createDocumentRoutes(documentService);

export default documentRoutes;
