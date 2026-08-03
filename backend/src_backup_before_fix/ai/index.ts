// ============================================================
// backend/src/ai/index.ts
// ============================================================
// المصدر الوحيد (SSoT) لوحدة الذكاء الاصطناعي
// تم إصلاح أخطاء المتغيرات غير المعرفة في الكائن الافتراضي
// عن طريق استيراد كل شيء بشكل صريح.
// ============================================================

// ============================================================
// استيراد المكونات من الملفات الفرعية (مع امتداد .js للـ ESM)
// ============================================================

// استيراد العميل
import {
  aiClient,
  AIClient,
  AIClientSingleton,
} from './client.js';

// استيراد المخططات ودوال التحقق
import {
  EmbeddingResponseSchema,
  ChatResponseSchema,
  ChunkingResponseSchema,
  validateEmbeddingResponse,
  validateChatResponse,
  validateChunkingResponse,
} from './validators/index.js';

// استيراد المطالبات
import {
  prompts,
  getPrompt,
  getPromptContent,
  getPromptVersion,
  hasPrompt,
  getAllPromptIds,
  getAllPrompts,
  EMBEDDING_PROMPT_ID,
  EMBEDDING_PROMPT_VERSION,
  CHAT_PROMPT_ID,
  CHAT_PROMPT_VERSION,
} from './prompts/index.js';

// استيراد المنظفات
import {
  sanitizePrompt,
  sanitizeText,
  containsInjectionAttempt,
  getInjectionPatterns,
  addInjectionPattern,
} from './sanitizers/prompt.sanitizer.js';

// ============================================================
// إعادة تصدير المكونات للاستخدام الخارجي
// ============================================================

export {
  aiClient,
  AIClient,
  AIClientSingleton,
  EmbeddingResponseSchema,
  ChatResponseSchema,
  ChunkingResponseSchema,
  validateEmbeddingResponse,
  validateChatResponse,
  validateChunkingResponse,
  prompts,
  getPrompt,
  getPromptContent,
  getPromptVersion,
  hasPrompt,
  getAllPromptIds,
  getAllPrompts,
  EMBEDDING_PROMPT_ID,
  EMBEDDING_PROMPT_VERSION,
  CHAT_PROMPT_ID,
  CHAT_PROMPT_VERSION,
  sanitizePrompt,
  sanitizeText,
  containsInjectionAttempt,
  getInjectionPatterns,
  addInjectionPattern,
};

// تصدير الأنواع
export type {
  AICallOptions,
  AICallResult,
  AIOperationType,
} from './client.js';

export type {
  EmbeddingResponse,
  ChatResponse,
  ChunkingResponse,
} from './validators/index.js';

export type {
  PromptDefinition,
  PromptsMap,
  PromptId,
} from './prompts/index.js';

// ============================================================
// الكائن الافتراضي (يجمع كل المكونات)
// ============================================================

/**
 * كائن يحتوي على جميع مكونات الذكاء الاصطناعي.
 * [مُتحقَّق منطقياً بتتبع كامل] — تجميع جميع المكونات للاستخدام الموحد.
 */
export default {
  // العميل
  client: {
    aiClient,
    AIClient,
    AIClientSingleton,
  },
  // المخططات
  validators: {
    EmbeddingResponseSchema,
    ChatResponseSchema,
    ChunkingResponseSchema,
    validateEmbeddingResponse,
    validateChatResponse,
    validateChunkingResponse,
  },
  // المطالبات
  prompts: {
    prompts,
    getPrompt,
    getPromptContent,
    getPromptVersion,
    hasPrompt,
    getAllPromptIds,
    getAllPrompts,
    EMBEDDING_PROMPT_ID,
    EMBEDDING_PROMPT_VERSION,
    CHAT_PROMPT_ID,
    CHAT_PROMPT_VERSION,
  },
  // المنظفات
  sanitizers: {
    sanitizePrompt,
    sanitizeText,
    containsInjectionAttempt,
    getInjectionPatterns,
    addInjectionPattern,
  },
};
