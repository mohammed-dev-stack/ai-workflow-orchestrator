// ============================================================
// backend/src/orchestrators/documentProcessing.orchestrator.ts
// ============================================================
// منسق معالجة المستندات (Document Processing Orchestrator)
// باستخدام XState v5 (setup, createActor, subscribe).
// تم إصلاح عدم توافق الأنواع بين IChunkRepositoryForOrchestrator و DocumentChunkRepository
// عن طريق تعديل الواجهة لتقبل Promise<unknown> بدلاً من Promise<void>.
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

// استيراد المستودعات وخدمة التضمين
import {
  prisma,
  DocumentRepository,
  DocumentChunkRepository,
} from '../db/index.js';
import { embeddingService } from '../services/embedding.service.js';

// ============================================================
// أنواع السياق والأحداث
// ============================================================

export type DocumentProcessingState =
  | 'idle'
  | 'validating'
  | 'chunking'
  | 'embedding'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'compensating'
  | 'compensated';

export type DocumentProcessingEvent =
  | { type: 'START'; documentId: string; tenantId: string; knowledgeBaseId: string; text: string; uploadedBy: string; idempotencyKey?: string }
  | { type: 'VALIDATED' }
  | { type: 'VALIDATION_FAILED'; error: string }
  | { type: 'CHUNKED'; chunks: string[] }
  | { type: 'CHUNKING_FAILED'; error: string }
  | { type: 'EMBEDDED'; vectorCount: number }
  | { type: 'EMBEDDING_FAILED'; error: string }
  | { type: 'SAVED'; chunkCount: number; vectorCount: number }
  | { type: 'SAVING_FAILED'; error: string }
  | { type: 'COMPLETE' }
  | { type: 'FAIL'; error: string }
  | { type: 'COMPENSATE'; reason: string }
  | { type: 'COMPENSATED' }
  | { type: 'RESUME'; state: DocumentProcessingState; context: Partial<DocumentProcessingContext> }
  | { type: 'RETRY' };

export interface DocumentProcessingContext {
  documentId: string;
  tenantId: string;
  knowledgeBaseId: string;
  text: string;
  uploadedBy: string;
  chunks?: string[];
  vectorCount?: number;
  chunkCount?: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  idempotencyKey?: string;
  retryCount?: number;
  restoredState?: DocumentProcessingState;
  restoredContext?: Partial<DocumentProcessingContext>;
}

// ============================================================
// واجهات التبعيات (مع تعديل IChunkRepositoryForOrchestrator)
// ============================================================

export interface IDocumentRepositoryForOrchestrator {
  findById(id: string): Promise<any>;
  updateStatus(id: string, status: string, errorMessage?: string): Promise<any>;
  update(id: string, data: any): Promise<any>;
}

/**
 * ✅ تم تعديل IChunkRepositoryForOrchestrator:
 * تم تغيير deleteByDocumentId من Promise<void> إلى Promise<unknown>
 * لأن DocumentChunkRepository الفعلي يعيد BatchPayload من Prisma
 * وهذا يجعل الواجهة متوافقة مع التنفيذ الفعلي دون تغيير الكود الموجود.
 */
export interface IChunkRepositoryForOrchestrator {
  deleteByDocumentId(documentId: string): Promise<unknown>;
  countByDocumentId(documentId: string): Promise<number>;
}

export interface IEmbeddingServiceForOrchestrator {
  generateDocumentEmbeddings(options: {
    documentId: string;
    tenantId: string;
    knowledgeBaseId: string;
    text: string;
    chunkSize?: number;
    chunkOverlap?: number;
    idempotencyKey?: string;
  }): Promise<{ chunkCount: number; vectorCount: number }>;
  deleteDocumentEmbeddings(documentId: string, tenantId: string): Promise<void>;
}

type AuditEvent = {
  eventType: string;
  documentId: string;
  tenantId: string;
  userId: string;
  state: DocumentProcessingState;
  payload: Record<string, any>;
  timestamp: Date;
};

export interface IAuditService {
  log(event: AuditEvent): Promise<void>;
}

export interface DocumentProcessingOrchestratorOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  maxRetries?: number;
  enableCompensation?: boolean;
}

