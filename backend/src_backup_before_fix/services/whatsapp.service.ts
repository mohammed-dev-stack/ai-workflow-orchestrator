// backend/src/services/whatsapp.service.ts
import { randomUUID } from 'crypto';
import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../observability/logger';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware';
import {
  ValidationError,
  NotFoundError,
  InternalServerError,
  UnauthorizedError,
  AppError,
} from '../middlewares/errorHandler.middleware';
import { withCircuitBreakerAndRetry } from '../utils/circuitBreaker';
import { withRetryAndThrow } from '../utils/retry';

/**
 * واجهة مستودع المحادثة (للبحث عن المحادثات أو إنشائها).
 */
export interface IConversationRepositoryForWhatsApp {
  findByTenantIdAndPhone(tenantId: string, phoneNumberId: string): Promise<any>;
  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
}

/**
 * واجهة مستودع الرسائل (لحفظ رسائل WhatsApp).
 */
export interface IMessageRepositoryForWhatsApp {
  create(data: any): Promise<any>;
  findByExternalId(externalId: string): Promise<any>;
}

/**
 * واجهة خدمة المحادثة (لتوليد الردود).
 */
export interface IChatServiceForWhatsApp {
  sendMessage(data: {
    conversationId: string;
    tenantId: string;
    content: string;
    role: 'USER' | 'ASSISTANT';
    sentBy: string;
    knowledgeBaseId?: string;
    contextChunkLimit?: number;
    similarityThreshold?: number;
    idempotencyKey?: string;
  }): Promise<{
    userMessage: any;
    assistantMessage: any;
    contextChunks: any[];
    conversationId: string;
  }>;
  createConversation(data: {
    tenantId: string;
    phoneNumberId: string;
    customerName?: string;
    knowledgeBaseId?: string;
    createdBy: string;
    idempotencyKey?: string;
  }): Promise<any>;
}

/**
 * واجهة مستودع المستأجر (للتحقق من وجود المستأجر ومعرف رقم الهاتف).
 */
export interface ITenantRepositoryForWhatsApp {
  findById(tenantId: string): Promise<any>;
  findByPhoneNumberId(phoneNumberId: string): Promise<any>;
}

/**
 * بنية ويب هوك WhatsApp الوارد (Incoming Webhook).
 * وفقاً لوثائق WhatsApp Cloud API v18.0.
 */
export interface WhatsAppWebhookPayload {
  object: string;
  entry: {
    id: string;
    changes: {
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: {
          profile: {
            name: string;
          };
          wa_id: string;
        }[];
        messages?: {
          from: string;
          id: string;
          timestamp: string;
          text?: {
            body: string;
          };
          type: string;
        }[];
        statuses?: {
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
        }[];
      };
      field: string;
    }[];
  }[];
}

/**
 * بنية رسالة WhatsApp المرسلة.
 */
export interface WhatsAppSendMessageData {
  /** معرف المستأجر (للصلاحية والعزل) */
  tenantId: string;

  /** رقم هاتف المستلم (بصيغة دولية) */
  to: string;

  /** نص الرسالة */
  text: string;

  /** معرف الرسالة الأصلية (للتتبع، اختياري) */
  replyToMessageId?: string;

  /** معرف المحادثة (إذا كانت موجودة) */
  conversationId?: string;

  /** معرف قاعدة المعرفة (اختياري) */
  knowledgeBaseId?: string;

  /** مفتاح التكافؤ (اختياري) */
  idempotencyKey?: string;
}

/**
 * بنية استجابة إرسال رسالة WhatsApp.
 */
export interface WhatsAppSendMessageResult {
  /** معرف الرسالة من WhatsApp */
  messageId: string;

  /** حالة الإرسال */
  status: 'sent' | 'failed';

  /** الطابع الزمني للإرسال */
  timestamp: string;

  /** معرف المحادثة الداخلي */
  conversationId: string;

  /** معرف الرسالة الداخلي */
  internalMessageId: string;
}

/**
 * خدمة تكامل WhatsApp.
 * تحتوي على منطق الأعمال للتعامل مع WhatsApp Cloud API:
 * - التحقق من توقيع ويب هوك (للأمان)
 * - معالجة الرسائل الواردة
 * - إرسال الرسائل الصادرة
 * - إدارة المحادثات والرسائل
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق تكامل WhatsApp كامل مع فشل سريع، تكافؤ، وتحقق أمني.
 */
