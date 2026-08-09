// ============================================================
// backend/src/config/ai.config.ts
// ============================================================
// المصدر الوحيد (SSoT) لإعدادات الذكاء الاصطناعي (Anthropic Claude)
// يدمج جميع الإعدادات من متغيرات البيئة مع قيم افتراضية آمنة ومنطقية.
// ✅ تم إصلاح جميع الأخطاء النوعية:
//    - إزالة الاعتماد على AI_MODE (غير موجود في EnvConfig)
//    - تحديد الوضع (mock/real) تلقائياً بناءً على NODE_ENV ومفتاح API
//    - تثبيت الأنواع الحرفية باستخدام 'as const'
//    - إضافة getSafeAIConfig للاستخدام الآمن في التسجيل
// ============================================================

import { envConfig, EnvConfig } from './env.schema';

// ============================================================
// 1. الأنواع (Types)
// ============================================================

/**
 * إعدادات الذكاء الاصطناعي – الهيكل الكامل.
 * كل الخصائص للقراءة فقط (readonly) لضمان عدم تعديلها أثناء التشغيل.
 */
export interface AIConfig {
  /** إعدادات عميل Anthropic الأساسية */
  readonly anthropic: {
    /** مفتاح API (يُقرأ من البيئة) */
    readonly apiKey: string;
    /** النموذج الأساسي المستخدم */
    readonly model: string;
    /** النموذج الاحتياطي (في حال فشل النموذج الأساسي) */
    readonly fallbackModel: string;
    /** الحد الأقصى لعدد الرموز (tokens) في الرد */
    readonly maxTokens: number;
    /** درجة العشوائية (temperature) – تتحكم في إبداع الردود */
    readonly temperature: number;
    /** مهلة الطلب بالمللي ثانية */
    readonly timeoutMs: number;
    /** الحد الأقصى لطول النص المُرسَل إلى API (بالأحرف) */
    readonly maxPromptLength: number;
  };

  /** وضع التشغيل: mock (محاكاة مجانية) أو real (API حقيقي) */
  readonly mode: 'mock' | 'real';

  /** إعدادات قاطع الدائرة المخصصة للذكاء الاصطناعي */
  readonly circuitBreaker: {
    readonly timeoutMs: number;
    readonly errorThreshold: number;
    readonly halfOpenWaitMs: number;
  };

  /** إعدادات إعادة المحاولة (Retry) – تراجع أسي مع تشويش */
  readonly retry: {
    readonly maxAttempts: number;
    readonly backoffBaseMs: number;
    readonly maxBackoffMs: number;
    readonly retryableStatusCodes: readonly number[];
  };

  /** إعدادات المطالبات (Prompts) */
  readonly prompts: {
    readonly versions: {
      readonly embedding: {
        readonly id: string;
        readonly version: string;
        readonly maxInputLength: number;
      };
      readonly chat: {
        readonly id: string;
        readonly version: string;
        readonly maxInputLength: number;
        readonly maxContextChunks: number;
      };
    };
    readonly storagePath: string;
  };

  /** إعدادات التحقق من المخرجات (Output Validation) */
  readonly validation: {
    readonly enforceStrictValidation: boolean;
    readonly onValidationFailure: 'retry' | 'fallback' | 'throw';
    readonly maxRetriesOnValidationFailure: number;
  };

  /** استراتيجية الاحتياطي (Fallback) عند فشل جميع محاولات AI */
  readonly fallback: {
    readonly strategy: 'static' | 'error' | 'queue';
    readonly staticResponse: {
      readonly ar: string;
      readonly en: string;
    };
  };

  /** إعدادات تحديد المعدل (Rate Limiting) للذكاء الاصطناعي */
  readonly rateLimit: {
    readonly maxRequestsPerTenant: number;
    readonly windowMs: number;
    readonly maxRequestsPerUser: number;
  };

  /** تأخير المحاكاة (mock) بالمللي ثانية – يُستخدم فقط في وضع mock */
  readonly mockDelay: number;
}

// ============================================================
// 2. بناء كائن الإعدادات (بناءً على envConfig)
// ============================================================

/**
 * بناء كائن الإعدادات من متغيرات البيئة.
 * تطبق الفشل السريع: في حال عدم وجود مفتاح API أساسي، تُرمى استثناءً.
 */
