// backend/src/ai/prompts/index.ts
import { embeddingPrompt, EMBEDDING_PROMPT_ID, EMBEDDING_PROMPT_VERSION } from './embedding.prompt.js';
import { chatPrompt, CHAT_PROMPT_ID, CHAT_PROMPT_VERSION } from './chat.prompt.js';


// ============================================================
// تعريف المطالبات المُصدرة — §6
// ============================================================

/**
 * قاموس المطالبات المُصدرة.
 * المفتاح: معرف المطالبة (مثل 'embed-v1')
 * القيمة: كائن يحتوي على المعرف والإصدار والمحتوى والوصف.
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — مصدر واحد (SSoT) لجميع المطالبات.
 */
export const prompts = {
  /**
   * مطالبة التضمين (Embedding)
   * تُستخدم لاستخراج التضمينات من النصوص.
   */
  [EMBEDDING_PROMPT_ID]: {
    id: EMBEDDING_PROMPT_ID,
    version: EMBEDDING_PROMPT_VERSION,
    content: embeddingPrompt,
    description: 'مطالبة توليد التضمينات (Embedding) من النصوص باستخدام Claude',
    model: 'claude-3-sonnet-20241022',
    maxTokens: 4096,
  },

  /**
   * مطالبة المحادثة (Chat)
   * تُستخدم لتوليد ردود على استفسارات العملاء مع السياق.
   */
  [CHAT_PROMPT_ID]: {
    id: CHAT_PROMPT_ID,
    version: CHAT_PROMPT_VERSION,
    content: chatPrompt,
    description: 'مطالبة الرد على المحادثة (Chat) مع السياق والاستشهاد بالمصادر',
    model: 'claude-3-sonnet-20241022',
    maxTokens: 8192,
  },
} as const;

// ============================================================
// أنواع المطالبات المُصدرة
// ============================================================

/**
 * نوع مطالبة مُصدرة.
 */
export interface PromptDefinition {
  /** معرف المطالبة الفريد */
  id: string;
  /** إصدار المطالبة (Semantic Versioning) */
  version: string;
  /** محتوى المطالبة (النص الكامل) */
  content: string;
  /** وصف المطالبة */
  description: string;
  /** النموذج المُوصى به */
  model: string;
  /** الحد الأقصى للرموز */
  maxTokens: number;
}

/**
 * نوع قاموس المطالبات.
 */
export type PromptsMap = typeof prompts;

/**
 * معرفات المطالبات المُتاحة.
 */
export type PromptId = keyof PromptsMap;

// ============================================================
// دوال مساعدة للوصول إلى المطالبات
// ============================================================

/**
 * الحصول على مطالبة بواسطة معرفها.
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع المطالبة مع التحقق من وجودها.
 */
export function getPrompt(id: PromptId): PromptDefinition {
  const prompt = prompts[id];
  if (!prompt) {
    throw new Error(`المطالبة "${id}" غير موجودة`);
  }
  return prompt;
}

/**
 * الحصول على محتوى مطالبة بواسطة معرفها (كمادة خام).
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع المحتوى مباشرة.
 */
export function getPromptContent(id: PromptId): string {
  return getPrompt(id).content;
}

/**
 * الحصول على إصدار مطالبة.
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع الإصدار.
 */
export function getPromptVersion(id: PromptId): string {
  return getPrompt(id).version;
}

/**
 * التحقق من وجود مطالبة.
 * [مُتحقَّق منطقياً بتتبع كامل] — تحقق بسيط.
 */
export function hasPrompt(id: string): id is PromptId {
  return id in prompts;
}

/**
 * الحصول على قائمة بجميع معرفات المطالبات.
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع جميع المعرفات.
 */
export function getAllPromptIds(): PromptId[] {
  return Object.keys(prompts) as PromptId[];
}

/**
 * الحصول على جميع المطالبات (للاستخدام في التصحيح أو التصدير).
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع نسخة من الكائن.
 */
export function getAllPrompts(): Record<string, PromptDefinition> {
  return { ...prompts };
}

// ============================================================
// إعادة تصدير المعرفات والإصدارات للاستخدام في التطبيق
// ============================================================

export {
  EMBEDDING_PROMPT_ID,
  EMBEDDING_PROMPT_VERSION,
} from './embedding.prompt.js';

export {
  CHAT_PROMPT_ID,
  CHAT_PROMPT_VERSION,
} from './chat.prompt.js';


// ============================================================
// تصدير الكائنات والدوال
// ============================================================

export default {
  prompts,
  getPrompt,
  getPromptContent,
  getPromptVersion,
  hasPrompt,
  getAllPromptIds,
  getAllPrompts,
};