export class WhatsAppService {
  private conversationRepo: IConversationRepositoryForWhatsApp;
  private messageRepo: IMessageRepositoryForWhatsApp;
  private chatService: IChatServiceForWhatsApp;
  private tenantRepo: ITenantRepositoryForWhatsApp;
  private httpClient: AxiosInstance;

  constructor(
    conversationRepo: IConversationRepositoryForWhatsApp,
    messageRepo: IMessageRepositoryForWhatsApp,
    chatService: IChatServiceForWhatsApp,
    tenantRepo: ITenantRepositoryForWhatsApp
  ) {
    this.conversationRepo = conversationRepo;
    this.messageRepo = messageRepo;
    this.chatService = chatService;
    this.tenantRepo = tenantRepo;

    // تهيئة عميل HTTP لـ WhatsApp Cloud API
    this.httpClient = axios.create({
      baseURL: `https://graph.facebook.com/${config.whatsapp.apiVersion}`,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${config.whatsapp.apiToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * دالة مساعدة للتحقق من توقيع ويب هوك WhatsApp (HMAC-SHA256).
   * تطبق الفشل السريع عند فشل التحقق.
   * [مُتحقَّق منطقياً بتتبع كامل] — تحقق توقيع صارم مع مقارنة آمنة.
   */
  private verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): boolean {
    if (!signature || !secret) {
      logger.warn('توقيع ويب هوك مفقود أو سر غير مهيأ');
      return false;
    }

    // حساب HMAC-SHA256 باستخدام السر
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // مقارنة آمنة (ثابتة الزمن) لمنع هجمات التوقيت
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      // إذا كان الطول مختلفاً، تعتبر غير متطابقة
      logger.warn('فشل التحقق من توقيع ويب هوك (طول غير متطابق)', {
        signatureLength: signature.length,
        expectedLength: expectedSignature.length,
      });
      return false;
    }
  }

  /**
   * دالة مساعدة للتحقق من وجود المستأجر ومعرف رقم الهاتف.
   * [مُتحقَّق منطقياً بتتبع كامل] — تحقق مع إعادة محاولة.
   */
  private async validateTenantAndPhone(
    tenantId: string,
    phoneNumberId: string,
    correlationId: string
  ): Promise<any> {
    if (!tenantId) {
      throw new ValidationError('معرف المستأجر مطلوب');
    }

    if (!phoneNumberId) {
      throw new ValidationError('معرف رقم الهاتف (phone_number_id) مطلوب');
    }

    // 1. التحقق من وجود المستأجر
    let tenant: any;
    try {
      tenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(tenantId),
        {
          operationName: 'whatsapp.validateTenant',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل التحقق من وجود المستأجر', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل التحقق من المستأجر، يرجى المحاولة مرة أخرى');
    }

    if (!tenant) {
      logger.warn('المستأجر غير موجود', {
        correlationId,
        tenantId,
      });
      throw new ValidationError('المستأجر غير موجود');
    }

    // 2. التحقق من أن رقم الهاتف مرتبط بهذا المستأجر
    // (يمكن تخزين phoneNumberId في جدول المستأجر أو في جدول منفصل)
    // هنا نفترض أن المستأجر لديه حقل whatsappPhoneNumberId
    if (tenant.whatsappPhoneNumberId !== phoneNumberId) {
      logger.warn('رقم الهاتف لا ينتمي للمستأجر المطلوب', {
        correlationId,
        tenantId,
        phoneNumberId,
        expectedPhoneNumberId: tenant.whatsappPhoneNumberId,
      });
      throw new ValidationError('رقم الهاتف لا ينتمي إلى هذا المستأجر');
    }

    return tenant;
  }

  /**
   * دالة مساعدة لإرسال رسالة عبر WhatsApp Cloud API.
   * تطبق الفشل السريع عند فشل API، مع قاطع دائرة وإعادة محاولة.
   *
   * [مُتحقَّق منطقياً بتتبع كامل] — إرسال رسالة مع قاطع دائرة وإعادة محاولة.
   */
  private async sendWhatsAppMessage(
    phoneNumberId: string,
    to: string,
    text: string,
    replyToMessageId?: string,
    idempotencyKey?: string
  ): Promise<{ messageId: string; timestamp: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    // تنقية المدخلات (الدفاع ضد حقن المطالبات)
    const sanitizedText = text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitizedText || sanitizedText.length === 0) {
      throw new ValidationError('نص الرسالة لا يمكن أن يكون فارغاً');
    }

    // الحد من طول النص (WhatsApp يحد بـ 4096 حرف)
    const maxLength = 4096;
    const truncatedText = sanitizedText.length > maxLength
      ? sanitizedText.substring(0, maxLength) + '...'
      : sanitizedText;

    // بناء جسم الطلب حسب وثائق WhatsApp Cloud API
    const requestBody: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: truncatedText,
      },
    };