const DEFAULT_OPTIONS: Required<DocumentProcessingOrchestratorOptions> = {
  chunkSize: 1000,
  chunkOverlap: 200,
  maxRetries: 3,
  enableCompensation: true,
};

// ============================================================
// المنسق
// ============================================================

export class DocumentProcessingOrchestrator {
  private docRepo: IDocumentRepositoryForOrchestrator;
  private chunkRepo: IChunkRepositoryForOrchestrator;
  private embeddingService: IEmbeddingServiceForOrchestrator;
  private auditService?: IAuditService;
  private options: Required<DocumentProcessingOrchestratorOptions>;
  private actors: Map<string, ReturnType<typeof createActor>> = new Map();

  constructor(
    docRepo: IDocumentRepositoryForOrchestrator,
    chunkRepo: IChunkRepositoryForOrchestrator,
    embeddingService: IEmbeddingServiceForOrchestrator,
    auditService?: IAuditService,
    options: DocumentProcessingOrchestratorOptions = {}
  ) {
    this.docRepo = docRepo;
    this.chunkRepo = chunkRepo;
    this.embeddingService = embeddingService;
    this.auditService = auditService;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * بناء آلة الحالة باستخدام XState v5 (setup + createMachine).
   */
  private buildMachine() {
    const self = this;

    // دوال actors للمهام غير المتزامنة
    const validateInputsActor = fromPromise(
      async ({ input }: { input: { context: DocumentProcessingContext } }) => {
        const ctx = input.context;
        const correlationId = getCurrentCorrelationId() || randomUUID();
        const { documentId, tenantId, knowledgeBaseId, text, uploadedBy } = ctx;

        if (!documentId || !tenantId || !knowledgeBaseId || !text || !uploadedBy) {
          throw new ValidationError('بيانات غير مكتملة: documentId, tenantId, knowledgeBaseId, text, uploadedBy مطلوبة');
        }
        if (text.length < 3) {
          throw new ValidationError('النص قصير جداً للمعالجة (يجب أن يكون 3 أحرف على الأقل)');
        }

        const doc = await withRetryAndThrow(
          () => self.docRepo.findById(documentId),
          {
            operationName: 'orchestrator.validate.document',
            maxAttempts: 3,
            verboseLogging: false,
          }
        );

        if (!doc) throw new NotFoundError(`المستند ${documentId} غير موجود`);
        if (doc.tenantId !== tenantId) throw new ValidationError('المستند لا ينتمي إلى هذا المستأجر');
        if (doc.deletedAt) throw new ValidationError('المستند محذوف ولا يمكن معالجته');

        await self.docRepo.updateStatus(documentId, 'PROCESSING');

        logger.debug('تم التحقق من المدخلات بنجاح', {
          correlationId,
          documentId,
          tenantId,
          textLength: text.length,
        });

        return { success: true };
      }
    );

    const chunkDocumentActor = fromPromise(
      async ({ input }: { input: { context: DocumentProcessingContext } }) => {
        const ctx = input.context;
        const correlationId = getCurrentCorrelationId() || randomUUID();
        const { documentId, tenantId, knowledgeBaseId, text, idempotencyKey } = ctx;

        logger.debug('بدء تقطيع النص', {
          correlationId,
          documentId,
          textLength: text.length,
        });

        const result = await self.embeddingService.generateDocumentEmbeddings({
          documentId,
          tenantId,
          knowledgeBaseId,
          text,
          chunkSize: self.options.chunkSize,
          chunkOverlap: self.options.chunkOverlap,
          idempotencyKey: idempotencyKey || `chunk-${documentId}`,
        });

        logger.debug('تم تقطيع النص بنجاح', {
          correlationId,
          documentId,
          chunkCount: result.chunkCount,
          vectorCount: result.vectorCount,
        });

        return {
          chunkCount: result.chunkCount,
          vectorCount: result.vectorCount,
        };
      }
    );

    const generateEmbeddingsActor = fromPromise(
      async ({ input }: { input: { context: DocumentProcessingContext } }) => {
        const ctx = input.context;
        const correlationId = getCurrentCorrelationId() || randomUUID();
        const { documentId, tenantId, knowledgeBaseId, text, idempotencyKey } = ctx;

        logger.debug('بدء توليد التضمينات', {
          correlationId,
          documentId,
        });

        const result = await self.embeddingService.generateDocumentEmbeddings({
          documentId,
          tenantId,
          knowledgeBaseId,
          text,
          chunkSize: self.options.chunkSize,
          chunkOverlap: self.options.chunkOverlap,
          idempotencyKey: idempotencyKey || `embed-${documentId}`,
        });

        logger.debug('تم توليد التضمينات بنجاح', {
          correlationId,
          documentId,
          chunkCount: result.chunkCount,
          vectorCount: result.vectorCount,
        });

        return {
          chunkCount: result.chunkCount,
          vectorCount: result.vectorCount,
        };
      }
    );

    const saveChunksActor = fromPromise(
      async ({ input }: { input: { context: DocumentProcessingContext } }) => {
        const ctx = input.context;
        const correlationId = getCurrentCorrelationId() || randomUUID();
        const { documentId, chunkCount, vectorCount } = ctx;

        logger.debug('تأكيد حفظ التضمينات', {
          correlationId,
          documentId,
          chunkCount,
          vectorCount,
        });

        const count = await self.chunkRepo.countByDocumentId(documentId);
        if (count === 0) throw new Error('لم يتم حفظ أي تضمينات للمستند');

        logger.debug('تم حفظ التضمينات بنجاح', {
          correlationId,
          documentId,
          savedChunks: count,
        });

        return { chunkCount: count };
      }
    );

    const compensateActor = fromPromise(
      async ({ input }: { input: { context: DocumentProcessingContext } }) => {
        const ctx = input.context;
        const correlationId = getCurrentCorrelationId() || randomUUID();
        const { documentId, tenantId } = ctx;

        logger.warn('تنفيذ المعاملة التعويضية: حذف التضمينات', {
          correlationId,
          documentId,
          tenantId,
        });

        // ✅ الآن أصبحت الواجهة تتوقع Promise<unknown>، وهذا متوافق مع
        // DocumentChunkRepository الذي يعيد BatchPayload
        await self.chunkRepo.deleteByDocumentId(documentId);
        await self.embeddingService.deleteDocumentEmbeddings(documentId, tenantId);
        await self.docRepo.updateStatus(documentId, 'FAILED', 'تم التعويض بعد فشل المعالجة');

        logger.info('اكتملت المعاملة التعويضية', {
          correlationId,
          documentId,
          tenantId,
        });

        return { success: true };
      }
    );

    // بناء آلة الحالة باستخدام setup
    const machine = setup({
      types: {
        context: {} as DocumentProcessingContext,
        events: {} as DocumentProcessingEvent,
      },
      actors: {
        validateInputs: validateInputsActor,
        chunkDocument: chunkDocumentActor,
        generateEmbeddings: generateEmbeddingsActor,
        saveChunks: saveChunksActor,
        compensate: compensateActor,
      },
      actions: {
        assignStartData: assign(({ event, context }) => {
          const e = event as Extract<DocumentProcessingEvent, { type: 'START' }>;
          return {
            documentId: e.documentId,
            tenantId: e.tenantId,
            knowledgeBaseId: e.knowledgeBaseId,
            text: e.text,
            uploadedBy: e.uploadedBy,
            idempotencyKey: e.idempotencyKey || randomUUID(),
            startedAt: new Date(),
            retryCount: context.retryCount || 0,
          };
        }),

        restoreContext: assign(({ event, context }) => {
          const e = event as Extract<DocumentProcessingEvent, { type: 'RESUME' }>;
          return {
            ...context,
            ...e.context,
            restoredState: e.state,
            startedAt: e.context.startedAt || new Date(),
          };
        }),

        setChunks: assign(({ event }) => {
          const e = event as Extract<DocumentProcessingEvent, { type: 'CHUNKED' }>;
          return {
            chunks: e.chunks,
            chunkCount: e.chunks.length,
          };
        }),

        setEmbeddingResult: assign(({ event }) => {
          const e = event as Extract<DocumentProcessingEvent, { type: 'EMBEDDED' }>;
          return { vectorCount: e.vectorCount };
        }),

        setSaveResult: assign(({ event }) => {
          const e = event as Extract<DocumentProcessingEvent, { type: 'SAVED' }>;
          return {
            chunkCount: e.chunkCount,
            vectorCount: e.vectorCount,
          };
        }),

        setError: assign(({ event }) => {
          const e = event as Extract<DocumentProcessingEvent, { type: 'VALIDATION_FAILED' | 'CHUNKING_FAILED' | 'EMBEDDING_FAILED' | 'SAVING_FAILED' | 'FAIL' }>;
          return { error: e.error };
        }),

        setCompensationReason: assign(({ event }) => {
          const e = event as Extract<DocumentProcessingEvent, { type: 'COMPENSATE' }>;
          return { error: e.reason };
        }),

        incrementRetry: assign(({ context }) => ({
          retryCount: (context.retryCount || 0) + 1,
        })),

        clearError: assign(() => ({ error: undefined })),

        markComplete: assign(() => ({ completedAt: new Date() })),

        updateDocumentStatusValidating: async ({ context }) => {
          await self.docRepo.updateStatus(context.documentId, 'PROCESSING');
        },

        updateDocumentStatusFailed: async ({ context }) => {
          await self.docRepo.updateStatus(context.documentId, 'FAILED', context.error);
        },

        updateDocumentStatusCompleted: async ({ context }) => {
          await self.docRepo.updateStatus(context.documentId, 'COMPLETED');
          await self.docRepo.update(context.documentId, {
            processedAt: new Date(),
            chunkCount: context.chunkCount,
            vectorCount: context.vectorCount,
          });
        },

        logStart: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('بدء معالجة المستند', {
            correlationId,
            documentId: context.documentId,
            tenantId: context.tenantId,
            textLength: context.text.length,
          });
          self.auditService?.log({
            eventType: 'document.processing.started',
            documentId: context.documentId,
            tenantId: context.tenantId,
            userId: context.uploadedBy,
            state: 'idle',
            payload: { textLength: context.text.length },
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
            documentId: context.documentId,
          });
        },

        logValidated: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تم التحقق من المدخلات', {
            correlationId,
            documentId: context.documentId,
          });
        },

        logValidationFailed: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.warn('فشل التحقق من المدخلات', {
            correlationId,
            documentId: context.documentId,
            error: context.error,
          });
        },

