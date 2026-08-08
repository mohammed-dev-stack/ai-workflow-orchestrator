// ============================================================
// backend/src/config/index.ts
// ============================================================
// المصدر الوحيد (SSoT) لجميع إعدادات التطبيق.
// يجمع الإعدادات من env.schema.ts وملفات الإعدادات الأخرى (app.config.ts, ai.config.ts, db.config.ts)
// ويكشفها ككائن واحد متجانس.
// ============================================================

import { envConfig, EnvConfig, loadEnvConfig, envSchema } from './env.schema';
import { appConfig } from './app.config';
import { aiConfig } from './ai.config';
import { dbConfig } from './db.config';

/**
 * كائن الإعدادات المُجمَّع.
 * يدمج جميع الإعدادات من المصادر المختلفة مع الحفاظ على الفصل المنطقي.
 * يوفر خصائص ملائمة للاستخدام في التطبيق (مثل isProduction، isDevelopment).
 *
 * يتبع مبدأ الفشل السريع (Fail-Fast): في حال عدم وجود إعداد أساسي، تُرمى استثناءات فورية.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الإعدادات مُعرَّفة، والأنواع مستنتجة بدقة.
 */
export const config = {
  // ============================================================
  // البيئة العامة
  // ============================================================
  env: {
    nodeEnv: envConfig.NODE_ENV,
    isProduction: envConfig.NODE_ENV === 'production',
    isDevelopment: envConfig.NODE_ENV === 'development',
    isTest: envConfig.NODE_ENV === 'test',
  },

  // ============================================================
  // الخادم (من appConfig)
  // ============================================================
  server: {
    port: appConfig.server.port,
    host: appConfig.server.host,
    corsOrigin: appConfig.server.corsOrigin,
    requestTimeoutMs: appConfig.server.requestTimeoutMs,
  },

  // ============================================================
  // قاعدة البيانات (من dbConfig و envConfig)
  // ============================================================
  database: {
    url: dbConfig.postgres.url,
    poolTimeout: dbConfig.postgres.connectionTimeoutMs,
    pool: dbConfig.postgres.pool,
    transaction: dbConfig.postgres.transaction,
    vector: dbConfig.postgres.vector,
    indexes: dbConfig.postgres.indexes,
    health: dbConfig.postgres.health,
    migrations: dbConfig.postgres.migrations,
  },

  // ============================================================
  // Redis (من dbConfig)
  // ============================================================
  redis: {
    url: dbConfig.redis.url,
    connectionTimeoutMs: dbConfig.redis.connectionTimeoutMs,
    retry: dbConfig.redis.retry,
    queues: dbConfig.redis.queues,
    cache: dbConfig.redis.cache,
  },

  // ============================================================
  // JWT (من envConfig)
  // ============================================================
  jwt: {
    secret: envConfig.JWT_SECRET,
    expiry: envConfig.JWT_EXPIRY,
  },

  // ============================================================
  // Anthropic Claude (من aiConfig و envConfig)
  // ============================================================
  anthropic: {
    apiKey: aiConfig.anthropic.apiKey,
    model: aiConfig.anthropic.model,
    maxTokens: aiConfig.anthropic.maxTokens,
    temperature: aiConfig.anthropic.temperature,
    fallbackModel: aiConfig.anthropic.fallbackModel,
    maxPromptLength: aiConfig.anthropic.maxPromptLength,
    timeoutMs: aiConfig.anthropic.timeoutMs,
  },

  // ============================================================
  // قاطع الدائرة وإعادة المحاولة (من envConfig)
  // ============================================================
  circuitBreaker: {
    timeout: envConfig.CIRCUIT_BREAKER_TIMEOUT,
    errorThreshold: envConfig.CIRCUIT_BREAKER_ERROR_THRESHOLD,
    halfOpenWaitMs: aiConfig.circuitBreaker.halfOpenWaitMs,
  },
  retry: {
    maxAttempts: envConfig.RETRY_MAX_ATTEMPTS,
    backoffBase: envConfig.RETRY_BACKOFF_BASE,
    maxBackoffMs: aiConfig.retry.maxBackoffMs,
    retryableStatusCodes: aiConfig.retry.retryableStatusCodes,
  },

  // ============================================================
  // WhatsApp Cloud API (من envConfig)
  // ============================================================
  whatsapp: {
    apiToken: envConfig.WHATSAPP_API_TOKEN,
    verifyToken: envConfig.WHATSAPP_VERIFY_TOKEN,
    apiVersion: envConfig.WHATSAPP_API_VERSION,
    phoneNumberId: envConfig.WHATSAPP_PHONE_NUMBER_ID,
  },

  // ============================================================
  // قابلية المراقبة (Observability) — من envConfig
  // ============================================================
  observability: {
    otlpEndpoint: envConfig.OTEL_EXPORTER_OTLP_ENDPOINT,
    logLevel: envConfig.LOG_LEVEL,
  },

  // ============================================================
  // التكافؤ (Idempotency) — من envConfig
  // ============================================================
  idempotency: {
    ttlSeconds: envConfig.IDEMPOTENCY_TTL,
  },

  // ============================================================
  // تحديد المعدل (Rate Limiting) — من envConfig و appConfig
  // ============================================================
  rateLimit: {
    windowMs: appConfig.rateLimit.windowMs,
    maxRequests: appConfig.rateLimit.maxRequests,
    errorMessage: appConfig.rateLimit.errorMessage,
  },

  // ============================================================
  // الترقيم، الرفع، الأمان، قوائم الانتظار، التشفير — من appConfig
  // ============================================================
  pagination: appConfig.pagination,
  upload: appConfig.upload,
  security: appConfig.security,
  queues: appConfig.queues,
  encryption: appConfig.encryption,

  // ============================================================
  // إعدادات الذكاء الاصطناعي الإضافية — من aiConfig
  // ============================================================
  ai: {
    prompts: aiConfig.prompts,
    validation: aiConfig.validation,
    fallback: aiConfig.fallback,
    rateLimit: aiConfig.rateLimit,
  },

  // ============================================================
  // إعدادات التخزين المؤقت (من appConfig)
  // ============================================================
  cache: appConfig.cache,

  // ============================================================
  // المصادقة (من appConfig)
  // ============================================================
  auth: appConfig.auth,

  // ============================================================
  // التسجيل (من appConfig)
  // ============================================================
  logging: appConfig.logging,
} as const;

