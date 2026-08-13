// ============================================================
// backend/src/config/index.ts
// ============================================================
// المصدر الوحيد (SSoT) لجميع إعدادات التطبيق.
// ============================================================

// ============================================================
// 1. المصدر الأساسي: متغيرات البيئة
// ============================================================
export { envConfig, envSchema, loadEnvConfig } from './env.schema.js';
export type { EnvConfig } from './env.schema.js';
// ملاحظة: لا يوجد تصدير "env" في env.schema.js، لذلك تم حذف السطر export { env }.

// ============================================================
// 2. إعدادات التطبيق والذكاء الاصطناعي وقاعدة البيانات
// ============================================================
export { appConfig } from './app.config.js';
// تم حذف export type { AppConfig } من app.config.js لتجنب التعارض مع النوع المحلي.

export { aiConfig } from './ai.config.js';
export type { AIConfig } from './ai.config.js';

export { dbConfig } from './db.config.js';
export type { DBConfig } from './db.config.js';

// ============================================================
// 3. دوال Redis
// ============================================================
export {
  initializeRedis,
  getRedisClient,
  disconnectRedis,
  redisHealthCheck,
} from './redis.config.js';

// ============================================================
// 4. كائن الإعدادات المُجمَّع
// ============================================================
import { envConfig } from './env.schema.js';
import { appConfig } from './app.config.js';
import { aiConfig } from './ai.config.js';
import { dbConfig } from './db.config.js';

export const config = {
  env: {
    nodeEnv: envConfig.NODE_ENV,
    isProduction: envConfig.NODE_ENV === 'production',
    isDevelopment: envConfig.NODE_ENV === 'development',
    isTest: envConfig.NODE_ENV === 'test',
  },
  server: {
    port: appConfig.server.port,
    host: appConfig.server.host,
    corsOrigin: appConfig.server.corsOrigin,
    requestTimeoutMs: appConfig.server.requestTimeoutMs,
  },
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
  redis: {
    url: envConfig.REDIS_URL,
    retryDelay: envConfig.REDIS_RETRY_DELAY,
  },
  jwt: {
    secret: envConfig.JWT_SECRET,
    expiry: envConfig.JWT_EXPIRY,
  },
  anthropic: {
    apiKey: aiConfig.anthropic.apiKey,
    model: aiConfig.anthropic.model,
    maxTokens: aiConfig.anthropic.maxTokens,
    temperature: aiConfig.anthropic.temperature,
    fallbackModel: aiConfig.anthropic.fallbackModel,
    maxPromptLength: aiConfig.anthropic.maxPromptLength,
    timeoutMs: aiConfig.anthropic.timeoutMs,
  },
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
  whatsapp: {
    apiToken: envConfig.WHATSAPP_API_TOKEN,
    verifyToken: envConfig.WHATSAPP_VERIFY_TOKEN,
    apiVersion: envConfig.WHATSAPP_API_VERSION,
    phoneNumberId: envConfig.WHATSAPP_PHONE_NUMBER_ID,
  },
  observability: {
    otlpEndpoint: envConfig.OTEL_EXPORTER_OTLP_ENDPOINT,
    logLevel: envConfig.LOG_LEVEL,
  },
  idempotency: {
    ttlSeconds: envConfig.IDEMPOTENCY_TTL,
  },
  rateLimit: {
    windowMs: appConfig.rateLimit.windowMs,
    maxRequests: appConfig.rateLimit.maxRequests,
    errorMessage: appConfig.rateLimit.errorMessage,
  },
  pagination: appConfig.pagination,
  upload: appConfig.upload,
  security: appConfig.security,
  queues: appConfig.queues,
  encryption: appConfig.encryption,
  ai: {
    prompts: aiConfig.prompts,
    validation: aiConfig.validation,
    fallback: aiConfig.fallback,
    rateLimit: aiConfig.rateLimit,
  },
  cache: appConfig.cache,
  auth: appConfig.auth,
  logging: appConfig.logging,
} as const;

/**
 * النوع الرئيسي للإعدادات المُجمَّعة.
 * هذا هو النوع الذي يجب استخدامه في بقية التطبيق.
 */
export type AppConfig = typeof config;

/**
 * دوال مساعدة للتحقق من الإعدادات.
 */
export function requireConfig<T>(configValue: T | undefined, configName: string): T {
  if (configValue === undefined || configValue === null) {
    throw new Error(`ConfigRequiredError: الإعداد "${configName}" غير موجود.`);
  }
  return configValue;
}

export function optionalConfig<T>(configValue: T | undefined, defaultValue: T): T {
  return configValue !== undefined && configValue !== null ? configValue : defaultValue;
}

export default config;