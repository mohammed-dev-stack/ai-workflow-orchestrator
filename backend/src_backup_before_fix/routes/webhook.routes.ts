// ============================================================
// backend/src/routes/webhook.routes.ts
// ============================================================
// مسارات ويب هوك WhatsApp مع معالجة الأحداث الواردة.
// تم إصلاح مشكلة countByConversationId عن طريق تعريفها محلياً باستخدام findByConversationId.
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { WhatsAppService } from '../services/whatsapp.service.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import {
  ValidationError,
  UnauthorizedError,
  InternalServerError,
} from '../middlewares/errorHandler.middleware.js';
import { config } from '../config/index.js';

// استيراد التبعيات
import { repositories } from '../db/index.js';
import { Anthropic } from '@anthropic-ai/sdk';
import { EmbeddingService } from '../services/embedding.service.js';
import { ChatService } from '../services/chat.service.js';

// ============================================================
// مخططات التحقق من صحة المدخلات (Zod Schemas) — الفشل السريع
// ============================================================

/**
 * مخطط التحقق من ويب هوك (GET) — للتسجيل الأولي.
 */
const WebhookVerifySchema = z.object({
  'hub.mode': z.string().default(''),
  'hub.verify_token': z.string().default(''),
  'hub.challenge': z.string().default(''),
});

/**
 * مخطط حمولة ويب هوك الواردة (POST) — التحقق من البنية الأساسية.
 */
const WebhookPayloadSchema = z.object({
  object: z.string().min(1, 'الحقل "object" مطلوب'),
  entry: z.array(
    z.object({
      id: z.string().min(1, 'معرف الإدخال مطلوب'),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.string().optional(),
            metadata: z.object({
              display_phone_number: z.string().optional(),
              phone_number_id: z.string().optional(),
            }).optional(),
            contacts: z.array(
              z.object({
                wa_id: z.string().optional(),
                profile: z.object({
                  name: z.string().optional(),
                }).optional(),
              })
            ).optional(),
            messages: z.array(
              z.object({
                from: z.string().optional(),
                id: z.string().optional(),
                timestamp: z.string().optional(),
                text: z.object({
                  body: z.string().optional(),
                }).optional(),
                type: z.string().optional(),
              })
            ).optional(),
            statuses: z.array(
              z.object({
                id: z.string().optional(),
                status: z.string().optional(),
                timestamp: z.string().optional(),
                recipient_id: z.string().optional(),
              })
            ).optional(),
          }).optional(),
          field: z.string().optional(),
        })
      ).optional(),
    })
  ).optional(),
});

// ============================================================
// مصنع (Factory) لإنشاء مسارات ويب هوك مع حقن التبعيات
// ============================================================

export function createWebhookRoutes(
  whatsappService: WhatsAppService
): Router {
  const router = Router();

  /**
   * GET /webhook
   * التحقق من ويب هوك WhatsApp (للتسجيل الأولي).
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      const validatedQuery = WebhookVerifySchema.parse(req.query);

      const mode = validatedQuery['hub.mode'];
      const token = validatedQuery['hub.verify_token'];
      const challenge = validatedQuery['hub.challenge'];

      if (!mode || !token || !challenge) {
        logger.warn('ويب هوك: معاملات تحقق ناقصة', {
          correlationId,
          hasMode: !!mode,
          hasToken: !!token,
          hasChallenge: !!challenge,
        });
        throw new ValidationError('المعاملات hub.mode, hub.verify_token, hub.challenge مطلوبة');
      }

      const result = whatsappService.verifyWebhook(mode, token, challenge);

      logger.info('ويب هوك: تم التحقق بنجاح', {
        correlationId,
        mode,
        challenge,
      });

      res.status(200).send(result);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        res.status(403).send('فشل التحقق من ويب هوك');
        return;
      }
      next(error);
    }
  });

  /**
   * POST /webhook
   * استقبال ويب هوك WhatsApp (رسائل وحالات).
   */
  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      const signature = req.headers['x-hub-signature-256'] as string || '';
      const secret = config.whatsapp.verifyToken;

      if (!req.body || typeof req.body !== 'object') {
        logger.warn('ويب هوك: حمولة فارغة أو غير صالحة', {
          correlationId,
        });
        throw new ValidationError('الحمولة مطلوبة');
      }

      const validatedPayload = WebhookPayloadSchema.parse(req.body);

      if (validatedPayload.object !== 'whatsapp_business_account') {
        logger.info('ويب هوك: تجاهل كائن غير WhatsApp', {
          correlationId,
          object: validatedPayload.object,
        });
        res.status(200).json({ received: true, processed: false, message: 'تجاهل' });
        return;
      }

      if (!validatedPayload.entry || validatedPayload.entry.length === 0) {
        logger.info('ويب هوك: لا توجد إدخالات للمعالجة', {
          correlationId,
        });
        res.status(200).json({ received: true, processed: false, message: 'لا توجد بيانات' });
        return;
      }

      const result = await whatsappService.handleIncomingWebhook(
        req.body,
        signature,
        secret
      );

      logger.info('ويب هوك: تمت المعالجة', {
        correlationId,
        processed: result.processed,
        messageCount: result.messageCount,
      });

      res.status(200).json({
        received: true,
        processed: result.processed,
        messageCount: result.messageCount,
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        logger.warn('ويب هوك: توقيع غير صالح', {
          correlationId,
          error: error.message,
        });
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'توقيع ويب هوك غير صالح',
        });
        return;
      }

      if (error instanceof ValidationError) {
        logger.warn('ويب هوك: حمولة غير صالحة', {
          correlationId,
          error: error.message,
        });
        res.status(400).json({
          error: 'INVALID_PAYLOAD',
          message: 'حمولة ويب هوك غير صالحة',
        });
        return;
      }

      next(error);
    }
  });

  /**
   * POST /webhook/test
   * نقطة نهاية اختبارية لإرسال رسالة ويب هوك (للتطوير فقط).
   */
  if (config.env.isDevelopment) {
    router.post('/test', async (req: Request, res: Response, next: NextFunction) => {
      const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

      try {
        if (!req.user) {
          throw new UnauthorizedError('يجب المصادقة أولاً');
        }

        const { phoneNumberId, message, tenantId } = req.body;

        if (!phoneNumberId || !message || !tenantId) {
          throw new ValidationError('phoneNumberId, message, tenantId مطلوبة');
        }

        const mockPayload = {
          object: 'whatsapp_business_account',
          entry: [
            {
              id: 'test-entry',
              changes: [
                {
                  value: {
                    messaging_product: 'whatsapp',
                    metadata: {
                      display_phone_number: 'test',
                      phone_number_id: phoneNumberId,
                    },
                    contacts: [
                      {
                        wa_id: 'test-user',
                        profile: {
                          name: 'Test User',
                        },
                      },
                    ],
                    messages: [
                      {
                        from: 'test-user',
                        id: `test-${Date.now()}`,
                        timestamp: String(Date.now()),
                        text: {
                          body: message,
                        },
                        type: 'text',
                      },
                    ],
                  },
                  field: 'messages',
                },
              ],
            },
          ],
        };

        const result = await whatsappService.handleIncomingWebhook(
          mockPayload,
          '',
          config.whatsapp.verifyToken
        );

        logger.info('ويب هوك اختباري: تمت المعالجة', {
          correlationId,
          phoneNumberId,
          messageLength: message.length,
          userId: req.user.userId,
        });

        res.status(200).json({
          success: true,
          message: 'تم إرسال ويب هوك اختباري بنجاح',
          result,
        });
      } catch (error) {
        next(error);
      }
    });
  }

  return router;
}

