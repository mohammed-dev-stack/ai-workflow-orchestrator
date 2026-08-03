// ============================================================
// backend/src/orchestrators/chatFlow.orchestrator.ts
// ============================================================
// منسق تدفق المحادثة (Chat Flow Orchestrator) باستخدام XState v5.
// تم إضافة idempotencyKey إلى نوع الحدث START لحل مشكلة عدم وجود الخاصية.
// ============================================================

import { randomUUID } from 'crypto';
import { setup, assign, createActor, fromPromise } from 'xstate';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import {
  ValidationError,
  NotFoundError,
  InternalServerError,
  AppError,
} from '../middlewares/errorHandler.middleware.js';
import { withRetryAndThrow } from '../utils/retry.js';

// ============================================================
// أنواع السياق والأحداث
// ============================================================

export type ChatFlowState =
  | 'idle'
  | 'validating'
  | 'fetchingContext'
  | 'generatingReply'
  | 'sendingReply'
  | 'completed'
  | 'failed'
  | 'compensating'
  | 'compensated';

// ✅ تم إضافة idempotencyKey إلى نوع START
export type ChatFlowEvent =
  | { type: 'START'; conversationId: string; tenantId: string; message: string; sentBy: string; knowledgeBaseId?: string; contextChunkLimit?: number; similarityThreshold?: number; idempotencyKey?: string }
  | { type: 'VALIDATED'; conversation: any }
  | { type: 'VALIDATION_FAILED'; error: string }
  | { type: 'CONTEXT_FETCHED'; chunks: any[] }
  | { type: 'CONTEXT_FETCH_FAILED'; error: string }
  | { type: 'REPLY_GENERATED'; reply: string; citations?: string[]; suggestedQuestions?: string[]; assistantMessage: any }
  | { type: 'REPLY_GENERATION_FAILED'; error: string }
  | { type: 'REPLY_SENT'; result: any }
  | { type: 'REPLY_SEND_FAILED'; error: string }
  | { type: 'COMPLETE' }
  | { type: 'FAIL'; error: string }
  | { type: 'COMPENSATE'; reason: string }
  | { type: 'COMPENSATED' }
  | { type: 'RESUME'; state: ChatFlowState; context: Partial<ChatFlowContext> }
  | { type: 'RETRY' };

export interface ChatFlowContext {
  conversationId: string;
  tenantId: string;
  message: string;
  sentBy: string;
  knowledgeBaseId?: string;
  contextChunkLimit?: number;
  similarityThreshold?: number;
  conversation?: any;
  contextChunks?: any[];
  reply?: string;
  citations?: string[];
  suggestedQuestions?: string[];
  assistantMessage?: any;
  sendResult?: any;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  idempotencyKey?: string;
  retryCount?: number;
  restoredState?: ChatFlowState;
  restoredContext?: Partial<ChatFlowContext>;
}

// ============================================================
// واجهات الخدمات
// ============================================================

export interface IChatServiceForFlow {
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
}

export interface IWhatsAppServiceForFlow {
  sendMessage(data: {
    tenantId: string;
    to: string;
    text: string;
    replyToMessageId?: string;
    conversationId?: string;
    knowledgeBaseId?: string;
    idempotencyKey?: string;
  }): Promise<{
    messageId: string;
    status: 'sent' | 'failed';
    timestamp: string;
    conversationId: string;
    internalMessageId: string;
  }>;
}

export interface IConversationRepositoryForFlow {
  findById(id: string): Promise<any>;
  update(id: string, data: any): Promise<any>;
}

type AuditEvent = {
  eventType: string;
  conversationId: string;
  tenantId: string;
  userId: string;
  state: ChatFlowState;
  payload: Record<string, any>;
  timestamp: Date;
};

export interface IAuditService {
  log(event: AuditEvent): Promise<void>;
}

export interface ChatFlowOrchestratorOptions {
  maxRetries?: number;
  enableCompensation?: boolean;
}

const DEFAULT_OPTIONS: Required<ChatFlowOrchestratorOptions> = {
  maxRetries: 3,
  enableCompensation: true,
};

// ============================================================
// المنسق
// ============================================================

export class ChatFlowOrchestrator {
  private chatService: IChatServiceForFlow;
  private whatsappService: IWhatsAppServiceForFlow;
  private conversationRepo: IConversationRepositoryForFlow;
  private auditService?: IAuditService;
  private options: Required<ChatFlowOrchestratorOptions>;
  private actors: Map<string, ReturnType<typeof createActor>> = new Map();

