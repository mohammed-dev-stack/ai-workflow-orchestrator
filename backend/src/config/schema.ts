/**
 * config/schema.ts
 *
 * المرجعية الهندسية المركزية. هذا الملف هو حارس بوابة التحقق
 * (Validation Gatekeeper) الذي يضمن استقرار النظام قبل بدء أي تنفيذ
 * لمنطق الأعمال.
 */
// 1. fail fast
// 2. signal source of truth 
// 3. type safety 
// 4. config precedence

import { z } from 'zod';
 
export const envSchema = z
  .object({
    // NODE_ENV: يقيّد القيمة المسموحة لأربع بيئات معروفة فقط (وليس أي نص).
    NODE_ENV: z
      .enum(['development', 'staging', 'production', 'test'])
      .default('development'),
 
    // -----------------------------------------------------------------
    // AI Service
    // -----------------------------------------------------------------
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    AI_MODEL: z.string().min(1).default('claude-3-5-sonnet-20241022'),
    AI_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
    AI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.3),
    AI_MODE: z.enum(['mock', 'real']).default('mock'),
    AI_MOCK_DELAY: z.coerce.number().int().nonnegative().default(500),
 
    // -----------------------------------------------------------------
    // MongoDB
    // -----------------------------------------------------------------
    // فحص شكل الرابط فقط (بادئة mongodb:// أو mongodb+srv://) — هذا تحقق
    // من الصيغة (format)، وليس ضمانًا لأمان الاتصال أو صحة بيانات الاعتماد.
    MONGO_URI: z
      .string()
      .min(1, 'MONGO_URI is required')
      .refine(
        (v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'),
        'MONGO_URI must start with mongodb:// or mongodb+srv://'
      ),
    MONGO_MAX_POOL_SIZE: z.coerce.number().int().positive().default(10),
    MONGO_MIN_POOL_SIZE: z.coerce.number().int().nonnegative().default(2),
    MONGO_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
    MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5000),
    MONGO_CONNECT_RETRIES: z.coerce.number().int().nonnegative().default(5),
    MONGO_CONNECT_RETRY_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(2000),
 
    // -----------------------------------------------------------------
    // Redis
    // -----------------------------------------------------------------
    REDIS_HOST: z.string().min(1).default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional(),
 
    // z.coerce.boolean() ينفّذ Boolean(value) داخليًا، وأي نص غير فارغ
    // (بما فيه السلسلة "false" نفسها) يُعتبر truthy في جافاسكريبت. الحل:
    // تقييد المدخل صراحة لسلسلتين فقط ثم تحويلهما يدويًا.
    REDIS_TLS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
 
    REDIS_MAX_RETRIES_PER_REQUEST: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(3),
    REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  })
  .refine((data) => data.AI_MODE !== 'real' || !!data.ANTHROPIC_API_KEY, {
    message: 'ANTHROPIC_API_KEY is required when AI_MODE=real',
    path: ['ANTHROPIC_API_KEY'],
  });
 
export type Env = z.infer<typeof envSchema>;