// ============================================================
// إنشاء مثيلات الخدمات مع التبعيات (حقن يدوي)
// ============================================================

function createWhatsAppService(): WhatsAppService {
  // إنشاء المستودعات المطلوبة لـ WhatsAppService
  const conversationRepo = {
    findByTenantIdAndPhone: (tenantId: string, phoneNumberId: string) =>
      repositories.conversation.findByTenantIdAndPhone(tenantId, phoneNumberId),
    create: (data: any) => repositories.conversation.create(data),
    update: (id: string, data: any) => repositories.conversation.update(id, data),
  };

  // ✅ تم إصلاح مشكلة countByConversationId هنا:
  // تعريف دالة محلية تستخدم repositories.message.findByConversationId لحساب العدد
  const messageRepo = {
    create: (data: any) => repositories.message.create(data),
    findByExternalId: (externalId: string) =>
      repositories.message.findByExternalId(externalId),
    // ✅ إضافة الدالة المفقودة countByConversationId
    countByConversationId: async (conversationId: string) => {
      const result = await repositories.message.findByConversationId(conversationId);
      return result.total; // أو result.items.length إذا لم يكن total موجوداً
    },
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

  // إنشاء مستودعات المحادثة والرسائل لـ ChatService
  const convRepo = {
    findById: (id: string) => repositories.conversation.findById(id),
    findByTenantIdAndPhone: (tenantId: string, phoneNumberId: string) =>
      repositories.conversation.findByTenantIdAndPhone(tenantId, phoneNumberId),
    findByTenantId: (tenantId: string, options?: { limit?: number; offset?: number }) =>
      repositories.conversation.findByTenantId(tenantId, options),
    create: (data: any) => repositories.conversation.create(data),
    update: (id: string, data: any) => repositories.conversation.update(id, data),
    softDelete: (id: string) => repositories.conversation.softDelete(id),
  };

  const msgRepo = {
    findById: (id: string) => repositories.message.findById(id),
    findByConversationId: (conversationId: string, options?: { limit?: number; offset?: number }) =>
      repositories.message.findByConversationId(conversationId, options),
    create: (data: any) => repositories.message.create(data),
    update: (id: string, data: any) => repositories.message.update(id, data),
    deleteByConversationId: (conversationId: string) =>
      repositories.message.deleteByConversationId(conversationId),
    // ✅ نفس الإصلاح هنا أيضاً
    countByConversationId: async (conversationId: string) => {
      const result = await repositories.message.findByConversationId(conversationId);
      return result.total;
    },
    findByExternalId: (externalId: string) =>
      repositories.message.findByExternalId(externalId),
  };

  const kbRepo = {
    findById: (id: string) => repositories.knowledgeBase.findById(id),
    findByTenantId: (tenantId: string, options?: { limit?: number; offset?: number; search?: string }) =>
      repositories.knowledgeBase.findByTenantId(tenantId, options),
  };

  // إنشاء ChatService
  const chatService = new ChatService(
    convRepo as any,
    msgRepo as any,
    kbRepo as any,
    embeddingService as any,
    anthropicClient
  );

  // إنشاء WhatsAppService
  const whatsappService = new WhatsAppService(
    conversationRepo as any,
    messageRepo as any,
    chatService as any,
    tenantRepo as any
  );

  return whatsappService;
}

/**
 * إنشاء المسارات وتصديرها كـ Router.
 */
const whatsappService = createWhatsAppService();
const webhookRoutes = createWebhookRoutes(whatsappService);

export default webhookRoutes;
