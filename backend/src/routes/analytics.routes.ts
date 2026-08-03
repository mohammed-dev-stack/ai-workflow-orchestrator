// ============================================================
// backend/src/routes/analytics.routes.ts
// ============================================================
// مسارات التحليلات (Analytics Routes)
// ✅ تم إصلاح جميع المشاكل جذرياً باستخدام prisma مباشرة
//    بدلاً من الاعتماد على repositories الغير مكتملة.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AnalyticsService } from '../services/analytics.service'; // ✅ named export
import { logger } from '../observability/logger';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import { requireRole } from '../middlewares/auth.middleware.js';
import { ForbiddenError } from '../middlewares/errorHandler.middleware.js';
import { prisma } from '../db/index.js';

// ============================================================
// مخططات التحقق من صحة المدخلات (Zod Schemas)
// ============================================================

const DashboardMetricsSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  useCache: z.enum(['true', 'false']).optional().default('true'),
});

const ConversationTrendsSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
  useCache: z.enum(['true', 'false']).optional().default('true'),
});

const AIPerformanceSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  useCache: z.enum(['true', 'false']).optional().default('true'),
});

const DocumentStatusSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  useCache: z.enum(['true', 'false']).optional().default('true'),
});

const MessageRoleSchema = z.object({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  useCache: z.enum(['true', 'false']).optional().default('true'),
});

const StorageUsageSchema = z.object({
  useCache: z.enum(['true', 'false']).optional().default('true'),
});

const InvalidateCacheSchema = z.object({
  tenantId: z.string().uuid('معرف المستأجر غير صالح').optional(),
});

// ============================================================
// مصنع (Factory) لإنشاء مسارات التحليلات
// ============================================================

