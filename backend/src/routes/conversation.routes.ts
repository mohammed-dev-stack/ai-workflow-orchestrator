// ============================================================
// backend/src/routes/conversation.routes.ts
// ============================================================
// تم إصلاح مشكلة countByConversationId غير الموجودة في MessageRepository.
// تم استبدالها بـ findByConversationId وحساب العدد مؤقتاً،
// مع إضافة تعليق بأنه يُوصى بإضافة الدالة إلى المستودع.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ChatService } from '../services/chat.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
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

// استيراد المستودعات والخدمات المساعدة
import { repositories } from '../db/index.js';
import { Anthropic } from '@anthropic-ai/sdk';
import { EmbeddingService } from '../services/embedding.service.js';

// ============================================================
// مخططات التحقق من صحة المدخلات (Zod Schemas) — الفشل السريع
// ============================================================

const CreateConversationSchema = z.object({
  phoneNumberId: z.string()
    .min(1, 'رقم الهاتف مطلوب')
    .max(50, 'رقم الهاتف طويل جداً'),
  customerName: z.string().max(100, 'اسم العميل طويل جداً').optional(),
  knowledgeBaseId: z.string().uuid('معرف قاعدة المعرفة غير صالح').optional(),
});

const SendMessageSchema = z.object({
  content: z.string()
    .min(2, 'الرسالة يجب أن تكون حرفين على الأقل')
    .max(10000, 'الرسالة طويلة جداً'),
  knowledgeBaseId: z.string().uuid('معرف قاعدة المعرفة غير صالح').optional(),
  contextChunkLimit: z.coerce.number().int().positive().max(20).default(5),
  similarityThreshold: z.coerce.number().min(0.0).max(1.0).default(0.7),
});

const GetConversationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ListConversationsSchema = z.object({
  limit: z.coerce.number().int().positive().max(config.pagination.maxLimit).default(config.pagination.defaultLimit),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['ACTIVE', 'CLOSED', 'ARCHIVED']).optional(),
  phoneNumberId: z.string().optional(),
});

const ConversationIdSchema = z.object({
  id: z.string().uuid('معرف المحادثة غير صالح'),
});

const CloseConversationSchema = z.object({
  closedBy: z.string().uuid('معرف المستخدم غير صالح').optional(),
});

const DeleteConversationSchema = z.object({
  deletedBy: z.string().uuid('معرف المستخدم غير صالح').optional(),
});

// ============================================================
// مصنع (Factory) لإنشاء مسارات المحادثات مع حقن التبعيات
// ============================================================