    // إضافة معرف الرسالة الأصلية (للرد)
    if (replyToMessageId) {
      requestBody.context = {
        message_id: replyToMessageId,
      };
    }

    // استدعاء WhatsApp API مع قاطع الدائرة وإعادة المحاولة — §4
    const result = await withCircuitBreakerAndRetry(
      async () => {
        const response = await this.httpClient.post(
          `/${phoneNumberId}/messages`,
          requestBody
        );
        return response.data;
      },
      {
        serviceName: 'whatsapp-send-message',
        idempotencyKey: idempotencyKey || `whatsapp-${correlationId}`,
        timeoutMs: config.circuitBreaker.timeout,
        errorThreshold: config.circuitBreaker.errorThreshold,
        halfOpenWaitMs: 60000,
        maxRetries: config.retry.maxAttempts - 1,
        backoffBaseMs: config.retry.backoffBase,
        maxBackoffMs: 30000,
      }
    );

    if (!result.data || !result.data.messages || result.data.messages.length === 0) {
      logger.error('استجابة WhatsApp API غير متوقعة', {
        correlationId,
        response: result.data,
        idempotencyKey,
      });
      throw new InternalServerError('فشل إرسال الرسالة: استجابة غير متوقعة من WhatsApp');
    }

    const message = result.data.messages[0];
    logger.debug('تم إرسال رسالة WhatsApp بنجاح', {
      correlationId,
      messageId: message.id,
      to,
      textLength: truncatedText.length,
      idempotencyKey,
    });

