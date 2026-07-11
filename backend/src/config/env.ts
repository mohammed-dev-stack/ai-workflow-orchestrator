/**
 * config/env.ts
 *
 * الملف الوحيد المسموح له بقراءة process.env مباشرة. كل ملف آخر يستورد
 * `env` من هنا فقط.
 *
 * ملاحظة تصحيح: النسخة السابقة كانت تحتوي دالة `validateEnv()` إضافية
 * بتعليق "Health Check". حُذفت هنا عمدًا لأنها كانت بلا وظيفة حقيقية:
 * كل ما تفعله هو استدعاء loadEnv() مرة ثانية وتجاهل ناتجها بالكامل —
 * لا شيء يستهلكها في أي مكان، ولا هي تفحص أي حالة قابلة للتغيير أثناء
 * التشغيل (process.env لا يتغيّر من تلقاء نفسه بعد الإقلاع في هذا
 * التصميم أصلاً، بما أن env مجمّد Object.freeze منذ اللحظة الأولى).
 * دالة بلا مستدعٍ وبلا أثر فعلي هي كود ميت، بغض النظر عن جودة اسمها.
 */
 
import dotenv from 'dotenv';
import { envSchema, Env } from './schema';
 
dotenv.config();
 
function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
 
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
 
    throw new Error(
      `Invalid environment configuration. The process will not start.\n${details}`
    );
  }
 
  return Object.freeze(result.data);
}
 
export const env: Readonly<Env> = loadEnv();
 
/**
 * مخرج مخصص للاختبارات فقط. الكود الإنتاجي لا يستدعيه أبدًا.
 */
export function buildEnvForTest(overrides: Partial<Env> = {}): Env {
  return Object.freeze({
    ...envSchema.parse({ ...process.env, ...overrides }),
  });
}
 
export type { Env };