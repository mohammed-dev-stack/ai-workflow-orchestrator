/**
 * config/index.ts
 *
 * نقطة الدخول العامة الوحيدة لطبقة الإعدادات. بقية التطبيق يستورد من هنا
 * فقط، لا من الملفات الداخلية مباشرة.
 *
 * ثلاث تصحيحات عن نسخة سابقة من هذا الملف:
 *
 * 1) فصل تصدير الأنواع عن تصدير القيم (export type منفصل). النسخة
 *    السابقة كانت تصدّر Env, AIConfig, HealthCheckResult كقيم عادية رغم
 *    أنها أنواع فقط — وهذا فشل فعليًا عند التصريف (compile) تحت إعداد
 *    isolatedModules، وهو إعداد افتراضي أو مُوصى به في أغلب أدوات البناء
 *    الحديثة (Next.js, Vite, esbuild, swc). تم التحقق من هذا الخطأ عمليًا
 *    عبر tsc قبل هذا الإصلاح.
 *
 * 2) إزالة التصدير الافتراضي (default export) الذي كان يوفّر طريقة ثانية
 *    للوصول لنفس الدوال بجانب التصدير المُسمّى. وجود طريقتين متزامنتين
 *    يناقض مباشرة الهدف المُعلن في نفس الملف ("نمط واحد للوصول")، وهو
 *    بالضبط نوع الفجوة بين ما يقوله التعليق وما يفعله الكود.
 *
 * 3) إزالة تصدير envSchema من هذه الواجهة العامة. هذا الملف مخصص لبقية
 *    التطبيق (application layer)، لا لملفات الاختبار — ملفات الاختبار
 *    يمكنها استيراد envSchema مباشرة من './schema' عند الحاجة الفعلية،
 *    دون أن يُعرَّض هذا التفصيل الداخلي لكل مستهلك عادي للواجهة.
 */
 
export { env, buildEnvForTest } from './env';
export type { Env } from './schema';
 
export { aiConfig, buildAIConfig, getSafeAIConfig } from './ai.config';
export type { AIConfig } from './ai.config';
 
export {
  connectDB,
  disconnectDB,
  isDBConnected,
  dbHealthCheck,
} from './database.config';
 
export {
  initializeRedis,
  getRedisClient,
  disconnectRedis,
  redisHealthCheck,
} from './redis.config';
 
// تعريف واحد مشترك، يُستخدم من كل من Mongo وRedis health checks.
export type { HealthCheckResult } from './types';