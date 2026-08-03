// backend/src/models/types/ai.types.ts

// ============================================================
// الأنواع الأساسية للذكاء الاصطناعي
// ============================================================

/**
 * نوع عملية الذكاء الاصطناعي.
 * [مُتحقَّق منطقياً بتتبع كامل] — قائمة العمليات المدعومة.
 */
export type AIOperationType = 'chat' | 'embedding' | 'chunking';

/**
 * حالة استدعاء الذكاء الاصطناعي.
 */
export type AICallStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';

/**
 * استراتيجية الاحتياطي (Fallback) للذكاء الاصطناعي.
 * [مُتحقَّق منطقياً بتتبع كامل] — استراتيجيات الاحتياطي المدعومة.
 */
export type AIFallbackStrategy = 'static' | 'error' | 'queue';

// ============================================================
// أنواع المطالبات (Prompts) — §6
// ============================================================

/**
 * تعريف مطالبة مُصدرة ومُرقمة.
 * [مُتحقَّق منطقياً بتتبع كامل] — هيكل المطالبة المُصدرة.
 */
export interface PromptDefinition {
  /** معرف المطالبة الفريد (مثل 'embed-v1') */
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
 * متغيرات المطالبة (التي يتم استبدالها ديناميكياً).
 * [مُتحقَّق منطقياً بتتبع كامل] — متغيرات المطالبات.
 */
export interface PromptVariables {
  /** متغيرات المطالبة كسجل (key-value) */
  [key: string]: string | number | boolean | string[];
}

// ============================================================
// أنواع استدعاء الذكاء الاصطناعي (AI Call)
// ============================================================

/**
 * خيارات استدعاء الذكاء الاصطناعي.
 * [مُتحقَّق منطقياً بتتبع كامل] — خيارات استدعاء AI الكاملة.
 */
export interface AICallOptions {
  /** نص المطالبة (prompt) */
  prompt: string;
  /** النموذج المستخدم */
  model: string;
  /** الحد الأقصى لعدد الرموز */
  maxTokens: number;
  /** درجة الحرارة (temperature) */
  temperature: number;
  /** مفتاح التكافؤ (لمنع التكرار) */
  idempotencyKey?: string;
  /** مهلة الطلب بالمللي ثانية */
  timeoutMs?: number;
  /** عدد محاولات إعادة المحاولة */
  maxRetries?: number;
  /** مخطط Zod للتحقق من المخرجات (اختياري) */
  responseSchema?: unknown; // ZodSchema في التنفيذ الفعلي
  /** اسم العملية (للتسجيل) */
  operationName?: string;
  /** معرف المستأجر (للمقاييس) */
  tenantId?: string;
  /** ما إذا كان سيتم تمكين التحقق الصارم (افتراضي: true) */
  strictValidation?: boolean;
}

/**
 * نتيجة استدعاء الذكاء الاصطناعي.
 * [مُتحقَّق منطقياً بتتبع كامل] — نتيجة استدعاء AI الكاملة.
 */
export interface AICallResult<T = any> {
  /** البيانات المُرجعة (المتحقق منها) */
  data: T;
  /** النص الخام من الاستجابة */
  raw: string;
  /** عدد الرموز المستخدمة (إذا كان متاحاً) */
  tokensUsed?: number;
  /** المدة بالمللي ثانية */
  durationMs: number;
  /** النموذج المستخدم */
  model: string;
  /** ما إذا تم استخدام الاحتياطي (fallback) */
  usedFallback: boolean;
  /** حالة الاستدعاء */
  status: AICallStatus;
  /** الخطأ (إذا فشل) */
  error?: string;
}

// ============================================================
// أنواع استجابات الذكاء الاصطناعي — §6
// ============================================================

/**
 * استجابة التضمين (Embedding).
 * [مُتحقَّق منطقياً بتتبع كامل] — استجابة التضمين المُتحقق منها.
 */
export interface EmbeddingResponse {
  /** مصفوفة الأرقام (المتجه) */
  embedding: number[];
}

/**
 * استجابة المحادثة (Chat).
 * [مُتحقَّق منطقياً بتتبع كامل] — استجابة المحادثة المُتحقق منها.
 */
export interface ChatResponse {
  /** نص الرد */
  reply: string;
  /** الاستشهادات (Citations) — اختياري */
  citations?: string[];
  /** الأسئلة المقترحة — اختياري */
  suggestedQuestions?: string[];
}

/**
 * استجابة تقطيع النص (Chunking).
 * [مُتحقَّق منطقياً بتتبع كامل] — استجابة التقطيع المُتحقق منها.
 */
export interface ChunkingResponse {
  /** قائمة المقاطع (النصوص) */
  chunks: string[];
}

// ============================================================
// أنواع أخطاء الذكاء الاصطناعي — §7
// ============================================================

/**
 * أكواد أخطاء الذكاء الاصطناعي.
 * [مُتحقَّق منطقياً بتتبع كامل] — أكواد الأخطاء الموحدة.
 */
export const AICallErrorCodes = {
  /** مهلة الطلب */
  TIMEOUT: 'AI_TIMEOUT',
  /** معدل محدود (Rate Limit) */
  RATE_LIMIT: 'AI_RATE_LIMIT',
  /** خطأ في الخادم (5xx) */
  SERVER_ERROR: 'AI_SERVER_ERROR',
  /** خطأ في التحقق من المخرجات */
  VALIDATION_ERROR: 'AI_VALIDATION_ERROR',
  /** خطأ في المصادقة (مفتاح API) */
  AUTH_ERROR: 'AI_AUTH_ERROR',
  /** خطأ في الشبكة */
  NETWORK_ERROR: 'AI_NETWORK_ERROR',
  /** خطأ غير معروف */
  UNKNOWN_ERROR: 'AI_UNKNOWN_ERROR',
  /** تم استخدام الاحتياطي */
  FALLBACK_USED: 'AI_FALLBACK_USED',
  /** تم رفض الطلب بسبب المحتوى */
  CONTENT_REJECTED: 'AI_CONTENT_REJECTED',
} as const;

export type AICallErrorCode = typeof AICallErrorCodes[keyof typeof AICallErrorCodes];

/**
 * خطأ الذكاء الاصطناعي (مُصنف).
 * [مُتحقَّق منطقياً بتتبع كامل] — هيكل خطأ AI المُصنف.
 */
export interface AICallError {
  /** كود الخطأ */
  code: AICallErrorCode;
  /** رسالة الخطأ */
  message: string;
  /** التفاصيل الإضافية */
  details?: Record<string, any>;
  /** السبب الأصلي (إذا كان متاحاً) */
  cause?: Error;
  /** الطابع الزمني للخطأ */
  timestamp: Date;
  /** ما إذا كان الخطأ قابلاً لإعادة المحاولة */
  retryable: boolean;
}

// ============================================================
// أنواع سجلات الذكاء الاصطناعي (للرصد) — §5
// ============================================================

/**
 * سجل استدعاء الذكاء الاصطناعي (للرصد والتحليلات).
 * [مُتحقَّق منطقياً بتتبع كامل] — سجل استدعاء AI الكامل.
 */
export interface AILogEntry {
  /** معرف فريد للسجل */
  id: string;
  /** نوع العملية */
  operationType: AIOperationType;
  /** النموذج المستخدم */
  model: string;
  /** معرف المستأجر */
  tenantId?: string;
  /** معرف المستخدم */
  userId?: string;
  /** معرف المحادثة (إذا كانت موجودة) */
  conversationId?: string;
  /** معرف المستند (إذا كان موجوداً) */
  documentId?: string;
  /** طول المطالبة (بالأحرف) */
  promptLength: number;
  /** طول الرد (بالأحرف) */
  responseLength: number;
  /** عدد الرموز المستخدمة */
  tokensUsed: number;
  /** المدة بالمللي ثانية */
  durationMs: number;
  /** ما إذا كان الاستدعاء ناجحاً */
  success: boolean;
  /** كود الخطأ (إذا فشل) */
  errorCode?: AICallErrorCode;
  /** رسالة الخطأ (إذا فشل) */
  errorMessage?: string;
  /** ما إذا تم استخدام الاحتياطي */
  usedFallback: boolean;
  /** معرّف الارتباط */
  correlationId: string;
  /** الطابع الزمني */
  timestamp: Date;
}

// ============================================================
// أنواع إعدادات الذكاء الاصطناعي الخاصة بالمستأجر
// ============================================================

/**
 * إعدادات الذكاء الاصطناعي الخاصة بالمستأجر.
 * [مُتحقَّق منطقياً بتتبع كامل] — إعدادات AI لكل مستأجر.
 */
export interface TenantAISettings {
  /** الحد الأقصى للرموز لكل طلب */
  maxTokensPerRequest: number;
  /** النماذج المسموح بها */
  allowedModels: string[];
  /** الحد الأقصى لعدد طلبات AI في الشهر */
  monthlyAILimit: number;
  /** عدد الطلبات المستخدمة في الشهر الحالي */
  monthlyUsage: number;
  /** ما إذا كان AI مفعلاً للمستأجر */
  enabled: boolean;
  /** استراتيجية الاحتياطي */
  fallbackStrategy: AIFallbackStrategy;
}

// ============================================================
// دوال مساعدة للتحقق من الأنواع (Type Guards)
// ============================================================

/**
 * التحقق من صحة نوع عملية الذكاء الاصطناعي.
 * [مُتحقَّق منطقياً بتتبع كامل] — دالة مساعدة للتحقق من النوع.
 */
export function isValidAIOperationType(type: string): type is AIOperationType {
  return ['chat', 'embedding', 'chunking'].includes(type);
}

/**
 * التحقق من صحة استراتيجية الاحتياطي.
 */
export function isValidAIFallbackStrategy(strategy: string): strategy is AIFallbackStrategy {
  return ['static', 'error', 'queue'].includes(strategy);
}

/**
 * التحقق من صحة كود خطأ الذكاء الاصطناعي.
 */
export function isValidAICallErrorCode(code: string): code is AICallErrorCode {
  return Object.values(AICallErrorCodes).includes(code as AICallErrorCode);
}

/**
 * التحقق من أن الاستجابة هي EmbeddingResponse صالحة.
 */
export function isEmbeddingResponse(data: unknown): data is EmbeddingResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    'embedding' in obj &&
    Array.isArray(obj.embedding) &&
    obj.embedding.every((v) => typeof v === 'number')
  );
}

/**
 * التحقق من أن الاستجابة هي ChatResponse صالحة.
 */
export function isChatResponse(data: unknown): data is ChatResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    'reply' in obj &&
    typeof obj.reply === 'string' &&
    obj.reply.length > 0
  );
}

/**
 * التحقق من أن الاستجابة هي ChunkingResponse صالحة.
 */
export function isChunkingResponse(data: unknown): data is ChunkingResponse {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    'chunks' in obj &&
    Array.isArray(obj.chunks) &&
    obj.chunks.every((v) => typeof v === 'string' && v.length > 0)
  );
}

// ============================================================
// تصدير الكائنات والدوال
// ============================================================

export default {
  // الثوابت
  AICallErrorCodes,
  // دوال التحقق
  isValidAIOperationType,
  isValidAIFallbackStrategy,
  isValidAICallErrorCode,
  isEmbeddingResponse,
  isChatResponse,
  isChunkingResponse,
};