  constructor(
    chatService: IChatServiceForFlow,
    whatsappService: IWhatsAppServiceForFlow,
    conversationRepo: IConversationRepositoryForFlow,
    auditService?: IAuditService,
    options: ChatFlowOrchestratorOptions = {}
  ) {
    this.chatService = chatService;
    this.whatsappService = whatsappService;
    this.conversationRepo = conversationRepo;
    this.auditService = auditService;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * بناء آلة الحالة باستخدام XState v5 (setup + createMachine).
   */
  private buildMachine() {
    const self = this;

    // دوال مساعدة للـ actors (مهام غير متزامنة)
    const validateInputsActor = fromPromise(
      async ({ input }: { input: { context: ChatFlowContext } }) => {
        const ctx = input.context;
        const correlationId = getCurrentCorrelationId() || randomUUID();
        const { conversationId, tenantId, message, sentBy } = ctx;

        if (!conversationId || !tenantId || !message || !sentBy) {
          throw new ValidationError('بيانات غير مكتملة: conversationId, tenantId, message, sentBy مطلوبة');
        }
        if (message.trim().length === 0) {
          throw new ValidationError('الرسالة لا يمكن أن تكون فارغة');
        }
        if (message.trim().length < 2) {
          throw new ValidationError('الرسالة قصيرة جداً (يجب أن تكون حرفين على الأقل)');
        }

        const conversation = await withRetryAndThrow(
          () => self.conversationRepo.findById(conversationId),
          {
            operationName: 'orchestrator.chat.validate.conversation',
            maxAttempts: 3,
            verboseLogging: false,
          }
        );

        if (!conversation) {
          throw new NotFoundError(`المحادثة ${conversationId} غير موجودة`);
        }
        if (conversation.tenantId !== tenantId) {
          throw new ValidationError('المحادثة لا تنتمي إلى هذا المستأجر');
        }
        if (conversation.status !== 'ACTIVE') {
          throw new ValidationError(`المحادثة في حالة ${conversation.status} ولا يمكن معالجتها`);
        }
        if (conversation.deletedAt) {
          throw new ValidationError('المحادثة محذوفة ولا يمكن معالجتها');
        }

        logger.debug('تم التحقق من المدخلات بنجاح', {
          correlationId,
          conversationId,
          tenantId,
          messageLength: message.length,
        });

        return { conversation };
      }
    );

    const fetchContextActor = fromPromise(
      async ({ input }: { input: { context: ChatFlowContext } }) => {
        const ctx = input.context;
        const correlationId = getCurrentCorrelationId() || randomUUID();
        const { conversationId, tenantId, message, knowledgeBaseId, contextChunkLimit, similarityThreshold } = ctx;

        const kbId = knowledgeBaseId || ctx.conversation?.knowledgeBaseId;
        if (!kbId) {
          logger.debug('لا توجد قاعدة معرفة، تخطي جلب السياق', { correlationId, conversationId });
          return { chunks: [] };
        }

        try {
          // استدعاء chatService.sendMessage للحصول على السياق (محاكاة)
          const result = await withRetryAndThrow(
            () => self.chatService.sendMessage({
              conversationId,
              tenantId,
              content: message,
              role: 'USER',
              sentBy: ctx.sentBy,
              knowledgeBaseId: kbId,
              contextChunkLimit: contextChunkLimit || 5,
              similarityThreshold: similarityThreshold || 0.7,
              idempotencyKey: ctx.idempotencyKey || `ctx-${conversationId}`,
            }),
            {
              operationName: 'orchestrator.chat.fetchContext',
              maxAttempts: 2,
              verboseLogging: false,
            }
          );
          return { chunks: result.contextChunks || [] };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'فشل جلب السياق';
          logger.warn('فشل جلب السياق، المتابعة بدون سياق', {
            correlationId,
            conversationId,
            error: errorMessage,
          });
          return { chunks: [] };
        }
      }
    );

    const generateReplyActor = fromPromise(
      async ({ input }: { input: { context: ChatFlowContext } }) => {
        const ctx = input.context;
        const correlationId = getCurrentCorrelationId() || randomUUID();
        const { conversationId, tenantId, message, sentBy, knowledgeBaseId, contextChunkLimit, similarityThreshold } = ctx;

        const result = await withRetryAndThrow(
          () => self.chatService.sendMessage({
            conversationId,
            tenantId,
            content: message,
            role: 'USER',
            sentBy: sentBy,
            knowledgeBaseId: knowledgeBaseId || ctx.conversation?.knowledgeBaseId,
            contextChunkLimit: contextChunkLimit || 5,
            similarityThreshold: similarityThreshold || 0.7,
            idempotencyKey: ctx.idempotencyKey || `reply-${conversationId}`,
          }),
          {
            operationName: 'orchestrator.chat.generateReply',
            maxAttempts: 2,
            verboseLogging: false,
          }
        );

        const assistantMessage = result.assistantMessage;
        const reply = assistantMessage?.content || 'عذراً، لم أتمكن من توليد رد. يرجى المحاولة مرة أخرى.';

        logger.debug('تم توليد الرد بنجاح', {
          correlationId,
          conversationId,
          replyLength: reply.length,
          hasCitations: !!(assistantMessage?.metadata?.citations),
        });

        return {
          reply,
          assistantMessage,
          contextChunks: result.contextChunks || ctx.contextChunks || [],
        };
      }
    );

    const sendReplyActor = fromPromise(
      async ({ input }: { input: { context: ChatFlowContext } }) => {
        const ctx = input.context;
        const correlationId = getCurrentCorrelationId() || randomUUID();
        const { conversationId, tenantId, reply, conversation } = ctx;

        if (!reply || reply.trim().length === 0) {
          throw new ValidationError('لا يوجد رد لإرساله');
        }

        const phoneNumber = conversation?.phoneNumberId;
        if (!phoneNumber) {
          throw new ValidationError('رقم الهاتف غير متوفر في المحادثة');
        }

        const result = await withRetryAndThrow(
          () => self.whatsappService.sendMessage({
            tenantId,
            to: phoneNumber,
            text: reply,
            replyToMessageId: undefined,
            conversationId: conversationId,
            knowledgeBaseId: ctx.knowledgeBaseId || conversation?.knowledgeBaseId,
            idempotencyKey: ctx.idempotencyKey || `send-${conversationId}`,
          }),
          {
            operationName: 'orchestrator.chat.sendReply',
            maxAttempts: 3,
            verboseLogging: false,
          }
        );

        logger.debug('تم إرسال الرد بنجاح', {
          correlationId,
          conversationId,
          messageId: result.messageId,
          to: phoneNumber,
        });

        return result;
      }
    );

    // بناء آلة الحالة باستخدام setup
    const machine = setup({
      types: {
        context: {} as ChatFlowContext,
        events: {} as ChatFlowEvent,
      },
      actors: {
        validateInputs: validateInputsActor,
        fetchContext: fetchContextActor,
        generateReply: generateReplyActor,
        sendReply: sendReplyActor,
      },
      actions: {
        // إجراءات بدء التشغيل
        assignStartData: assign(({ event, context }) => {
          const e = event as Extract<ChatFlowEvent, { type: 'START' }>;
          return {
            conversationId: e.conversationId,
            tenantId: e.tenantId,
            message: e.message,
            sentBy: e.sentBy,
            knowledgeBaseId: e.knowledgeBaseId || context.knowledgeBaseId,
            contextChunkLimit: e.contextChunkLimit || context.contextChunkLimit || 5,
            similarityThreshold: e.similarityThreshold || context.similarityThreshold || 0.7,
            idempotencyKey: e.idempotencyKey || randomUUID(),
            startedAt: new Date(),
            retryCount: context.retryCount || 0,
          };
        }),

        restoreContext: assign(({ event, context }) => {
          const e = event as Extract<ChatFlowEvent, { type: 'RESUME' }>;
          return {
            ...context,
            ...e.context,
            restoredState: e.state,
            startedAt: e.context.startedAt || new Date(),
          };
        }),

        setConversation: assign(({ event }) => {
          const e = event as Extract<ChatFlowEvent, { type: 'VALIDATED' }>;
          return { conversation: e.conversation };
        }),

        setContextChunks: assign(({ event }) => {
          const e = event as Extract<ChatFlowEvent, { type: 'CONTEXT_FETCHED' }>;
          return { contextChunks: e.chunks };
        }),

        setReply: assign(({ event }) => {
          const e = event as Extract<ChatFlowEvent, { type: 'REPLY_GENERATED' }>;
          return { reply: e.reply };
        }),

        setAssistantMessage: assign(({ event }) => {
          const e = event as Extract<ChatFlowEvent, { type: 'REPLY_GENERATED' }>;
          return { assistantMessage: e.assistantMessage };
        }),

        setSendResult: assign(({ event }) => {
          const e = event as Extract<ChatFlowEvent, { type: 'REPLY_SENT' }>;
          return { sendResult: e.result };
        }),

        setError: assign(({ event }) => {
          const e = event as Extract<ChatFlowEvent, { type: 'VALIDATION_FAILED' | 'CONTEXT_FETCH_FAILED' | 'REPLY_GENERATION_FAILED' | 'REPLY_SEND_FAILED' | 'FAIL' }>;
          return { error: e.error };
        }),

        incrementRetry: assign(({ context }) => ({
          retryCount: (context.retryCount || 0) + 1,
        })),

        clearError: assign(() => ({ error: undefined })),

        setCompensationReason: assign(({ event }) => {
          const e = event as Extract<ChatFlowEvent, { type: 'COMPENSATE' }>;
          return { error: e.reason };
        }),

        markComplete: assign(() => ({ completedAt: new Date() })),

        logStart: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('بدء تدفق المحادثة', {
            correlationId,
            conversationId: context.conversationId,
            tenantId: context.tenantId,
            messageLength: context.message.length,
          });
          self.auditService?.log({
            eventType: 'chat.flow.started',
            conversationId: context.conversationId,
            tenantId: context.tenantId,
            userId: context.sentBy,
            state: 'idle',
            payload: { messageLength: context.message.length },
            timestamp: new Date(),
          }).catch((err) => {
            logger.warn('فشل تسجيل حدث التدقيق', {
              correlationId,
              error: err instanceof Error ? err.message : 'unknown',
            });
          });
        },

        logValidating: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('بدء التحقق من المدخلات', {
            correlationId,
            conversationId: context.conversationId,
          });
        },

        logValidated: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تم التحقق من المدخلات', {
            correlationId,
            conversationId: context.conversationId,
          });
        },

