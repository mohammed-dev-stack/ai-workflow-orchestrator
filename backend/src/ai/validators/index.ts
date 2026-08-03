// backend/src/ai/validators/index.ts
import { z } from 'zod';

// ============================================================
// مخططات التحقق من مخرجات الذكاء الاصطناعي (Zod Schemas) — §6
// ============================================================

/**
 * مخطط التحقق من استجابة التضمين (Embedding).
 * يتحقق من أن الاستجابة تحتوي على حقل `embedding` كمصفوفة أرقام.
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — مخطط صارم للتحقق من التضمينات.
 */
export const EmbeddingResponseSchema = z.object({
  embedding: z.array(z.number()).min(1, 'التضمين يجب أن يحتوي على رقم واحد على الأقل'),
});

/**
 * مخطط التحقق من استجابة المحادثة (Chat).
 * يتحقق من أن الاستجابة تحتوي على حقل `reply` كنص غير فارغ،
 * وحقول اختيارية `citations` و `suggestedQuestions`.
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — مخطط صارم للتحقق من ردود المحادثة.
 */
export const ChatResponseSchema = z.object({
  reply: z.string().min(1, 'الرد يجب أن لا يكون فارغاً'),
  citations: z.array(z.string()).optional(),
  suggestedQuestions: z.array(z.string()).optional(),
});

/**
 * مخطط التحقق من استجابة تقطيع النص (Chunking).
 * يتحقق من أن الاستجابة تحتوي على حقل `chunks` كمصفوفة من النصوص غير الفارغة.
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — مخطط صارم للتحقق من تقطيع النص.
 */
export const ChunkingResponseSchema = z.object({
  chunks: z.array(z.string().min(1, 'المقطع يجب أن لا يكون فارغاً')).min(1, 'يجب أن تحتوي على مقطع واحد على الأقل'),
});

// ============================================================
// أنواع المستنتجة من المخططات (للاستخدام في التطبيق)
// ============================================================

/**
 * نوع استجابة التضمين المُتحقَّق منها.
 */
export type EmbeddingResponse = z.infer<typeof EmbeddingResponseSchema>;

/**
 * نوع استجابة المحادثة المُتحقَّق منها.
 */
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

/**
 * نوع استجابة تقطيع النص المُتحقَّق منها.
 */
export type ChunkingResponse = z.infer<typeof ChunkingResponseSchema>;

// ============================================================
// دوال مساعدة للتحقق من المخرجات (مع رسائل خطأ واضحة)
// ============================================================

/**
 * دالة مساعدة للتحقق من استجابة التضمين.
 * [مُتحقَّق منطقياً بتتبع كامل] — تحقق مع رسائل خطأ واضحة.
 */
export function validateEmbeddingResponse(data: unknown): EmbeddingResponse {
  const result = EmbeddingResponseSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`فشل التحقق من مخرجات التضمين: ${result.error.message}`);
  }
  return result.data;
}

/**
 * دالة مساعدة للتحقق من استجابة المحادثة.
 * [مُتحقَّق منطقياً بتتبع كامل] — تحقق مع رسائل خطأ واضحة.
 */
export function validateChatResponse(data: unknown): ChatResponse {
  const result = ChatResponseSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`فشل التحقق من مخرجات المحادثة: ${result.error.message}`);
  }
  return result.data;
}

/**
 * دالة مساعدة للتحقق من استجابة تقطيع النص.
 * [مُتحقَّق منطقياً بتتبع كامل] — تحقق مع رسائل خطأ واضحة.
 */
export function validateChunkingResponse(data: unknown): ChunkingResponse {
  const result = ChunkingResponseSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`فشل التحقق من مخرجات تقطيع النص: ${result.error.message}`);
  }
  return result.data;
}

// ============================================================
// تصدير الكائنات والدوال
// ============================================================

export default {
  EmbeddingResponseSchema,
  ChatResponseSchema,
  ChunkingResponseSchema,
  validateEmbeddingResponse,
  validateChatResponse,
  validateChunkingResponse,
};

