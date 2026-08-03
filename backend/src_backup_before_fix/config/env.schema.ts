// ============================================================
// backend/src/config/env.schema.ts
// ============================================================
// مخطط التحقق من متغيرات البيئة (Zod Schema) — SSoT صارم وآمن.
// تم إصلاح CORS_ORIGIN لقبول '*' أو عنوان URL صحيح.
// ============================================================

import { z } from 'zod';
import dotenv from 'dotenv';
import { resolve } from 'path';

/**
 * تحميل متغيرات البيئة من ملف .env في جذر المشروع.
 * الأولوية: متغيرات البيئة الفعلية > ملف .env > القيم الافتراضية.
 */
dotenv.config({ path: resolve(process.cwd(), '.env') });

/**
 * مخطط Zod لكل متغير بيئة — SSoT صارم.
 * الفشل السريع: أي متغير مفقود أو غير صالح يؤدي إلى رمي خطأ مصنف عند التحميل.
 */
const envSchema = z.object({
  // ============================================================
  // 1. البيئة العامة
  // ============================================================
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  /**
   * CORS_ORIGIN — يقبل '*' (للتطوير) أو عنوان URL صحيح (للإنتاج).
   * تم إصلاحه باستخدام union لضمان التوافق مع '*' وعدم كسر التطوير.
   */
  CORS_ORIGIN: z.union([z.literal('*'), z.string().url()]).default('*'),

  // ============================================================
  // 2. قاعدة البيانات (PostgreSQL + pgvector)
  // ============================================================
  DATABASE_URL: z.string().url().min(1, 'DATABASE_URL مطلوبة'),
  DATABASE_POOL_TIMEOUT: z.coerce.number().int().positive().default(10000),

  // ============================================================
  // 3. Redis (BullMQ)
  // ============================================================
  REDIS_URL: z.string().url().min(1, 'REDIS_URL مطلوبة'),
  REDIS_RETRY_DELAY: z.coerce.number().int().positive().default(1000),

  // ============================================================
  // 4. JWT (المصادقة)
  // ============================================================
  JWT_SECRET: z.string().min(32, 'JWT_SECRET يجب أن يكون 32 حرفاً على الأقل'),
  JWT_EXPIRY: z.string().default('7d'),

  // ============================================================
  // 5. Anthropic Claude (الذكاء الاصطناعي) — §6
  // ============================================================
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY مطلوبة'),
  ANTHROPIC_MODEL: z.string().default('claude-3-sonnet-20241022'),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
  ANTHROPIC_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.3),
  ANTHROPIC_FALLBACK_MODEL: z.string().default('claude-3-haiku-20240307'),

  // ============================================================
  // 6. قاطع الدائرة وإعادة المحاولة — §4
  // ============================================================
  CIRCUIT_BREAKER_TIMEOUT: z.coerce.number().int().positive().default(30000),
  CIRCUIT_BREAKER_ERROR_THRESHOLD: z.coerce.number().int().positive().default(5),
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  RETRY_BACKOFF_BASE: z.coerce.number().int().positive().default(1000),

  // ============================================================
  // 7. WhatsApp Cloud API — §7
  // ============================================================
  WHATSAPP_API_TOKEN: z.string().min(1, 'WHATSAPP_API_TOKEN مطلوبة'),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, 'WHATSAPP_VERIFY_TOKEN مطلوبة'),
  WHATSAPP_API_VERSION: z.string().default('v18.0'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  // ============================================================
  // 8. قابلية المراقبة (Observability) — §5
  // ============================================================
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // ============================================================
  // 9. التكافؤ (Idempotency) — §4
  // ============================================================
  IDEMPOTENCY_TTL: z.coerce.number().int().positive().default(86400), // 24 ساعة

  // ============================================================
  // 10. حدود المعدل (Rate Limiting) — §7
  // ============================================================
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000), // دقيقة واحدة
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  // ============================================================
  // 11. التشفير (Encryption) — اختياري
  // ============================================================
  ENCRYPTION_KEY: z.string().optional(),
});

/**
 * استنتاج النوع من المخطط لاستخدامه في باقي التطبيق.
 * يضمن سلامة النوع 100% ولا وجود لـ `any`.
 */
export type EnvConfig = z.infer<typeof envSchema>;

/**
 * المصدر الوحيد (SSoT) للإعدادات المدققة.
 * يتم استدعاؤها عند بدء التشغيل — تفشل بسرعة (ترمي خطأً مصنفاً) إذا كان أي متغير غير صالح.
 */
export function loadEnvConfig(): EnvConfig {
  try {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
      const issues = result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`
      );
      throw new Error(`❌ فشل التحقق من متغيرات البيئة:\n${issues.join('\n')}`);
    }

    return result.data;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`EnvConfigLoadError: ${error.message}`);
    }
    throw new Error('EnvConfigLoadError: فشل غير متوقع في تحميل الإعدادات');
  }
}

/**
 * كائن الإعدادات المُحمَّل مُسبقاً (يُستهلك في config/index.ts).
 * يتم تحميله مرة واحدة عند بدء التشغيل — لا يُعاد تحميله ديناميكياً.
 */
export const envConfig = loadEnvConfig();

/**
 * تصدير المخطط نفسه للاستخدام في الاختبارات أو التحقق الديناميكي.
 */
export { envSchema };

/**
 * تصدير الإعدادات كافتراضي لسهولة الاستيراد.
 */
export default envConfig;