        logValidationFailed: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.warn('فشل التحقق من المدخلات', {
            correlationId,
            conversationId: context.conversationId,
            error: context.error,
          });
        },

        logFetchingContext: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('جلب السياق من قاعدة المعرفة', {
            correlationId,
            conversationId: context.conversationId,
            knowledgeBaseId: context.knowledgeBaseId || context.conversation?.knowledgeBaseId,
          });
        },

        logContextFetched: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تم جلب السياق', {
            correlationId,
            conversationId: context.conversationId,
            chunkCount: context.contextChunks?.length || 0,
          });
        },

        logContextFetchFailed: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.warn('فشل جلب السياق، المتابعة بدون سياق', {
            correlationId,
            conversationId: context.conversationId,
            error: context.error,
          });
        },

        logGeneratingReply: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('توليد الرد باستخدام الذكاء الاصطناعي', {
            correlationId,
            conversationId: context.conversationId,
          });
        },

        logReplyGenerated: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تم توليد الرد', {
            correlationId,
            conversationId: context.conversationId,
            replyLength: context.reply?.length || 0,
          });
        },

        logReplyGenerationFailed: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.error('فشل توليد الرد', {
            correlationId,
            conversationId: context.conversationId,
            error: context.error,
          });
        },

        logSendingReply: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('إرسال الرد عبر WhatsApp', {
            correlationId,
            conversationId: context.conversationId,
            replyLength: context.reply?.length || 0,
          });
        },

        logReplySent: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تم إرسال الرد', {
            correlationId,
            conversationId: context.conversationId,
            messageId: context.sendResult?.messageId,
          });
        },

        logReplySendFailed: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.error('فشل إرسال الرد', {
            correlationId,
            conversationId: context.conversationId,
            error: context.error,
          });
        },

        logComplete: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('اكتمل تدفق المحادثة', {
            correlationId,
            conversationId: context.conversationId,
            tenantId: context.tenantId,
            replyLength: context.reply?.length || 0,
            durationMs: context.startedAt ? Date.now() - context.startedAt.getTime() : undefined,
          });
          self.auditService?.log({
            eventType: 'chat.flow.completed',
            conversationId: context.conversationId,
            tenantId: context.tenantId,
            userId: context.sentBy,
            state: 'completed',
            payload: {
              replyLength: context.reply?.length || 0,
              contextChunks: context.contextChunks?.length || 0,
              durationMs: context.startedAt ? Date.now() - context.startedAt.getTime() : undefined,
            },
            timestamp: new Date(),
          }).catch((err) => {
            logger.warn('فشل تسجيل حدث التدقيق', {
              correlationId,
              error: err instanceof Error ? err.message : 'unknown',
            });
          });
        },

        updateConversationCompleted: async ({ context }) => {
          await self.conversationRepo.update(context.conversationId, {
            updatedAt: new Date(),
          });
        },

        logFailure: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.error('فشل تدفق المحادثة', {
            correlationId,
            conversationId: context.conversationId,
            tenantId: context.tenantId,
            error: context.error,
            retryCount: context.retryCount,
            event: 'chat.flow.failed',
          });
          self.auditService?.log({
            eventType: 'chat.flow.failed',
            conversationId: context.conversationId,
            tenantId: context.tenantId,
            userId: context.sentBy,
            state: 'failed',
            payload: {
              error: context.error,
              retryCount: context.retryCount,
            },
            timestamp: new Date(),
          }).catch((err) => {
            logger.warn('فشل تسجيل حدث التدقيق', {
              correlationId,
              error: err instanceof Error ? err.message : 'unknown',
            });
          });
        },

        logRetry: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('إعادة محاولة تدفق المحادثة', {
            correlationId,
            conversationId: context.conversationId,
            retryCount: context.retryCount,
            maxRetries: self.options.maxRetries,
          });
        },

        logCompensationStart: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.warn('بدء المعاملة التعويضية', {
            correlationId,
            conversationId: context.conversationId,
            reason: context.error,
          });
        },

        logCompensationExecuting: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تنفيذ المعاملة التعويضية', {
            correlationId,
            conversationId: context.conversationId,
          });
        },

        logCompensated: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('اكتملت المعاملة التعويضية بنجاح', {
            correlationId,
            conversationId: context.conversationId,
            tenantId: context.tenantId,
          });
          self.auditService?.log({
            eventType: 'chat.flow.compensated',
            conversationId: context.conversationId,
            tenantId: context.tenantId,
            userId: context.sentBy,
            state: 'compensated',
            payload: { reason: context.error },
            timestamp: new Date(),
          }).catch((err) => {
            logger.warn('فشل تسجيل حدث التدقيق', {
              correlationId,
              error: err instanceof Error ? err.message : 'unknown',
            });
          });
        },

        logCompensationFailed: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.error('فشل المعاملة التعويضية', {
            correlationId,
            conversationId: context.conversationId,
            error: context.error,
          });
        },

        logCompensatedFinal: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('تم التعويض النهائي للمحادثة', {
            correlationId,
            conversationId: context.conversationId,
            tenantId: context.tenantId,
          });
        },

        logResume: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('استئناف آلة الحالة', {
            correlationId,
            conversationId: context.conversationId,
            restoredState: context.restoredState,
          });
        },

        cleanup: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          if (self.actors.has(context.conversationId)) {
            self.actors.delete(context.conversationId);
            logger.debug('تم تنظيف آلة الحالة', {
              correlationId,
              conversationId: context.conversationId,
            });
          }
        },
      },
      guards: {
        canRetry: ({ context }) => {
          const retryCount = context.retryCount || 0;
          return retryCount < self.options.maxRetries;
        },
        shouldCompensate: () => self.options.enableCompensation,
      },
    }).createMachine({
      id: 'chatFlow',
      initial: 'idle',
      context: {
        conversationId: '',
        tenantId: '',
        message: '',
        sentBy: '',
        retryCount: 0,
        contextChunkLimit: 5,
        similarityThreshold: 0.7,
      },
      states: {
        idle: {
          on: {
            START: {
              target: 'validating',
              actions: ['assignStartData', 'logStart'],
            },
            RESUME: {
              target: 'validating',
              actions: ['restoreContext', 'logResume'],
            },
          },
        },
        validating: {
          entry: ['logValidating'],
          invoke: {
            src: 'validateInputs',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'fetchingContext',
              actions: [
                assign(({ event }) => ({
                  conversation: event.output.conversation,
                })),
                'logValidated',
              ],
            },
            onError: {
              target: 'failed',
              actions: [
                assign(({ event }) => ({
                  error: event.error instanceof Error ? event.error.message : String(event.error),
                })),
                'logValidationFailed',
              ],
            },
          },
        },
        fetchingContext: {
          entry: ['logFetchingContext'],
          invoke: {
            src: 'fetchContext',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'generatingReply',
              actions: [
                assign(({ event }) => ({
                  contextChunks: event.output.chunks,
                })),
                'logContextFetched',
              ],
            },
            onError: {
              target: 'generatingReply', // استمر بدون سياق (احتياطي)
              actions: [
                assign(({ event }) => ({
                  error: event.error instanceof Error ? event.error.message : String(event.error),
                })),
                'logContextFetchFailed',
              ],
            },
          },
        },
        generatingReply: {
          entry: ['logGeneratingReply'],
          invoke: {
            src: 'generateReply',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'sendingReply',
              actions: [
                assign(({ event }) => ({
                  reply: event.output.reply,
                  assistantMessage: event.output.assistantMessage,
                  contextChunks: event.output.contextChunks,
                })),
                'logReplyGenerated',
              ],
            },
            onError: {
              target: 'failed',
              actions: [
                assign(({ event }) => ({
                  error: event.error instanceof Error ? event.error.message : String(event.error),
                })),
                'logReplyGenerationFailed',
              ],
            },
          },
        },
        sendingReply: {
          entry: ['logSendingReply'],
          invoke: {
            src: 'sendReply',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'completed',
              actions: [
                assign(({ event }) => ({
                  sendResult: event.output,
                })),
                'logReplySent',
              ],
            },
            onError: {
              target: 'failed',
              actions: [
                assign(({ event }) => ({
                  error: event.error instanceof Error ? event.error.message : String(event.error),
                })),
                'logReplySendFailed',
              ],
            },
          },
        },
        completed: {
          type: 'final' as const,
          entry: ['markComplete', 'logComplete', 'updateConversationCompleted', 'cleanup'],
        },
        failed: {
          entry: ['logFailure'],
          on: {
            RETRY: {
              target: 'validating',
              actions: ['incrementRetry', 'clearError', 'logRetry'],
            },
            COMPENSATE: {
              target: 'compensating',
              actions: ['setCompensationReason', 'logCompensationStart'],
            },
          },
        },
        compensating: {
          entry: ['logCompensationExecuting'],
          invoke: {
            src: fromPromise(async ({ input }: { input: { context: ChatFlowContext } }) => {
              const ctx = input.context;
              const correlationId = getCurrentCorrelationId() || randomUUID();
              const { conversationId, tenantId, assistantMessage } = ctx;

              logger.warn('تنفيذ المعاملة التعويضية: حذف رسالة المساعد', {
                correlationId,
                conversationId,
                tenantId,
              });

              try {
                if (assistantMessage && assistantMessage.id) {
                  // محاكاة الحذف
                  logger.info('تم حذف رسالة المساعد (محاكاة)', {
                    correlationId,
                    conversationId,
                    assistantMessageId: assistantMessage.id,
                  });
                }
                logger.info('اكتملت المعاملة التعويضية', {
                  correlationId,
                  conversationId,
                  tenantId,
                });
                return { success: true };
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'فشل التعويض';
                logger.error('فشل المعاملة التعويضية', {
                  correlationId,
                  conversationId,
                  tenantId,
                  error: errorMessage,
                });
                throw new Error(`فشل التعويض: ${errorMessage}`);
              }
            }),
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'compensated',
              actions: ['logCompensated'],
            },
            onError: {
              target: 'failed',
              actions: [
                assign(({ event }) => ({
                  error: event.error instanceof Error ? event.error.message : String(event.error),
                })),
                'logCompensationFailed',
              ],
            },
          },
        },
        compensated: {
          type: 'final' as const,
          entry: ['logCompensatedFinal', 'cleanup'],
        },
      },
    });

    return machine;
  }

  /**
   * بدء تدفق محادثة جديد.
   */
  async startFlow(
    conversationId: string,
    tenantId: string,
    message: string,
    sentBy: string,
    knowledgeBaseId?: string,
    contextChunkLimit?: number,
    similarityThreshold?: number,
    idempotencyKey?: string
  ): Promise<{ success: boolean; state: ChatFlowState; error?: string; reply?: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (this.actors.has(conversationId)) {
      logger.warn('يوجد بالفعل تدفق جاري لهذه المحادثة', { correlationId, conversationId });
      const actor = this.actors.get(conversationId);
      return {
        success: false,
        state: actor?.getSnapshot().value as ChatFlowState || 'idle',
        error: 'تدفق جاري بالفعل',
      };
    }

    try {
      const machine = this.buildMachine();
      const actor = createActor(machine);

      this.actors.set(conversationId, actor);
      actor.start();

      actor.send({
        type: 'START',
        conversationId,
        tenantId,
        message,
        sentBy,
        knowledgeBaseId,
        contextChunkLimit: contextChunkLimit || 5,
        similarityThreshold: similarityThreshold || 0.7,
        idempotencyKey: idempotencyKey || randomUUID(),
      });

      const result = await new Promise<{ success: boolean; state: ChatFlowState; error?: string; reply?: string }>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.matches('completed')) {
            resolve({
              success: true,
              state: 'completed',
              reply: snapshot.context.reply,
            });
            subscription.unsubscribe();
            actor.stop();
          } else if (snapshot.matches('failed')) {
            resolve({
              success: false,
              state: 'failed',
              error: snapshot.context.error || 'فشل غير معروف',
              reply: snapshot.context.reply,
            });
            subscription.unsubscribe();
          } else if (snapshot.matches('compensated')) {
            resolve({
              success: false,
              state: 'compensated',
              error: snapshot.context.error || 'تم التعويض',
              reply: snapshot.context.reply,
            });
            subscription.unsubscribe();
            actor.stop();
          }
        });
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل بدء التدفق';
      logger.error('فشل بدء تدفق المحادثة', {
        correlationId,
        conversationId,
        error: errorMessage,
      });
      return {
        success: false,
        state: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * استئناف تدفق محادثة من حالة سابقة.
   */
  async resumeFlow(
    conversationId: string,
    state: ChatFlowState,
    context: Partial<ChatFlowContext>
  ): Promise<{ success: boolean; state: ChatFlowState; error?: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (this.actors.has(conversationId)) {
      logger.warn('يوجد بالفعل تدفق جاري لهذه المحادثة', { correlationId, conversationId });
      return {
        success: false,
        state: 'idle',
        error: 'تدفق جاري بالفعل',
      };
    }

    try {
      const machine = this.buildMachine();
      const actor = createActor(machine);

      this.actors.set(conversationId, actor);
      actor.start();

      actor.send({
        type: 'RESUME',
        state,
        context,
      });

      const result = await new Promise<{ success: boolean; state: ChatFlowState; error?: string }>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.matches('completed')) {
            resolve({ success: true, state: 'completed' });
            subscription.unsubscribe();
            actor.stop();
          } else if (snapshot.matches('failed')) {
            resolve({
              success: false,
              state: 'failed',
              error: snapshot.context.error || 'فشل غير معروف',
            });
            subscription.unsubscribe();
          } else if (snapshot.matches('compensated')) {
            resolve({
              success: false,
              state: 'compensated',
              error: snapshot.context.error || 'تم التعويض',
            });
            subscription.unsubscribe();
            actor.stop();
          }
        });
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل استئناف التدفق';
      logger.error('فشل استئناف تدفق المحادثة', {
        correlationId,
        conversationId,
        error: errorMessage,
        state,
      });
      return {
        success: false,
        state: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * إعادة محاولة تدفق محادثة فاشل.
   */
  async retryFlow(conversationId: string): Promise<{ success: boolean; state: ChatFlowState; error?: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    const actor = this.actors.get(conversationId);
    if (!actor) {
      logger.warn('لا يوجد تدفق جاري لهذه المحادثة لإعادة المحاولة', { correlationId, conversationId });
      return {
        success: false,
        state: 'failed',
        error: 'لا يوجد تدفق جاري',
      };
    }

    const snapshot = actor.getSnapshot();
    const currentState = snapshot.value as ChatFlowState;
    if (currentState !== 'failed') {
      logger.warn('لا يمكن إعادة المحاولة من حالة غير failed', {
        correlationId,
        conversationId,
        currentState,
      });
      return {
        success: false,
        state: currentState,
        error: `لا يمكن إعادة المحاولة من حالة ${currentState}`,
      };
    }

    try {
      actor.send({ type: 'RETRY' });

      const result = await new Promise<{ success: boolean; state: ChatFlowState; error?: string }>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.matches('completed')) {
            resolve({ success: true, state: 'completed' });
            subscription.unsubscribe();
            actor.stop();
          } else if (snapshot.matches('failed')) {
            resolve({
              success: false,
              state: 'failed',
              error: snapshot.context.error || 'فشل غير معروف',
            });
            subscription.unsubscribe();
          } else if (snapshot.matches('compensated')) {
            resolve({
              success: false,
              state: 'compensated',
              error: snapshot.context.error || 'تم التعويض',
            });
            subscription.unsubscribe();
            actor.stop();
          }
        });
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل إعادة المحاولة';
      logger.error('فشل إعادة محاولة تدفق المحادثة', {
        correlationId,
        conversationId,
        error: errorMessage,
      });
      return {
        success: false,
        state: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * تنفيذ المعاملة التعويضية (Compensation) لتدفق محادثة فاشل.
   */
  async compensate(conversationId: string, reason?: string): Promise<{ success: boolean; state: ChatFlowState; error?: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    const actor = this.actors.get(conversationId);
    if (!actor) {
      logger.warn('لا يوجد تدفق جاري لهذه المحادثة للتعويض', { correlationId, conversationId });
      return {
        success: false,
        state: 'failed',
        error: 'لا يوجد تدفق جاري',
      };
    }

    const snapshot = actor.getSnapshot();
    const currentState = snapshot.value as ChatFlowState;
    if (currentState !== 'failed') {
      logger.warn('لا يمكن التعويض من حالة غير failed', {
        correlationId,
        conversationId,
        currentState,
      });
      return {
        success: false,
        state: currentState,
        error: `لا يمكن التعويض من حالة ${currentState}`,
      };
    }

    try {
      actor.send({ type: 'COMPENSATE', reason: reason || 'تعويض يدوي' });

      const result = await new Promise<{ success: boolean; state: ChatFlowState; error?: string }>((resolve) => {
        const subscription = actor.subscribe((snapshot) => {
          if (snapshot.matches('compensated')) {
            resolve({
              success: true,
              state: 'compensated',
              error: snapshot.context.error || 'تم التعويض',
            });
            subscription.unsubscribe();
            actor.stop();
          } else if (snapshot.matches('failed')) {
            resolve({
              success: false,
              state: 'failed',
              error: snapshot.context.error || 'فشل التعويض',
            });
            subscription.unsubscribe();
          }
        });
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل التعويض';
      logger.error('فشل تنفيذ المعاملة التعويضية', {
        correlationId,
        conversationId,
        error: errorMessage,
      });
      return {
        success: false,
        state: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * الحصول على حالة التدفق الحالية لمحادثة.
   */
  getFlowState(conversationId: string): {
    state: ChatFlowState;
    context?: Partial<ChatFlowContext>;
    isActive: boolean;
  } {
    const actor = this.actors.get(conversationId);
    if (!actor) {
      return { state: 'idle', isActive: false };
    }

    const snapshot = actor.getSnapshot();
    const state = snapshot.value as ChatFlowState;
    const context = snapshot.context;

    return {
      state,
      context: {
        conversationId: context.conversationId,
        tenantId: context.tenantId,
        message: context.message,
        sentBy: context.sentBy,
        knowledgeBaseId: context.knowledgeBaseId,
        reply: context.reply,
        error: context.error,
        retryCount: context.retryCount,
        startedAt: context.startedAt,
        completedAt: context.completedAt,
        contextChunks: context.contextChunks,
      },
      isActive: !['completed', 'failed', 'compensated'].includes(state),
    };
  }

  /**
   * إيقاف تدفق محادثة (تنظيف).
   */
  stopFlow(conversationId: string): void {
    const actor = this.actors.get(conversationId);
    if (actor) {
      actor.stop();
      this.actors.delete(conversationId);
      const correlationId = getCurrentCorrelationId() || randomUUID();
      logger.debug('تم إيقاف تدفق المحادثة', {
        correlationId,
        conversationId,
      });
    }
  }

  /**
   * الحصول على جميع التدفقات الجارية.
   */
  getAllActiveFlows(): { conversationId: string; state: ChatFlowState; startedAt?: Date }[] {
    const result: { conversationId: string; state: ChatFlowState; startedAt?: Date }[] = [];
    for (const [conversationId, actor] of this.actors.entries()) {
      const snapshot = actor.getSnapshot();
      const state = snapshot.value as ChatFlowState;
      const context = snapshot.context;
      if (!['completed', 'failed', 'compensated'].includes(state)) {
        result.push({
          conversationId,
          state,
          startedAt: context.startedAt,
        });
      }
    }
    return result;
  }
}