export function buildAIConfig(env: EnvConfig = envConfig): Readonly<AIConfig> {
  // التحقق من وجود مفتاح API (في وضع real فقط)
  if (env.NODE_ENV === 'production' && !env.ANTHROPIC_API_KEY) {
    throw new Error('❌ ANTHROPIC_API_KEY مطلوب في بيئة الإنتاج');
  }

  // تحديد الوضع تلقائياً:
  // - في بيئة الإنتاج ومع وجود مفتاح API → real
  // - في بيئة التطوير أو عدم وجود مفتاح → mock
  const hasValidApiKey = !!(env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.startsWith('sk-'));
  const mode: 'mock' | 'real' = (env.NODE_ENV === 'production' && hasValidApiKey) ? 'real' : 'mock';

  // القيم الافتراضية
  const DEFAULT_MODEL = 'claude-3-sonnet-20241022';
  const DEFAULT_MAX_TOKENS = 4096;
  const DEFAULT_TEMPERATURE = 0.3;
  const DEFAULT_TIMEOUT_MS = 30000;
  const DEFAULT_MAX_PROMPT_LENGTH = 100000;
  const DEFAULT_RETRYABLE_STATUS = [429, 500, 502, 503, 504] as const;

  return Object.freeze({
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      fallbackModel: env.ANTHROPIC_FALLBACK_MODEL || 'claude-3-haiku-20240307',
      maxTokens: env.ANTHROPIC_MAX_TOKENS || DEFAULT_MAX_TOKENS,
      temperature: env.ANTHROPIC_TEMPERATURE || DEFAULT_TEMPERATURE,
      timeoutMs: env.CIRCUIT_BREAKER_TIMEOUT || DEFAULT_TIMEOUT_MS,
      maxPromptLength: DEFAULT_MAX_PROMPT_LENGTH,
    },
    mode,
    circuitBreaker: {
      timeoutMs: env.CIRCUIT_BREAKER_TIMEOUT || DEFAULT_TIMEOUT_MS,
      errorThreshold: env.CIRCUIT_BREAKER_ERROR_THRESHOLD || 5,
      halfOpenWaitMs: 60000,
    },
    retry: {
      maxAttempts: env.RETRY_MAX_ATTEMPTS || 3,
      backoffBaseMs: env.RETRY_BACKOFF_BASE || 1000,
      maxBackoffMs: 30000,
      retryableStatusCodes: DEFAULT_RETRYABLE_STATUS,
    },
    prompts: {
      versions: {
        embedding: {
          id: 'embed-v1',
          version: '1.0.0',
          maxInputLength: 50000,
        },
        chat: {
          id: 'chat-v1',
          version: '1.0.0',
          maxInputLength: 80000,
          maxContextChunks: 20,
        },
      },
      storagePath: 'src/ai/prompts',
    },
    validation: {
      enforceStrictValidation: true,
      onValidationFailure: 'retry' as const,
      maxRetriesOnValidationFailure: 2,
    },
    fallback: {
      strategy: 'static' as const,
      staticResponse: {
        ar: 'عذراً، خدمة الذكاء الاصطناعي غير متاحة حالياً. يرجى المحاولة مرة أخرى لاحقاً. إذا كانت المشكلة مستمرة، تواصل مع الدعم الفني.',
        en: 'Sorry, the AI service is currently unavailable. Please try again later. If the issue persists, contact technical support.',
      },
    },
    rateLimit: {
      maxRequestsPerTenant: 50,
      windowMs: 60000,
      maxRequestsPerUser: 10,
    },
    mockDelay: 500,
  });
}

// ============================================================
// 3. التصدير النهائي (مرة واحدة فقط)
// ============================================================

/**
 * كائن الإعدادات النهائي – يُستهلك في باقي التطبيق.
 * مصدر واحد للحقيقة (SSoT) لإعدادات الذكاء الاصطناعي.
 */
export const aiConfig: Readonly<AIConfig> = buildAIConfig();

/**
 * إسقاط آمن للإعدادات (للتسجيل والعرض).
 * لا تُطبع aiConfig مباشرة أبداً في أي لوغ.
 */
export function getSafeAIConfig(): Record<string, unknown> {
  return {
    mode: aiConfig.mode,
    anthropic: {
      model: aiConfig.anthropic.model,
      fallbackModel: aiConfig.anthropic.fallbackModel,
      maxTokens: aiConfig.anthropic.maxTokens,
      temperature: aiConfig.anthropic.temperature,
      timeoutMs: aiConfig.anthropic.timeoutMs,
      maxPromptLength: aiConfig.anthropic.maxPromptLength,
      // apiKey محذوف عمداً
    },
    circuitBreaker: { ...aiConfig.circuitBreaker },
    retry: { ...aiConfig.retry },
    rateLimit: { ...aiConfig.rateLimit },
  };
}

/**
 * تصدير افتراضي لسهولة الاستيراد.
 */
export default aiConfig;