export function createConversationRoutes(
  chatService: ChatService,
  whatsappService: WhatsAppService
): Router {
  const router = Router();

  /**
   * POST /api/conversations
   */
  router.post('/', requireRole(['ADMIN', 'AGENT']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedData = CreateConversationSchema.parse(req.body);
      const sanitizedPhoneNumber = validatedData.phoneNumberId.trim();
      const sanitizedCustomerName = validatedData.customerName?.trim();

      const newConversation = await chatService.createConversation({
        tenantId: req.user.tenantId,
        phoneNumberId: sanitizedPhoneNumber,
        customerName: sanitizedCustomerName,
        knowledgeBaseId: validatedData.knowledgeBaseId,
        createdBy: req.user.userId,
        idempotencyKey: req.headers['x-idempotency-key'] as string || undefined,
      });

      logger.info('تم إنشاء محادثة جديدة', {
        correlationId,
        conversationId: newConversation.id,
        phoneNumberId: newConversation.phoneNumberId,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(201).json({
        success: true,
        data: newConversation,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/conversations
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedQuery = ListConversationsSchema.parse(req.query);

      const result = await chatService.listConversations({
        tenantId: req.user.tenantId,
        limit: validatedQuery.limit,
        offset: validatedQuery.offset,
        status: validatedQuery.status,
        phoneNumberId: validatedQuery.phoneNumberId,
      });

      logger.debug('تم جلب قائمة المحادثات', {
        correlationId,
        tenantId: req.user.tenantId,
        total: result.total,
        returned: result.items.length,
        status: validatedQuery.status,
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
   * GET /api/conversations/:id
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = ConversationIdSchema.parse(req.params);
      const validatedQuery = GetConversationSchema.parse(req.query);

      const result = await chatService.getConversation({
        conversationId: validatedParams.id,
        tenantId: req.user.tenantId,
        limit: validatedQuery.limit,
        offset: validatedQuery.offset,
      });

      logger.debug('تم جلب المحادثة', {
        correlationId,
        conversationId: result.conversation.id,
        tenantId: req.user.tenantId,
        messageCount: result.messages.length,
        totalMessages: result.totalMessages,
      });

      res.status(200).json({
        success: true,
        data: {
          conversation: result.conversation,
          messages: result.messages,
          totalMessages: result.totalMessages,
        },
        pagination: {
          limit: validatedQuery.limit,
          offset: validatedQuery.offset,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/conversations/:id/messages
   */
  router.post('/:id/messages', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = ConversationIdSchema.parse(req.params);
      const validatedData = SendMessageSchema.parse(req.body);
      const sanitizedContent = validatedData.content.trim();

      const result = await chatService.sendMessage({
        conversationId: validatedParams.id,
        tenantId: req.user.tenantId,
        content: sanitizedContent,
        role: 'USER',
        sentBy: req.user.userId,
        knowledgeBaseId: validatedData.knowledgeBaseId,
        contextChunkLimit: validatedData.contextChunkLimit,
        similarityThreshold: validatedData.similarityThreshold,
        idempotencyKey: req.headers['x-idempotency-key'] as string || undefined,
      });

      logger.info('تم إرسال رسالة وتوليد رد', {
        correlationId,
        conversationId: validatedParams.id,
        userMessageId: result.userMessage.id,
        assistantMessageId: result.assistantMessage.id,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
        contextChunksCount: result.contextChunks.length,
      });

      res.status(200).json({
        success: true,
        data: {
          userMessage: result.userMessage,
          assistantMessage: result.assistantMessage,
          contextChunks: result.contextChunks,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/conversations/:id/close
   */
  router.post('/:id/close', requireRole(['ADMIN', 'AGENT']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = ConversationIdSchema.parse(req.params);
      const validatedBody = CloseConversationSchema.parse(req.body);

      const closedConversation = await chatService.closeConversation(
        validatedParams.id,
        req.user.tenantId,
        validatedBody.closedBy || req.user.userId
      );

      logger.info('تم إغلاق المحادثة', {
        correlationId,
        conversationId: closedConversation.id,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        data: closedConversation,
        message: 'تم إغلاق المحادثة بنجاح',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * DELETE /api/conversations/:id
   */
  router.delete('/:id', requireRole(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = ConversationIdSchema.parse(req.params);
      const validatedBody = DeleteConversationSchema.parse(req.body);

      await chatService.deleteConversation(
        validatedParams.id,
        req.user.tenantId,
        validatedBody.deletedBy || req.user.userId
      );

      logger.info('تم حذف المحادثة', {
        correlationId,
        conversationId: validatedParams.id,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        message: 'تم حذف المحادثة بنجاح',
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/conversations/:id/send-whatsapp
   */
  router.post('/:id/send-whatsapp', requireRole(['ADMIN', 'AGENT']), async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      if (!req.user) {
        throw new ForbiddenError('يجب المصادقة أولاً');
      }

      const validatedParams = ConversationIdSchema.parse(req.params);
      const validatedData = SendMessageSchema.parse(req.body);
      const sanitizedContent = validatedData.content.trim();

      const conversation = await chatService.getConversation({
        conversationId: validatedParams.id,
        tenantId: req.user.tenantId,
        limit: 1,
        offset: 0,
      });

      if (!conversation.conversation.phoneNumberId) {
        throw new ValidationError('رقم الهاتف غير متوفر في هذه المحادثة');
      }

      const whatsappResult = await whatsappService.sendMessage({
        tenantId: req.user.tenantId,
        to: conversation.conversation.phoneNumberId,
        text: sanitizedContent,
        conversationId: validatedParams.id,
        knowledgeBaseId: validatedData.knowledgeBaseId,
        idempotencyKey: req.headers['x-idempotency-key'] as string || undefined,
      });

      logger.info('تم إرسال رسالة WhatsApp يدوياً', {
        correlationId,
        conversationId: validatedParams.id,
        messageId: whatsappResult.messageId,
        tenantId: req.user.tenantId,
        userId: req.user.userId,
      });

      res.status(200).json({
        success: true,
        data: {
          messageId: whatsappResult.messageId,
          status: whatsappResult.status,
          timestamp: whatsappResult.timestamp,
        },
        message: 'تم إرسال الرسالة عبر WhatsApp بنجاح',
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

// ============================================================
// إنشاء مثيلات الخدمات مع التبعيات (حقن يدوي)
// ============================================================

function createServices() {
  // إنشاء المستودعات
  const conversationRepo = {
    findById: (id: string) => repositories.conversation.findById(id),
    findByTenantIdAndPhone: (tenantId: string, phoneNumberId: string) =>
      repositories.conversation.findByTenantIdAndPhone(tenantId, phoneNumberId),
    findByTenantId: (tenantId: string, options?: { limit?: number; offset?: number }) =>
      repositories.conversation.findByTenantId(tenantId, options),
    create: (data: any) => repositories.conversation.create(data),
    update: (id: string, data: any) => repositories.conversation.update(id, data),
    softDelete: (id: string) => repositories.conversation.softDelete(id),
    countByTenantIdAndDateRange: (tenantId: string, startDate: Date, endDate: Date, status?: string) =>
      repositories.conversation.countByTenantIdAndDateRange(tenantId, startDate, endDate, status),
    countByDateRangeGrouped: (tenantId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month') =>
      repositories.conversation.countByDateRangeGrouped(tenantId, startDate, endDate, groupBy),
  };

  // ✅ تم إصلاح المشكلة هنا:
  // استخدمنا repositories.message.findByConversationId ثم حسبنا العدد.
  // ملاحظة: يُوصى بإضافة countByConversationId إلى MessageRepository مستقبلاً.
  const messageRepo = {
    findById: (id: string) => repositories.message.findById(id),
    findByConversationId: (conversationId: string, options?: { limit?: number; offset?: number }) =>
      repositories.message.findByConversationId(conversationId, options),
    create: (data: any) => repositories.message.create(data),
    update: (id: string, data: any) => repositories.message.update(id, data),
    deleteByConversationId: (conversationId: string) =>
      repositories.message.deleteByConversationId(conversationId),
    // ✅ الدالة countByConversationId غير موجودة، نستخدم الحل البديل:
    countByConversationId: async (conversationId: string) => {
      const result = await repositories.message.findByConversationId(conversationId);
      return result.items.length; // العدد الفعلي للرسائل
    },
    findByExternalId: (externalId: string) =>
      repositories.message.findByExternalId(externalId),
    countByTenantIdAndDateRange: (tenantId: string, startDate: Date, endDate: Date, role?: string) =>
      repositories.message.countByTenantIdAndDateRange(tenantId, startDate, endDate, role),
    countByDateRangeGrouped: (tenantId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month') =>
      repositories.message.countByDateRangeGrouped(tenantId, startDate, endDate, groupBy),
    countByRoleAndDateRange: (tenantId: string, startDate: Date, endDate: Date) =>
      repositories.message.countByRoleAndDateRange(tenantId, startDate, endDate),
  };

  const kbRepo = {
    findById: (id: string) => repositories.knowledgeBase.findById(id),
    findByTenantId: (tenantId: string, options?: { limit?: number; offset?: number; search?: string }) =>
      repositories.knowledgeBase.findByTenantId(tenantId, options),
  };

  const tenantRepo = {
    findById: (id: string) => repositories.tenant.findById(id),
    findByPhoneNumberId: (phoneNumberId: string) =>
      repositories.tenant.findByPhoneNumberId(phoneNumberId),
  };

  // إنشاء عميل Anthropic
  const anthropicClient = new Anthropic({
    apiKey: config.anthropic.apiKey,
  });

  // إنشاء خدمة التضمين (EmbeddingService)
  const chunkRepo = {
    create: (data: any) => repositories.documentChunk.create(data),
    bulkCreate: (data: any[]) => repositories.documentChunk.bulkCreate(data),
    findByDocumentId: (documentId: string) =>
      repositories.documentChunk.findByDocumentId(documentId),
    deleteByDocumentId: (documentId: string) =>
      repositories.documentChunk.deleteByDocumentId(documentId),
    countByDocumentId: (documentId: string) =>
      repositories.documentChunk.countByDocumentId(documentId),
    findSimilarVectors: (vector: number[], limit: number, knowledgeBaseId: string, threshold?: number) =>
      repositories.documentChunk.findSimilarVectors(vector, limit, knowledgeBaseId, threshold),
  };

  const docRepoForEmbedding = {
    findById: (id: string) => repositories.document.findById(id),
    updateStatus: (id: string, status: string, errorMessage?: string) =>
      repositories.document.updateStatus(id, status, errorMessage),
  };

  const embeddingService = new EmbeddingService(
    chunkRepo as any,
    docRepoForEmbedding as any,
    anthropicClient
  );

  // إنشاء خدمة المحادثة (ChatService)
  const chatService = new ChatService(
    conversationRepo as any,
    messageRepo as any,
    kbRepo as any,
    embeddingService as any,
    anthropicClient
  );

  // إنشاء خدمة WhatsApp
  const conversationRepoForWhatsApp = {
    findByTenantIdAndPhone: (tenantId: string, phoneNumberId: string) =>
      repositories.conversation.findByTenantIdAndPhone(tenantId, phoneNumberId),
    create: (data: any) => repositories.conversation.create(data),
    update: (id: string, data: any) => repositories.conversation.update(id, data),
  };

  const messageRepoForWhatsApp = {
    create: (data: any) => repositories.message.create(data),
    findByExternalId: (externalId: string) =>
      repositories.message.findByExternalId(externalId),
  };

  const tenantRepoForWhatsApp = {
    findById: (id: string) => repositories.tenant.findById(id),
    findByPhoneNumberId: (phoneNumberId: string) =>
      repositories.tenant.findByPhoneNumberId(phoneNumberId),
  };

  const whatsappService = new WhatsAppService(
    conversationRepoForWhatsApp as any,
    messageRepoForWhatsApp as any,
    chatService as any,
    tenantRepoForWhatsApp as any
  );

  return { chatService, whatsappService };
}

/**
 * إنشاء المسارات وتصديرها كـ Router.
 */
const { chatService, whatsappService } = createServices();
const conversationRoutes = createConversationRoutes(chatService, whatsappService);

export default conversationRoutes;

