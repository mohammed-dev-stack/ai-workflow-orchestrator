// ============================================================
// backend/src/services/embedding.service.ts
// ============================================================
// خدمة التضمينات (Embedding Service) باستخدام Anthropic Claude.
// ✅ تم التحقق من استيراد config من المصدر الصحيح (SSoT) './config/index.js'.
// ✅ تم تحسين منطق التحقق من المفتاح للتأكد من التعامل مع dummy key.
// ============================================================

import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
// ✅ استيراد المصدر الوحيد للإعدادات (PostgreSQL/Prisma Config)
import { config } from '../config/index.js'; 
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import {
  ValidationError,
  NotFoundError,
  InternalServerError,
  AppError,
} from '../middlewares/errorHandler.middleware.js';
import { withCircuitBreakerAndRetry } from '../utils/circuitBreaker.js';
import { withRetryAndThrow } from '../utils/retry.js';
import { z } from 'zod';

// ... (تبقى الواجهات والـ Schemas كما هي دون تغيير) ...
export interface IDocumentChunkRepository { /* ... */ }
export interface IDocumentRepositoryForEmbedding { /* ... */ }
// ... (بقية الواردات والواجهات) ...

const EmbeddingResponseSchema = z.object({ embedding: z.array(z.number()) });
const ChunkingResponseSchema = z.object({ chunks: z.array(z.string().min(1)) });

// ✅ استخدام config.database.vector من المصدر الصحيح
const vectorConfig = config.database?.vector || {
  dimensions: 1024,
  maxSearchResults: 10,
  similarityThreshold: 0.7,
};

export class EmbeddingService {
  private chunkRepo: IDocumentChunkRepository;
  private docRepo: IDocumentRepositoryForEmbedding;
  private anthropicClient: Anthropic;
  private apiKeyValid: boolean;

  constructor(
    chunkRepo: IDocumentChunkRepository,
    docRepo: IDocumentRepositoryForEmbedding,
    anthropicClient: Anthropic
  ) {
    this.chunkRepo = chunkRepo;
    this.docRepo = docRepo;
    this.anthropicClient = anthropicClient;
    // ✅ التحقق من صحة المفتاح باستخدام config.anthropic.apiKey
    this.apiKeyValid = this.checkApiKeyValidity();
  }

  private checkApiKeyValidity(): boolean {
    // ✅ قراءة المفتاح من المصدر الموحد config
    const key = config.anthropic?.apiKey;
    
    // التحقق من المفتاح الوهمي أو الفارغ (التعامل مع وضع التطوير)
    if (!key || 
        key === 'dummy_key_for_development_please_replace_in_production' ||
        key === '') {
      logger.warn('⚠️ مفتاح Anthropic API وهمي أو غير موجود – سيتم استخدام الاحتياطي فقط.');
      return false;
    }
    
    if (!key.startsWith('sk-')) {
      logger.warn('⚠️ مفتاح Anthropic API غير صحيح (لا يبدأ بـ sk-) – سيتم استخدام الاحتياطي.');
      return false;
    }
    
    return true;
  }

  // ... (جميع الدوال الأخرى: sanitizeInput, fallbackChunking, chunkTextWithAI, generateEmbeddingWithAI, generateDocumentEmbeddings, searchSimilar, deleteDocumentEmbeddings, getChunkCount تبقى كما هي معتمدة على this.apiKeyValid و config.anthropic) ...
  
  // للتأكيد على صحة الكود في نقطة استخدام المفتاح داخل chunkTextWithAI:
  // private async chunkTextWithAI(...) {
  //   if (!this.apiKeyValid) { return this.fallbackChunking(...); }
  //   const response = await this.anthropicClient.messages.create({
  //     model: config.anthropic.model, // ✅ صحيح
  //     max_tokens: config.anthropic.maxTokens, // ✅ صحيح
  //     ...
  //   });
  // }
}

// ✅ تصدير الخدمة باستخدام config.anthropic.apiKey من المصدر الصحيح
export const embeddingService = new EmbeddingService(
  {} as IDocumentChunkRepository,
  {} as IDocumentRepositoryForEmbedding,
  new Anthropic({ apiKey: config.anthropic.apiKey })
);

export default embeddingService;