        logChunkingStart: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('بدء تقطيع النص', {
            correlationId,
            documentId: context.documentId,
          });
        },

        logChunked: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تم تقطيع النص', {
            correlationId,
            documentId: context.documentId,
            chunkCount: context.chunkCount,
          });
        },

        logChunkingFailed: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.error('فشل تقطيع النص', {
            correlationId,
            documentId: context.documentId,
            error: context.error,
          });
        },

        logEmbeddingStart: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('بدء توليد التضمينات', {
            correlationId,
            documentId: context.documentId,
          });
        },

        logEmbedded: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تم توليد التضمينات', {
            correlationId,
            documentId: context.documentId,
            vectorCount: context.vectorCount,
          });
        },

        logEmbeddingFailed: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.error('فشل توليد التضمينات', {
            correlationId,
            documentId: context.documentId,
            error: context.error,
          });
        },

        logSavingStart: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('بدء حفظ التضمينات', {
            correlationId,
            documentId: context.documentId,
          });
        },

        logSaved: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تم حفظ التضمينات', {
            correlationId,
            documentId: context.documentId,
            chunkCount: context.chunkCount,
            vectorCount: context.vectorCount,
          });
        },

        logSavingFailed: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.error('فشل حفظ التضمينات', {
            correlationId,
            documentId: context.documentId,
            error: context.error,
          });
        },

        logComplete: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('اكتملت معالجة المستند', {
            correlationId,
            documentId: context.documentId,
            tenantId: context.tenantId,
            chunkCount: context.chunkCount,
            vectorCount: context.vectorCount,
            durationMs: context.startedAt ? Date.now() - context.startedAt.getTime() : undefined,
          });
          self.auditService?.log({
            eventType: 'document.processing.completed',
            documentId: context.documentId,
            tenantId: context.tenantId,
            userId: context.uploadedBy,
            state: 'completed',
            payload: {
              chunkCount: context.chunkCount,
              vectorCount: context.vectorCount,
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

        logFailure: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.error('فشل معالجة المستند', {
            correlationId,
            documentId: context.documentId,
            tenantId: context.tenantId,
            error: context.error,
            retryCount: context.retryCount,
            event: 'document.processing.failed',
          });
          self.auditService?.log({
            eventType: 'document.processing.failed',
            documentId: context.documentId,
            tenantId: context.tenantId,
            userId: context.uploadedBy,
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
          logger.info('إعادة محاولة معالجة المستند', {
            correlationId,
            documentId: context.documentId,
            retryCount: context.retryCount,
            maxRetries: self.options.maxRetries,
          });
        },

        logCompensationStart: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.warn('بدء المعاملة التعويضية', {
            correlationId,
            documentId: context.documentId,
            reason: context.error,
          });
        },

        logCompensationExecuting: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.debug('تنفيذ المعاملة التعويضية', {
            correlationId,
            documentId: context.documentId,
          });
        },

        logCompensated: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('اكتملت المعاملة التعويضية بنجاح', {
            correlationId,
            documentId: context.documentId,
            tenantId: context.tenantId,
          });
          self.auditService?.log({
            eventType: 'document.processing.compensated',
            documentId: context.documentId,
            tenantId: context.tenantId,
            userId: context.uploadedBy,
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
            documentId: context.documentId,
            error: context.error,
          });
        },

        logCompensatedFinal: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('تم التعويض النهائي للمستند', {
            correlationId,
            documentId: context.documentId,
            tenantId: context.tenantId,
          });
        },

        logResume: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          logger.info('استئناف آلة الحالة', {
            correlationId,
            documentId: context.documentId,
            restoredState: context.restoredState,
          });
        },

        cleanup: ({ context }) => {
          const correlationId = getCurrentCorrelationId() || randomUUID();
          if (self.actors.has(context.documentId)) {
            self.actors.delete(context.documentId);
            logger.debug('تم تنظيف آلة الحالة', {
              correlationId,
              documentId: context.documentId,
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
      id: 'documentProcessing',
      initial: 'idle',
      context: {
        documentId: '',
        tenantId: '',
        knowledgeBaseId: '',
        text: '',
        uploadedBy: '',
        retryCount: 0,
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
          entry: ['logValidating', 'updateDocumentStatusValidating'],
          invoke: {
            src: 'validateInputs',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'chunking',
              actions: ['logValidated'],
            },
            onError: {
              target: 'failed',
              actions: [
                assign(({ event }) => ({
                  error: event.error instanceof Error ? event.error.message : String(event.error),
                })),
                'logValidationFailed',
                'updateDocumentStatusFailed',
              ],
            },
          },
        },
        chunking: {
          entry: ['logChunkingStart'],
          invoke: {
            src: 'chunkDocument',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'embedding',
              actions: [
                assign(({ event }) => ({
                  chunkCount: event.output.chunkCount,
                  vectorCount: event.output.vectorCount,
                })),
                'logChunked',
              ],
            },
            onError: {
              target: 'failed',
              actions: [
                assign(({ event }) => ({
                  error: event.error instanceof Error ? event.error.message : String(event.error),
                })),
                'logChunkingFailed',
                'updateDocumentStatusFailed',
              ],
            },
          },
        },
        embedding: {
          entry: ['logEmbeddingStart'],
          invoke: {
            src: 'generateEmbeddings',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'saving',
              actions: [
                assign(({ event }) => ({
                  chunkCount: event.output.chunkCount,
                  vectorCount: event.output.vectorCount,
                })),
                'logEmbedded',
              ],
            },
            onError: {
              target: 'failed',
              actions: [
                assign(({ event }) => ({
                  error: event.error instanceof Error ? event.error.message : String(event.error),
                })),
                'logEmbeddingFailed',
                'updateDocumentStatusFailed',
              ],
            },
          },
        },
        saving: {
          entry: ['logSavingStart'],
          invoke: {
            src: 'saveChunks',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'completed',
              actions: [
                assign(({ event }) => ({
                  chunkCount: event.output.chunkCount,
                })),
                'logSaved',
              ],
            },
            onError: {
              target: 'failed',
              actions: [
                assign(({ event }) => ({
                  error: event.error instanceof Error ? event.error.message : String(event.error),
                })),
                'logSavingFailed',
                'updateDocumentStatusFailed',
              ],
            },
          },
        },
        completed: {
          type: 'final' as const,
          entry: ['markComplete', 'logComplete', 'updateDocumentStatusCompleted', 'cleanup'],
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
            src: 'compensate',
            input: ({ context }) => ({ context }),
            onDone: {
              target: 'compensated',
              actions: ['logCompensated', 'updateDocumentStatusFailed'],
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
   * بدء معالجة مستند جديد.
   */
  async startProcessing(
    documentId: string,
    tenantId: string,
    knowledgeBaseId: string,
    text: string,
    uploadedBy: string,
    idempotencyKey?: string
  ): Promise<{ success: boolean; state: DocumentProcessingState; error?: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (this.actors.has(documentId)) {
      logger.warn('يوجد بالفعل عملية معالجة جارية لهذا المستند', { correlationId, documentId });
      const actor = this.actors.get(documentId);
      return {
        success: false,
        state: actor?.getSnapshot().value as DocumentProcessingState || 'idle',
        error: 'عملية معالجة جارية بالفعل',
      };
    }

    try {
      const machine = this.buildMachine();
      const actor = createActor(machine);
      this.actors.set(documentId, actor);
      actor.start();

      actor.send({
        type: 'START',
        documentId,
        tenantId,
        knowledgeBaseId,
        text,
        uploadedBy,
        idempotencyKey: idempotencyKey || randomUUID(),
      });

      const result = await new Promise<{ success: boolean; state: DocumentProcessingState; error?: string }>((resolve) => {
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
      const errorMessage = error instanceof Error ? error.message : 'فشل بدء المعالجة';
      logger.error('فشل بدء معالجة المستند', {
        correlationId,
        documentId,
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
   * استئناف معالجة مستند من حالة سابقة.
   */
  async resumeProcessing(
    documentId: string,
    state: DocumentProcessingState,
    context: Partial<DocumentProcessingContext>
  ): Promise<{ success: boolean; state: DocumentProcessingState; error?: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    if (this.actors.has(documentId)) {
      logger.warn('يوجد بالفعل عملية معالجة جارية لهذا المستند', { correlationId, documentId });
      return {
        success: false,
        state: 'idle',
        error: 'عملية معالجة جارية بالفعل',
      };
    }

    try {
      const machine = this.buildMachine();
      const actor = createActor(machine);
      this.actors.set(documentId, actor);
      actor.start();

      actor.send({
        type: 'RESUME',
        state,
        context,
      });

      const result = await new Promise<{ success: boolean; state: DocumentProcessingState; error?: string }>((resolve) => {
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
      const errorMessage = error instanceof Error ? error.message : 'فشل استئناف المعالجة';
      logger.error('فشل استئناف معالجة المستند', {
        correlationId,
        documentId,
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
   * إعادة محاولة معالجة مستند فاشل.
   */
  async retryProcessing(documentId: string): Promise<{ success: boolean; state: DocumentProcessingState; error?: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    const actor = this.actors.get(documentId);
    if (!actor) {
      logger.warn('لا توجد عملية معالجة جارية لهذا المستند لإعادة المحاولة', { correlationId, documentId });
      return {
        success: false,
        state: 'failed',
        error: 'لا توجد عملية معالجة جارية',
      };
    }

    const snapshot = actor.getSnapshot();
    const currentState = snapshot.value as DocumentProcessingState;
    if (currentState !== 'failed') {
      logger.warn('لا يمكن إعادة المحاولة من حالة غير failed', {
        correlationId,
        documentId,
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

      const result = await new Promise<{ success: boolean; state: DocumentProcessingState; error?: string }>((resolve) => {
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
      logger.error('فشل إعادة محاولة معالجة المستند', {
        correlationId,
        documentId,
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
   * تنفيذ المعاملة التعويضية (Compensation) لمستند فاشل.
   */
  async compensate(documentId: string, reason?: string): Promise<{ success: boolean; state: DocumentProcessingState; error?: string }> {
    const correlationId = getCurrentCorrelationId() || randomUUID();

    const actor = this.actors.get(documentId);
    if (!actor) {
      logger.warn('لا توجد عملية معالجة جارية لهذا المستند للتعويض', { correlationId, documentId });
      return {
        success: false,
        state: 'failed',
        error: 'لا توجد عملية معالجة جارية',
      };
    }

    const snapshot = actor.getSnapshot();
    const currentState = snapshot.value as DocumentProcessingState;
    if (currentState !== 'failed') {
      logger.warn('لا يمكن التعويض من حالة غير failed', {
        correlationId,
        documentId,
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

      const result = await new Promise<{ success: boolean; state: DocumentProcessingState; error?: string }>((resolve) => {
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
        documentId,
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
   * الحصول على حالة المعالجة الحالية لمستند.
   */
  getProcessingState(documentId: string): {
    state: DocumentProcessingState;
    context?: Partial<DocumentProcessingContext>;
    isActive: boolean;
  } {
    const actor = this.actors.get(documentId);
    if (!actor) {
      return { state: 'idle', isActive: false };
    }

    const snapshot = actor.getSnapshot();
    const state = snapshot.value as DocumentProcessingState;
    const context = snapshot.context;

    return {
      state,
      context: {
        documentId: context.documentId,
        tenantId: context.tenantId,
        knowledgeBaseId: context.knowledgeBaseId,
        uploadedBy: context.uploadedBy,
        chunkCount: context.chunkCount,
        vectorCount: context.vectorCount,
        error: context.error,
        retryCount: context.retryCount,
        startedAt: context.startedAt,
        completedAt: context.completedAt,
      },
      isActive: !['completed', 'failed', 'compensated'].includes(state),
    };
  }

  /**
   * إيقاف عملية معالجة (تنظيف).
   */
  stopProcessing(documentId: string): void {
    const actor = this.actors.get(documentId);
    if (actor) {
      actor.stop();
      this.actors.delete(documentId);
      const correlationId = getCurrentCorrelationId() || randomUUID();
      logger.debug('تم إيقاف معالجة المستند', {
        correlationId,
        documentId,
      });
    }
  }

  /**
   * الحصول على جميع العمليات الجارية.
   */
  getAllActiveProcesses(): { documentId: string; state: DocumentProcessingState; startedAt?: Date }[] {
    const result: { documentId: string; state: DocumentProcessingState; startedAt?: Date }[] = [];
    for (const [documentId, actor] of this.actors.entries()) {
      const snapshot = actor.getSnapshot();
      const state = snapshot.value as DocumentProcessingState;
      const context = snapshot.context;
      if (!['completed', 'failed', 'compensated'].includes(state)) {
        result.push({
          documentId,
          state,
          startedAt: context.startedAt,
        });
      }
    }
    return result;
  }
}

// ============================================================
// دالة مساعدة لمعالجة مستند (واجهة مبسطة لـ BullMQ)
// ============================================================

/**
 * معالجة مستند باستخدام الـ Orchestrator.
 * هذه الدالة هي واجهة مبسطة لاستدعائها من قوائم الانتظار.
 */
export async function processDocument(
  tenantId: string,
  documentId: string,
  fileName: string,
  fileContent: string
): Promise<void> {
  // استيراد التبعيات من داخل الدالة لتجنب الدورات المرجعية
  const { prisma, DocumentRepository, DocumentChunkRepository } = await import('../db/index.js');
  const { embeddingService } = await import('../services/embedding.service.js');

  const orchestrator = new DocumentProcessingOrchestrator(
    new DocumentRepository(prisma),
    // ✅ الآن DocumentChunkRepository متوافق مع IChunkRepositoryForOrchestrator
    // لأن الواجهة أصبحت تنتظر Promise<unknown> بدلاً من Promise<void>
    new DocumentChunkRepository(prisma),
    embeddingService,
    undefined, // auditService (اختياري)
    {
      chunkSize: 1000,
      chunkOverlap: 200,
      maxRetries: 3,
      enableCompensation: true,
    }
  );

  // جلب معرف قاعدة المعرفة من المستند
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { knowledgeBaseId: true },
  });

  if (!doc) {
    throw new Error(`المستند ${documentId} غير موجود`);
  }

  const result = await orchestrator.startProcessing(
    documentId,
    tenantId,
    doc.knowledgeBaseId,
    fileContent,
    'system', // uploadedBy (يمكن تمرير معرف المستخدم الفعلي)
    `queue-${documentId}`
  );

  if (!result.success) {
    throw new Error(result.error || 'فشل معالجة المستند');
  }

  logger.info('تمت معالجة المستند بنجاح عبر الـ Orchestrator', {
    documentId,
    tenantId,
    state: result.state,
  });
}