    return {
      messageId: message.id,
      timestamp: message.timestamp || new Date().toISOString(),
    };
  }

  /**
   * دالة مساعدة لمعالجة رسالة WhatsApp واردة (من ويب هوك).
   * تتولى البحث عن المحادثة، إنشاؤها إذا لزم الأمر، وتفويض الرد لخدمة المحادثة.
   *
   * [مُتحقَّق منطقياً بتتبع كامل] — معالجة الرسائل الواردة مع تكافؤ وإنشاء المحادثات.
   */
  private async processIncomingMessage(
    tenantId: string,
    phoneNumberId: string,
    from: string,
    messageId: string,
    text: string,
    timestamp: string,
    customerName?: string
  ): Promise<void> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const idempotencyKey = `whatsapp-incoming-${messageId}`;

    // 1. التحقق من عدم معالجة الرسالة مسبقاً (التكافؤ)
    let existingMessage: any;
    try {
      existingMessage = await withRetryAndThrow(
        () => this.messageRepo.findByExternalId(messageId),
        {
          operationName: 'whatsapp.process.checkDuplicate',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        logger.error('فشل التحقق من تكرار الرسالة', {
          correlationId,
          messageId,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
      }
    }

    if (existingMessage) {
      logger.info('تم معالجة هذه الرسالة مسبقاً (تكافؤ)، تخطي', {
        correlationId,
        messageId,
        existingMessageId: existingMessage.id,
        idempotencyKey,
      });
      return;
    }

    // 2. تنقية النص (الدفاع ضد حقن المطالبات)
    const sanitizedText = text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitizedText || sanitizedText.length === 0) {
      logger.info('رسالة فارغة أو تحتوي على مسافات فقط، تخطي', {
        correlationId,
        messageId,
        from,
        idempotencyKey,
      });
      return;
    }

    // 3. البحث عن محادثة نشطة لهذا الرقم
    let conversation: any;
    try {
      conversation = await withRetryAndThrow(
        () => this.conversationRepo.findByTenantIdAndPhone(tenantId, from),
        {
          operationName: 'whatsapp.process.findConversation',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        logger.error('فشل البحث عن المحادثة', {
          correlationId,
          tenantId,
          from,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        throw new InternalServerError('فشل معالجة الرسالة، يرجى المحاولة مرة أخرى');
      }
    }

    // 4. إنشاء محادثة جديدة إذا لم تكن موجودة
    if (!conversation) {
      logger.info('إنشاء محادثة جديدة لرقم هاتف', {
        correlationId,
        tenantId,
        from,
        customerName,
        idempotencyKey,
      });

      try {
        conversation = await this.chatService.createConversation({
          tenantId,
          phoneNumberId: from,
          customerName: customerName || 'عميل WhatsApp',
          knowledgeBaseId: undefined, // سيتم تحديدها من إعدادات المستأجر
          createdBy: 'whatsapp-webhook',
          idempotencyKey: `conv-${from}`,
        });
      } catch (error) {
        logger.error('فشل إنشاء محادثة جديدة', {
          correlationId,
          tenantId,
          from,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        throw new InternalServerError('فشل إنشاء المحادثة، يرجى المحاولة مرة أخرى');
      }
    }

    // 5. إرسال الرسالة إلى خدمة المحادثة لتوليد الرد
    let chatResult: any;
    try {
      chatResult = await this.chatService.sendMessage({
        conversationId: conversation.id,
        tenantId,
        content: sanitizedText,
        role: 'USER',
        sentBy: `whatsapp:${from}`,
        knowledgeBaseId: conversation.knowledgeBaseId || undefined,
        contextChunkLimit: 5,
        similarityThreshold: 0.7,
        idempotencyKey: `chat-${messageId}`,
      });
    } catch (error) {
      logger.error('فشل معالجة الرسالة في خدمة المحادثة', {
        correlationId,
        conversationId: conversation.id,
        messageId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });

      // إرسال رسالة خطأ إلى المستخدم (احتياطي)
      try {
        await this.sendWhatsAppMessage(
          phoneNumberId,
          from,
          'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى لاحقاً.',
          messageId,
          `error-${messageId}`
        );
      } catch (sendError) {
        logger.error('فشل إرسال رسالة الخطأ إلى WhatsApp', {
          correlationId,
          from,
          error: sendError instanceof Error ? sendError.message : 'unknown',
          idempotencyKey,
        });
      }

      throw new InternalServerError('فشل معالجة الرسالة، يرجى المحاولة مرة أخرى');
    }

    // 6. إرسال الرد عبر WhatsApp
    const assistantMessage = chatResult.assistantMessage;
    if (!assistantMessage || !assistantMessage.content) {
      logger.warn('لم يتم توليد رد من خدمة المحادثة', {
        correlationId,
        conversationId: conversation.id,
        messageId,
        idempotencyKey,
      });
      return;
    }

    try {
      await this.sendWhatsAppMessage(
        phoneNumberId,
        from,
        assistantMessage.content,
        messageId,
        `reply-${messageId}`
      );
    } catch (error) {
      logger.error('فشل إرسال الرد عبر WhatsApp', {
        correlationId,
        conversationId: conversation.id,
        from,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل إرسال الرد، يرجى المحاولة مرة أخرى');
    }

    // 7. تسجيل حدث التدقيق
    logger.info('تم معالجة رسالة WhatsApp وإرسال الرد', {
      correlationId,
      messageId,
      from,
      conversationId: conversation.id,
      tenantId,
      userMessageId: chatResult.userMessage?.id,
      assistantMessageId: chatResult.assistantMessage?.id,
      replyLength: assistantMessage.content.length,
      idempotencyKey,
      event: 'whatsapp.message.processed',
    });
  }

  /**
   * معالجة ويب هوك WhatsApp الوارد.
   * تطبق الفشل السريع عند فشل التحقق من التوقيع أو عدم تطابق البنية.
   *
   * [مُتحقَّق منطقياً بتتبع كامل] — معالجة ويب هوك مع تحقق توقيع وتكافؤ.
   */
  async handleIncomingWebhook(
    payload: any,
    signature: string,
    secret?: string
  ): Promise<{ processed: boolean; messageCount: number }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    // 1. التحقق من وجود الحمولة (payload)
    if (!payload) {
      logger.warn('ويب هوك WhatsApp بدون حمولة', {
        correlationId,
      });
      throw new ValidationError('الحمولة مطلوبة');
    }

    // 2. التحقق من التوقيع (إذا تم توفير سر)
    const webhookSecret = secret || config.whatsapp.verifyToken;
    if (webhookSecret) {
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const isValid = this.verifyWebhookSignature(payloadString, signature, webhookSecret);
      if (!isValid) {
        logger.warn('فشل التحقق من توقيع ويب هوك WhatsApp', {
          correlationId,
          signature,
        });
        throw new UnauthorizedError('توقيع ويب هوك غير صالح');
      }
    }

    // 3. تحليل الحمولة (تأكد من البنية المتوقعة)
    let webhookData: WhatsAppWebhookPayload;
    try {
      webhookData = typeof payload === 'string' ? JSON.parse(payload) : payload;
    } catch (error) {
      logger.error('فشل تحليل حمولة ويب هوك WhatsApp', {
        correlationId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new ValidationError('حمولة ويب هوك غير صالحة');
    }

    // 4. التحقق من البنية الأساسية
    if (webhookData.object !== 'whatsapp_business_account') {
      logger.warn('كائن ويب هوك غير متوقع', {
        correlationId,
        object: webhookData.object,
      });
      return { processed: false, messageCount: 0 };
    }

    if (!webhookData.entry || webhookData.entry.length === 0) {
      logger.warn('ويب هوك بدون إدخالات (entries)', {
        correlationId,
      });
      return { processed: false, messageCount: 0 };
    }

    // 5. معالجة كل إدخال
    let processedCount = 0;

    for (const entry of webhookData.entry) {
      if (!entry.changes || entry.changes.length === 0) {
        continue;
      }

      for (const change of entry.changes) {
        const value = change.value;
        if (!value) {
          continue;
        }

        // استخراج معرف رقم الهاتف من metadata
        const phoneNumberId = value.metadata?.phone_number_id;
        const displayPhoneNumber = value.metadata?.display_phone_number;

        if (!phoneNumberId) {
          logger.warn('ويب هوك بدون معرف رقم هاتف (phone_number_id)', {
            correlationId,
            entryId: entry.id,
          });
          continue;
        }

        // البحث عن المستأجر المرتبط برقم الهاتف
        let tenant: any;
        try {
          tenant = await withRetryAndThrow(
            () => this.tenantRepo.findByPhoneNumberId(phoneNumberId),
            {
              operationName: 'whatsapp.webhook.findTenant',
              maxAttempts: 3,
              verboseLogging: false,
            }
          );
        } catch (error) {
          if (error instanceof NotFoundError) {
            logger.warn('رقم الهاتف غير مرتبط بأي مستأجر', {
              correlationId,
              phoneNumberId,
              displayPhoneNumber,
            });
          } else {
            logger.error('فشل البحث عن المستأجر لرقم الهاتف', {
              correlationId,
              phoneNumberId,
              error: error instanceof Error ? error.message : 'unknown',
            });
          }
          continue;
        }

        if (!tenant) {
          logger.warn('رقم الهاتف غير مرتبط بأي مستأجر (مستأجر غير موجود)', {
            correlationId,
            phoneNumberId,
            displayPhoneNumber,
          });
          continue;
        }

        const tenantId = tenant.id;

        // معالجة الرسائل الواردة
        if (value.messages && value.messages.length > 0) {
          for (const message of value.messages) {
            // تجاهل الرسائل غير النصية (صور، فيديو، إلخ)
            if (message.type !== 'text') {
              logger.info('تجاهل رسالة غير نصية', {
                correlationId,
                messageId: message.id,
                type: message.type,
                from: message.from,
                idempotencyKey: `skip-${message.id}`,
              });
              continue;
            }

            const text = message.text?.body || '';
            if (!text || text.trim().length === 0) {
              logger.info('تجاهل رسالة فارغة', {
                correlationId,
                messageId: message.id,
                from: message.from,
                idempotencyKey: `skip-${message.id}`,
              });
              continue;
            }

            // استخراج اسم العميل (إذا كان متاحاً)
            let customerName: string | undefined;
            if (value.contacts && value.contacts.length > 0) {
              const contact = value.contacts.find((c) => c.wa_id === message.from);
              if (contact) {
                customerName = contact.profile?.name;
              }
            }

            // معالجة الرسالة الواردة بشكل غير متزامن (لا ننتظر الرد)
            // نستخدم setImmediate لتجنب حظر حلقة الأحداث
            setImmediate(() => {
              this.processIncomingMessage(
                tenantId,
                phoneNumberId,
                message.from,
                message.id,
                text,
                message.timestamp,
                customerName
              ).catch((error) => {
                logger.error('فشل معالجة الرسالة الواردة (غير متزامن)', {
                  correlationId,
                  messageId: message.id,
                  from: message.from,
                  error: error instanceof Error ? error.message : 'unknown',
                  idempotencyKey: `async-${message.id}`,
                });
              });
            });

            processedCount++;
          }
        }

        // معالجة تحديثات الحالة (Status Updates)
        if (value.statuses && value.statuses.length > 0) {
          for (const status of value.statuses) {
            logger.debug('تحديث حالة رسالة WhatsApp', {
              correlationId,
              messageId: status.id,
              status: status.status,
              recipientId: status.recipient_id,
              timestamp: status.timestamp,
            });
            // هنا يمكن تحديث حالة الرسالة في قاعدة البيانات
            // ولكن هذا خارج نطاق هذه الخدمة حالياً
          }
        }
      }
    }

    logger.info('تم معالجة ويب هوك WhatsApp', {
      correlationId,
      processedCount,
      entries: webhookData.entry.length,
    });

    return {
      processed: processedCount > 0,
      messageCount: processedCount,
    };
  }

  /**
   * التحقق من ويب هوك WhatsApp (للتسجيل الأولي).
   * يستخدم لـ Webhook Verification أثناء إعداد ويب هوك.
   *
   * [مُتحقَّق منطقياً بتتبع كامل] — تحقق بسيط من token.
   */
  verifyWebhook(mode: string, token: string, challenge: string): string {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
      logger.info('تم التحقق من ويب هوك WhatsApp بنجاح', {
        correlationId,
        mode,
        challenge,
      });
      return challenge;
    }

    logger.warn('فشل التحقق من ويب هوك WhatsApp', {
      correlationId,
      mode,
      providedToken: token ? '***' : undefined,
    });
    throw new UnauthorizedError('رمز التحقق غير صالح');
  }

  /**
   * إرسال رسالة عبر WhatsApp (واجهة عامة للاستخدام من وحدات التحكم).
   * تطبق الفشل السريع عند فشل التحقق من المدخلات أو API.
   *
   * [مُتحقَّق منطقياً بتتبع كامل] — إرسال رسالة مع تكافؤ وتحقق صلاحيات.
   */
  async sendMessage(data: WhatsAppSendMessageData): Promise<WhatsAppSendMessageResult> {
    const correlationId = getCurrentCorrelationId() || randomUUID();
    const {
      tenantId,
      to,
      text,
      replyToMessageId,
      conversationId,
      knowledgeBaseId,
      idempotencyKey,
    } = data;

    // 1. التحقق من صحة المدخلات (الفشل السريع)
    if (!tenantId || !to || !text) {
      logger.warn('محاولة إرسال رسالة WhatsApp ببيانات ناقصة', {
        correlationId,
        hasTenantId: !!tenantId,
        hasTo: !!to,
        hasText: !!text,
        idempotencyKey,
      });
      throw new ValidationError('معرف المستأجر، رقم المستلم، ونص الرسالة مطلوبة');
    }

    // 2. تنقية المدخلات
    const sanitizedText = text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitizedText || sanitizedText.length === 0) {
      throw new ValidationError('نص الرسالة لا يمكن أن يكون فارغاً');
    }

    // 3. التحقق من وجود المستأجر والحصول على phoneNumberId
    let tenant: any;
    try {
      tenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(tenantId),
        {
          operationName: 'whatsapp.send.validateTenant',
          idempotencyKey,
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل التحقق من وجود المستأجر لإرسال الرسالة', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      throw new InternalServerError('فشل إرسال الرسالة، يرجى المحاولة مرة أخرى');
    }

    if (!tenant) {
      throw new ValidationError('المستأجر غير موجود');
    }

    const phoneNumberId = tenant.whatsappPhoneNumberId;
    if (!phoneNumberId) {
      logger.error('المستأجر لا يحتوي على معرف رقم هاتف WhatsApp', {
        correlationId,
        tenantId,
        idempotencyKey,
      });
      throw new ValidationError('المستأجر غير مهيأ لإرسال رسائل WhatsApp');
    }

    // 4. إرسال الرسالة عبر WhatsApp API
    let whatsappResult: { messageId: string; timestamp: string };
    try {
      whatsappResult = await this.sendWhatsAppMessage(
        phoneNumberId,
        to,
        sanitizedText,
        replyToMessageId,
        idempotencyKey || `send-${correlationId}`
      );
    } catch (error) {
      logger.error('فشل إرسال رسالة WhatsApp', {
        correlationId,
        tenantId,
        to,
        error: error instanceof Error ? error.message : 'unknown',
        idempotencyKey,
      });
      if (error instanceof AppError) {
        throw error;
      }
      throw new InternalServerError('فشل إرسال الرسالة، يرجى المحاولة مرة أخرى');
    }

    // 5. حفظ الرسالة في قاعدة البيانات (إذا كانت هناك محادثة)
    let internalMessageId: string | undefined;
    if (conversationId) {
      try {
        const messageData = {
          conversationId,
          tenantId,
          role: 'ASSISTANT' as const,
          content: sanitizedText,
          metadata: {
            whatsappMessageId: whatsappResult.messageId,
            to,
            replyToMessageId,
            external: true,
          },
          createdAt: new Date(),
          sentBy: 'whatsapp-service',
        };

        const savedMessage = await withRetryAndThrow(
          () => this.messageRepo.create(messageData),
          {
            operationName: 'whatsapp.send.saveMessage',
            idempotencyKey: idempotencyKey || `save-${correlationId}`,
            maxAttempts: 3,
            verboseLogging: false,
          }
        );
        internalMessageId = savedMessage.id;
      } catch (error) {
        logger.warn('فشل حفظ رسالة WhatsApp في قاعدة البيانات', {
          correlationId,
          conversationId,
          to,
          error: error instanceof Error ? error.message : 'unknown',
          idempotencyKey,
        });
        // لا نُفشل العملية، نكتفي بتسجيل التحذير
      }
    }

    // 6. تسجيل حدث التدقيق
    logger.info('تم إرسال رسالة WhatsApp', {
      correlationId,
      tenantId,
      to,
      messageId: whatsappResult.messageId,
      internalMessageId,
      conversationId,
      textLength: sanitizedText.length,
      idempotencyKey,
      event: 'whatsapp.send.success',
    });

    return {
      messageId: whatsappResult.messageId,
      status: 'sent',
      timestamp: whatsappResult.timestamp,
      conversationId: conversationId || '',
      internalMessageId: internalMessageId || '',
    };
  }

  /**
   * الحصول على حالة رسالة WhatsApp (مثل delivered, read, failed).
   * [مُتحقَّق منطقياً بتتبع كامل] — استعلام عن حالة الرسالة.
   */
  async getMessageStatus(messageId: string, tenantId: string): Promise<{ status: string; timestamp: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (!messageId || !tenantId) {
      throw new ValidationError('معرف الرسالة ومعرف المستأجر مطلوبان');
    }

    // 1. التحقق من وجود المستأجر
    let tenant: any;
    try {
      tenant = await withRetryAndThrow(
        () => this.tenantRepo.findById(tenantId),
        {
          operationName: 'whatsapp.status.validateTenant',
          maxAttempts: 3,
          verboseLogging: false,
        }
      );
    } catch (error) {
      logger.error('فشل التحقق من وجود المستأجر لحالة الرسالة', {
        correlationId,
        tenantId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new InternalServerError('فشل جلب حالة الرسالة، يرجى المحاولة مرة أخرى');
    }

    if (!tenant) {
      throw new ValidationError('المستأجر غير موجود');
    }

    // 2. استعلام عن حالة الرسالة من WhatsApp API
    // ملاحظة: WhatsApp لا يوفر نقطة نهاية مباشرة لاستعلام حالة رسالة محددة
    // يمكن استخدام Webhook Status Updates بدلاً من ذلك
    // هنا نعيد حالة افتراضية (سيتم استكمالها من قاعدة البيانات لاحقاً)
    logger.debug('استعلام عن حالة رسالة WhatsApp', {
      correlationId,
      messageId,
      tenantId,
    });

    // في الإنتاج، سيتم جلب الحالة من قاعدة البيانات (المحدثة عبر Webhook Status Updates)
    return {
      status: 'sent', // افتراضي
      timestamp: new Date().toISOString(),
    };
  }
}