export type AppConfig = typeof config;

/**
 * إعادة تصدير الأنواع والمخططات للاستخدام في باقي التطبيق.
 * هذا يسمح للخدمات بالاعتماد على الأنواع المستنتجة دون الحاجة لاستيراد env.schema مباشرة.
 */
export type { EnvConfig };
export { loadEnvConfig, envSchema };

/**
 * دالة مساعدة للتحقق من وجود إعداد معين (للحالات المشروطة).
 * تطبق الفشل السريع: إذا كان الإعداد مفقوداً وغير اختياري، تُرمي خطأً مصنفاً.
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق بسيط ومباشر.
 */
export function requireConfig<T>(
  configValue: T | undefined,
  configName: string
): T {
  if (configValue === undefined || configValue === null) {
    throw new Error(
      `ConfigRequiredError: الإعداد المطلوب "${configName}" غير موجود. تأكد من تعيينه في البيئة.`
    );
  }
  return configValue;
}

/**
 * دالة مساعدة للتحقق من وجود إعداد اختياري مع قيمة افتراضية.
 * تطبق الأولويات: القيمة المقدمة > القيمة الافتراضية.
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق بسيط ومباشر.
 */
export function optionalConfig<T>(
  configValue: T | undefined,
  defaultValue: T
): T {
  return configValue !== undefined && configValue !== null
    ? configValue
    : defaultValue;
}

/**
 * تصدير الكائن المُجمَّع بالكامل كافتراضي لسهولة الاستيراد.
 */
export default config;