export function createAnalyticsRoutes(
  analyticsService: AnalyticsService
): Router {
  const router = Router();

  router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
    try {
      if (!req.user) throw new ForbiddenError('يجب المصادقة أولاً');
      const validatedQuery = DashboardMetricsSchema.parse(req.query);

      const metrics = await analyticsService.getDashboardMetrics({
        tenantId: req.user.tenantId,
        startDate: validatedQuery.startDate,
        endDate: validatedQuery.endDate,
        useCache: validatedQuery.useCache === 'true',
      });

      logger.debug('تم جلب مقاييس لوحة المعلومات', { correlationId, tenantId: req.user.tenantId });
      res.status(200).json({ success: true, data: metrics });
    } catch (error) {
      next(error);
    }
  });

  router.get('/trends', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
    try {
      if (!req.user) throw new ForbiddenError('يجب المصادقة أولاً');
      const validatedQuery = ConversationTrendsSchema.parse(req.query);

      const trends = await analyticsService.getConversationTrends({
        tenantId: req.user.tenantId,
        startDate: validatedQuery.startDate,
        endDate: validatedQuery.endDate,
        groupBy: validatedQuery.groupBy,
        useCache: validatedQuery.useCache === 'true',
      });

      logger.debug('تم جلب اتجاهات المحادثات', { correlationId, dataPoints: trends.data.length });
      res.status(200).json({ success: true, data: trends });
    } catch (error) {
      next(error);
    }
  });

  router.get('/ai-performance', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
    try {
      if (!req.user) throw new ForbiddenError('يجب المصادقة أولاً');
      const validatedQuery = AIPerformanceSchema.parse(req.query);

      const performance = await analyticsService.getAIPerformance({
        tenantId: req.user.tenantId,
        startDate: validatedQuery.startDate,
        endDate: validatedQuery.endDate,
        useCache: validatedQuery.useCache === 'true',
      });

      logger.debug('تم جلب أداء الذكاء الاصطناعي', { correlationId });
      res.status(200).json({ success: true, data: performance });
    } catch (error) {
      next(error);
    }
  });

  router.get('/documents/status', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
    try {
      if (!req.user) throw new ForbiddenError('يجب المصادقة أولاً');
      const validatedQuery = DocumentStatusSchema.parse(req.query);

      const distribution = await analyticsService.getDocumentStatusDistribution(
        req.user.tenantId,
        validatedQuery.startDate,
        validatedQuery.endDate,
        validatedQuery.useCache === 'true'
      );

      logger.debug('تم جلب توزيع المستندات', { correlationId, length: distribution.length });
      res.status(200).json({ success: true, data: distribution });
    } catch (error) {
      next(error);
    }
  });

  router.get('/messages/roles', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
    try {
      if (!req.user) throw new ForbiddenError('يجب المصادقة أولاً');
      const validatedQuery = MessageRoleSchema.parse(req.query);

      const distribution = await analyticsService.getMessageRoleDistribution(
        req.user.tenantId,
        validatedQuery.startDate,
        validatedQuery.endDate,
        validatedQuery.useCache === 'true'
      );

      logger.debug('تم جلب توزيع الرسائل', { correlationId, length: distribution.length });
      res.status(200).json({ success: true, data: distribution });
    } catch (error) {
      next(error);
    }
  });

  router.get('/storage', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
    try {
      if (!req.user) throw new ForbiddenError('يجب المصادقة أولاً');
      const validatedQuery = StorageUsageSchema.parse(req.query);

      const storageBytes = await analyticsService.getTotalStorageUsage(
        req.user.tenantId,
        validatedQuery.useCache === 'true'
      );

      const storageMB = storageBytes / (1024 * 1024);
      const storageGB = storageBytes / (1024 * 1024 * 1024);

      res.status(200).json({
        success: true,
        data: {
          bytes: storageBytes,
          megabytes: Math.round(storageMB * 100) / 100,
          gigabytes: Math.round(storageGB * 100) / 100,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/cache/invalidate', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
    try {
      if (!req.user) throw new ForbiddenError('يجب المصادقة أولاً');
      const validatedBody = InvalidateCacheSchema.parse(req.body);
      const tenantId = validatedBody.tenantId || req.user.tenantId;

      if (validatedBody.tenantId && validatedBody.tenantId !== req.user.tenantId) {
        if (req.user.role !== 'ADMIN') {
          throw new ForbiddenError('ليس لديك صلاحية مسح التخزين المؤقت لمستأجر آخر');
        }
      }

      await analyticsService.invalidateCache(tenantId);
      logger.info('تم مسح التخزين المؤقت للتحليلات', { correlationId, tenantId });
      res.status(200).json({ success: true, message: 'تم مسح التخزين المؤقت للتحليلات بنجاح', tenantId });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

// ============================================================
// ✅ إنشاء مثيل AnalyticsService مع استخدام PRISMA مباشرة
//    (هنا الحل الجذري لمشكلة الدوال المفقودة)
// ============================================================

function createAnalyticsService(): AnalyticsService {
  // ----- مستودع المحادثات (Conversation) باستخدام Prisma مباشرة -----
  const conversationRepo = {
    countByTenantIdAndDateRange: async (
      tenantId: string,
      startDate: Date,
      endDate: Date,
      status?: string
    ): Promise<number> => {
      const where: any = {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      };
      if (status) where.status = status;
      return prisma.conversation.count({ where });
    },

    countByDateRangeGrouped: async (
      tenantId: string,
      startDate: Date,
      endDate: Date,
      groupBy: 'day' | 'week' | 'month'
    ): Promise<{ date: string; count: number }[]> => {
      // نستخدم SQL الخام لـ PostgreSQL لتجميع التواريخ
      let interval: string;
      if (groupBy === 'day') interval = 'DAY';
      else if (groupBy === 'week') interval = 'WEEK';
      else interval = 'MONTH';

      const result = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT 
          DATE_TRUNC(${groupBy}, "createdAt") as date,
          COUNT(*) as count
        FROM "Conversation"
        WHERE "tenantId" = ${tenantId}::text
          AND "createdAt" BETWEEN ${startDate} AND ${endDate}
          AND "deletedAt" IS NULL
        GROUP BY DATE_TRUNC(${groupBy}, "createdAt")
        ORDER BY date ASC
      `;
      return result.map((r) => ({ date: r.date, count: Number(r.count) }));
    },

    findById: async (id: string) => {
      return prisma.conversation.findUnique({ where: { id, deletedAt: null } });
    },
  };

  // ----- مستودع الرسائل (Message) باستخدام Prisma مباشرة -----
  const messageRepo = {
    countByTenantIdAndDateRange: async (
      tenantId: string,
      startDate: Date,
      endDate: Date,
      role?: string
    ): Promise<number> => {
      const where: any = {
        conversation: { tenantId },
        createdAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      };
      if (role) where.role = role;
      return prisma.message.count({ where });
    },

    countByDateRangeGrouped: async (
      tenantId: string,
      startDate: Date,
      endDate: Date,
      groupBy: 'day' | 'week' | 'month'
    ): Promise<{ date: string; count: number }[]> => {
      const result = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
        SELECT 
          DATE_TRUNC(${groupBy}, m."createdAt") as date,
          COUNT(*) as count
        FROM "Message" m
        INNER JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE c."tenantId" = ${tenantId}::text
          AND m."createdAt" BETWEEN ${startDate} AND ${endDate}
          AND m."deletedAt" IS NULL
          AND c."deletedAt" IS NULL
        GROUP BY DATE_TRUNC(${groupBy}, m."createdAt")
        ORDER BY date ASC
      `;
      return result.map((r) => ({ date: r.date, count: Number(r.count) }));
    },

    countByRoleAndDateRange: async (
      tenantId: string,
      startDate: Date,
      endDate: Date
    ): Promise<{ role: string; count: number }[]> => {
      const result = await prisma.$queryRaw<{ role: string; count: bigint }[]>`
        SELECT 
          m.role,
          COUNT(*) as count
        FROM "Message" m
        INNER JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE c."tenantId" = ${tenantId}::text
          AND m."createdAt" BETWEEN ${startDate} AND ${endDate}
          AND m."deletedAt" IS NULL
          AND c."deletedAt" IS NULL
        GROUP BY m.role
      `;
      return result.map((r) => ({ role: r.role, count: Number(r.count) }));
    },
  };

  // ----- مستودع المستندات (Document) باستخدام Prisma مباشرة (كما في السابق) -----
  const documentRepo = {
    countByTenantIdAndDateRange: async (
      tenantId: string,
      startDate: Date,
      endDate: Date,
      status?: string
    ): Promise<number> => {
      const where: any = {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        deletedAt: null,
      };
      if (status) where.status = status;
      return prisma.document.count({ where });
    },

    countByStatusAndDateRange: async (
      tenantId: string,
      startDate: Date,
      endDate: Date
    ): Promise<{ status: string; count: number }[]> => {
      const result = await prisma.$queryRaw<{ status: string; count: bigint }[]>`
        SELECT "status", COUNT(*) as count
        FROM "documents"
        WHERE "tenantId" = ${tenantId}::text
          AND "createdAt" BETWEEN ${startDate} AND ${endDate}
          AND "deletedAt" IS NULL
        GROUP BY "status"
      `;
      return result.map((r) => ({ status: r.status, count: Number(r.count) }));
    },

    countByKnowledgeBaseIdAndDateRange: async (
      knowledgeBaseId: string,
      startDate: Date,
      endDate: Date
    ): Promise<number> => {
      return prisma.document.count({
        where: {
          knowledgeBaseId,
          createdAt: { gte: startDate, lte: endDate },
          deletedAt: null,
        },
      });
    },

    getTotalStorageSize: async (tenantId: string): Promise<number> => {
      const result = await prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COALESCE(SUM("fileSize"), 0) as total
        FROM "documents"
        WHERE "tenantId" = ${tenantId}::text AND "deletedAt" IS NULL
      `;
      return Number(result[0]?.total || 0);
    },
  };

  // ----- مستودع المستأجر (Tenant) باستخدام Prisma مباشرة -----
  const tenantRepo = {
    findById: async (id: string) => {
      return prisma.tenant.findUnique({ where: { id, deletedAt: null } });
    },
  };

  // إنشاء الخدمة مع جميع المستودعات المعاد تعريفها باستخدام Prisma
  const analyticsService = new AnalyticsService(
    conversationRepo,
    messageRepo,
    documentRepo,
    tenantRepo
    // cacheRepo: اختياري
  );

  return analyticsService;
}

// ============================================================
// التصدير النهائي
// ============================================================
const analyticsService = createAnalyticsService();
const analyticsRoutes = createAnalyticsRoutes(analyticsService);

export default analyticsRoutes;

