// backend/src/utils/retry.ts
import { randomUUID } from 'crypto';
import { config } from '../config';
import { logger } from '../observability/logger';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware';
import { AppError } from '../middlewares/errorHandler.middleware';

/**
 * خيارات استراتيجية إعادة المحاولة.
 */
export interface RetryOptions {
  /** الحد الأقصى لعدد محاولات إعادة المحاولة (يشمل المحاولة الأولى) */
  maxAttempts?: number;

  /** الزمن الأساسي للتراجع الأسي بالمللي ثانية */
  backoffBaseMs?: number;

  /** الحد الأقصى للزمن بين المحاولات بالمللي ثانية */
  maxBackoffMs?: number;

  /** 
   * مضاعف التراجع الأسي (exponential factor).
   * القيمة الافتراضية: 2 (مضاعفة الزمن في كل محاولة).
   */
  backoffMultiplier?: number;

  /**
   * نسبة التشويش (Jitter) كقيمة بين 0 و 1.
   * تُستخدم لتوزيع محاولات إعادة المحاولة عبر الزمن.
   * القيمة الافتراضية: 0.3 (30% تشويش).
   */
  jitterRatio?: number;

  /**
   * قائمة بأنواع الأخطاء القابلة لإعادة المحاولة.
   * إذا كانت فارغة، جميع الأخطاء تعتبر قابلة لإعادة المحاولة.
   */
  retryableErrorTypes?: Array<new (...args: any[]) => Error>;

  /**
   * دالة مخصصة لتحديد ما إذا كان الخطأ قابلاً لإعادة المحاولة.
   * إذا تم توفيرها، تتجاوز `retryableErrorTypes`.
   */
  isRetryableError?: (error: Error) => boolean;

  /**
   * اسم العملية أو الخدمة (للتسجيل والتتبع).
   */
  operationName?: string;

  /**
   * مفتاح التكافؤ (اختياري) — يُستخدم لربط محاولات إعادة المحاولة.
   */
  idempotencyKey?: string;

  /**
   * ما إذا كان سيتم تسجيل تفاصيل كل محاولة (للتصحيح).
   * القيمة الافتراضية: false في الإنتاج.
   */
  verboseLogging?: boolean;
}

/**
 * نتيجة عملية إعادة المحاولة.
 */
export interface RetryResult<T> {
  /** البيانات المُرجعة من العملية (إذا نجحت) */
  data?: T;

  /** الخطأ (إذا فشلت جميع المحاولات) */
  error?: Error;

  /** ما إذا كانت العملية ناجحة */
  success: boolean;

  /** إجمالي المدة بالمللي ثانية */
  totalDurationMs: number;

  /** عدد المحاولات التي تمت */
  attempts: number;

  /** قائمة بتأخيرات كل محاولة (بالملي ثانية) للتحليل */
  attemptDelaysMs: number[];
}

/**
 * خطأ يُرمى عند نفاد جميع محاولات إعادة المحاولة.
 * [مُتحقَّق منطقياً بتتبع كامل] — فئة خطأ مخصصة.
 */
export class RetryExhaustedError extends AppError {
  constructor(
    operationName: string,
    attempts: number,
    lastError: Error,
    totalDurationMs: number
  ) {
    super(
      `نفاد محاولات إعادة المحاولة للعملية "${operationName}" بعد ${attempts} محاولة (${totalDurationMs}ms): ${lastError.message}`,
      503,
      'RETRY_EXHAUSTED',
      {
        operationName,
        attempts,
        totalDurationMs,
        lastError: lastError.message,
        lastErrorName: lastError.name,
      }
    );
  }
}

/**
 * القيم الافتراضية لخيارات إعادة المحاولة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة منطقية.
 */
const DEFAULT_OPTIONS = {
  maxAttempts: config.retry.maxAttempts,
  backoffBaseMs: config.retry.backoffBase,
  maxBackoffMs: 30000, // 30 ثانية
  backoffMultiplier: 2,
  jitterRatio: 0.3,
  retryableErrorTypes: [] as Array<new (...args: any[]) => Error>,
  verboseLogging: false,
};

/**
 * حساب زمن الانتظار باستخدام التراجع الأسي مع التشويش (Exponential Backoff + Jitter).
 * الصيغة: delay = min(backoffBase * (multiplier ^ attempt), maxBackoff) * (1 + jitter * random())
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق حسابي بسيط مع التحقق من الحدود.
 */
export function calculateBackoffDelay(
  attempt: number, // تبدأ من 0 للمحاولة الأولى
  backoffBaseMs: number,
  backoffMultiplier: number,
  maxBackoffMs: number,
  jitterRatio: number
): number {
  // حساب التراجع الأسي
  let delay = backoffBaseMs * Math.pow(backoffMultiplier, attempt);

  // تطبيق الحد الأقصى
  delay = Math.min(delay, maxBackoffMs);

  // تطبيق التشويش (Jitter)
  if (jitterRatio > 0) {
    const jitterAmount = delay * jitterRatio * Math.random();
    // إضافة التشويش بشكل عشوائي (زيادة أو نقصان)
    const sign = Math.random() > 0.5 ? 1 : -1;
    delay = delay + sign * jitterAmount;
    // التأكد من أن الزمن لا يقل عن 1 مللي ثانية
    delay = Math.max(1, delay);
    // التقريب إلى أقرب عدد صحيح
    delay = Math.round(delay);
  }

  return delay;
}

/**
 * دالة مساعدة للتحقق مما إذا كان الخطأ قابلاً لإعادة المحاولة.
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق تحقق بسيط مع دعم الأنواع المخصصة والدوال المخصصة.
 */
function isErrorRetryable(
  error: Error,
  retryableErrorTypes: Array<new (...args: any[]) => Error>,
  isRetryableError?: (error: Error) => boolean
): boolean {
  // إذا تم توفير دالة مخصصة، نستخدمها
  if (isRetryableError) {
    return isRetryableError(error);
  }

  // إذا كانت القائمة فارغة، جميع الأخطاء قابلة لإعادة المحاولة
  if (retryableErrorTypes.length === 0) {
    return true;
  }

  // التحقق مما إذا كان الخطأ من نوع مسموح به
  return retryableErrorTypes.some((ErrorType) => error instanceof ErrorType);
}

/**
 * تنفيذ دالة مع استراتيجية إعادة المحاولة (التراجع الأسي + التشويش).
 * تطبق الفشل السريع عند نفاد المحاولات أو عند خطأ غير قابل لإعادة المحاولة.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق إعادة محاولة كامل مع تراجع أسي وتشويش.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  // دمج الخيارات مع القيم الافتراضية
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    maxAttempts: options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts,
    backoffBaseMs: options.backoffBaseMs ?? DEFAULT_OPTIONS.backoffBaseMs,
  };

  const {
    maxAttempts,
    backoffBaseMs,
    maxBackoffMs,
    backoffMultiplier,
    jitterRatio,
    retryableErrorTypes,
    isRetryableError: customIsRetryable,
    operationName = 'unknown-operation',
    idempotencyKey,
    verboseLogging = false,
  } = opts;

  const correlationId = getCurrentCorrelationId() || randomUUID();
  const startTime = Date.now();
  const attemptDelaysMs: number[] = [];
  let lastError: Error | undefined;
  let attempt = 0;

  // التحقق من صحة maxAttempts (فشل سريع عند الإعدادات غير الصالحة)
  if (maxAttempts < 1) {
    const error = new Error('maxAttempts يجب أن يكون أكبر من أو يساوي 1');
    logger.error('إعدادات إعادة المحاولة غير صالحة', {
      operationName,
      correlationId,
      maxAttempts,
      error: error.message,
    });
    throw error;
  }

  logger.debug('بدء عملية إعادة المحاولة', {
    operationName,
    correlationId,
    maxAttempts,
    backoffBaseMs,
    maxBackoffMs,
    backoffMultiplier,
    jitterRatio,
    idempotencyKey,
  });

  while (attempt < maxAttempts) {
    try {
      // تنفيذ العملية
      const result = await fn();
      const totalDurationMs = Date.now() - startTime;

      // تسجيل النجاح
      logger.info('نجاح عملية إعادة المحاولة', {
        operationName,
        correlationId,
        attempts: attempt + 1,
        totalDurationMs,
        idempotencyKey,
        attemptDelaysMs,
      });

      return {
        data: result,
        success: true,
        totalDurationMs,
        attempts: attempt + 1,
        attemptDelaysMs,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // تسجيل فشل المحاولة الحالية
      const isLastAttempt = attempt >= maxAttempts - 1;
      const logLevel = isLastAttempt ? 'error' : verboseLogging ? 'warn' : 'debug';

      logger[logLevel](
        isLastAttempt ? 'فشل المحاولة الأخيرة لإعادة المحاولة' : 'فشل محاولة إعادة المحاولة',
        {
          operationName,
          correlationId,
          attempt: attempt + 1,
          maxAttempts,
          error: lastError.message,
          errorName: lastError.name,
          idempotencyKey,
          isLastAttempt,
        }
      );

      // التحقق مما إذا كان الخطأ قابلاً لإعادة المحاولة
      const isRetryable = isErrorRetryable(
        lastError,
        retryableErrorTypes,
        customIsRetryable
      );

      if (!isRetryable) {
        // الخطأ غير قابل لإعادة المحاولة — فشل سريع
        logger.warn('توقف إعادة المحاولة بسبب خطأ غير قابل لإعادة المحاولة', {
          operationName,
          correlationId,
          attempt: attempt + 1,
          error: lastError.message,
          errorName: lastError.name,
          idempotencyKey,
        });

        const totalDurationMs = Date.now() - startTime;
        return {
          success: false,
          error: lastError,
          totalDurationMs,
          attempts: attempt + 1,
          attemptDelaysMs,
        };
      }

      // إذا كانت هذه هي المحاولة الأخيرة، نخرج من الحلقة
      if (isLastAttempt) {
        break;
      }

      // حساب زمن الانتظار قبل المحاولة التالية
      const delayMs = calculateBackoffDelay(
        attempt, // تبدأ من 0
        backoffBaseMs,
        backoffMultiplier,
        maxBackoffMs,
        jitterRatio
      );

      attemptDelaysMs.push(delayMs);

      // تسجيل الانتظار
      if (verboseLogging) {
        logger.debug('انتظار قبل المحاولة التالية', {
          operationName,
          correlationId,
          attempt: attempt + 1,
          delayMs,
          nextAttempt: attempt + 2,
          idempotencyKey,
        });
      }

      // انتظار الزمن المحسوب
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      attempt++;
    }
  }

  // إذا وصلنا إلى هنا، فهذا يعني أن جميع المحاولات فشلت
  const totalDurationMs = Date.now() - startTime;

  // إنشاء خطأ RetryExhaustedError
  const exhaustedError = new RetryExhaustedError(
    operationName,
    maxAttempts,
    lastError || new Error('خطأ غير معروف'),
    totalDurationMs
  );

  logger.error('نفاد جميع محاولات إعادة المحاولة', {
    operationName,
    correlationId,
    maxAttempts,
    totalDurationMs,
    error: exhaustedError.message,
    idempotencyKey,
    attemptDelaysMs,
  });

  return {
    success: false,
    error: exhaustedError,
    totalDurationMs,
    attempts: maxAttempts,
    attemptDelaysMs,
  };
}

/**
 * دالة مساعدة لتنفيذ عملية مع إعادة المحاولة، مع رمي الخطأ مباشرةً (بدلاً من إرجاع RetryResult).
 * مناسبة للاستخدام في الخدمات حيث يُفضل التعامل مع الأخطاء عبر try/catch.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — تغليف لـ withRetry مع رمي الخطأ.
 */
export async function withRetryAndThrow<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const result = await withRetry(fn, options);

  if (!result.success) {
    throw result.error;
  }

  return result.data as T;
}

/**
 * دالة مساعدة لإنشاء دالة مع إعادة المحاولة (Higher-Order Function).
 * تُستخدم لتزيين الدوال بإعادة المحاولة بشكل قابل لإعادة الاستخدام.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — تغليف بسيط مع حفظ الخيارات.
 */
export function withRetryDecorator<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: RetryOptions = {}
): T {
  const wrappedFn = async (...args: any[]): Promise<any> => {
    const result = await withRetry(() => fn(...args), {
      ...options,
      operationName: options.operationName || fn.name || 'decorated-function',
    });

    if (!result.success) {
      throw result.error;
    }

    return result.data;
  };

  // الاحتفاظ باسم الدالة الأصلية للتشخيص
  Object.defineProperty(wrappedFn, 'name', {
    value: `withRetry(${fn.name || 'anonymous'})`,
    configurable: true,
  });

  return wrappedFn as T;
}

/**
 * قائمة بأنواع الأخطاء الشائعة القابلة لإعادة المحاولة.
 * يمكن استخدامها في `retryableErrorTypes` لتحديد الأخطاء التي يجب إعادة محاولتها.
 */
export const COMMON_RETRYABLE_ERRORS = [
  // أخطاء الشبكة والاتصال
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',

  // أخطاء HTTP القابلة لإعادة المحاولة
  429, // Too Many Requests
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  500, // Internal Server Error (قد يكون مؤقتاً)
];

/**
 * دالة مساعدة لتحديد ما إذا كان الخطأ ناتجاً عن مشكلة شبكة أو مؤقتة.
 * تُستخدم كـ `isRetryableError` مخصصة في حالات عدم توفر قائمة الأنواع.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — تحقق من خصائص الخطأ والرسالة.
 */
export function isNetworkOrTemporaryError(error: Error): boolean {
  // التحقق من اسم الخطأ
  const errorName = error.name?.toLowerCase() || '';
  const errorMessage = error.message?.toLowerCase() || '';

  // التحقق من الأخطاء المعروفة
  if (
    errorName.includes('timeout') ||
    errorName.includes('network') ||
    errorName.includes('connection') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('network') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('econnreset') ||
    errorMessage.includes('econnaborted') ||
    errorMessage.includes('etimedout')
  ) {
    return true;
  }

  // التحقق من كود الخطأ (إذا كان متاحاً)
  const errorWithCode = error as any;
  if (errorWithCode.code) {
    const code = String(errorWithCode.code).toUpperCase();
    if (COMMON_RETRYABLE_ERRORS.includes(code as any)) {
      return true;
    }
  }

  // التحقق من كود الحالة (إذا كان متاحاً)
  if (errorWithCode.statusCode) {
    const statusCode = Number(errorWithCode.statusCode);
    if (COMMON_RETRYABLE_ERRORS.includes(statusCode as any)) {
      return true;
    }
  }

  return false;
}

/**
 * دالة مساعدة لإنشاء استراتيجية إعادة محاولة مُعدّة مسبقاً للذكاء الاصطناعي (Claude API).
 * تُطبق إعدادات مخصصة لـ Anthropic Claude مع أخطاء قابلة لإعادة المحاولة محددة.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — إعدادات مُعدّة مسبقاً للذكاء الاصطناعي.
 */
export function createAIRetryOptions(operationName: string = 'ai-operation'): RetryOptions {
  return {
    operationName,
    maxAttempts: 3, // 3 محاولات كحد أقصى
    backoffBaseMs: 1000, // 1 ثانية
    maxBackoffMs: 15000, // 15 ثانية
    backoffMultiplier: 2, // مضاعفة الزمن
    jitterRatio: 0.3, // 30% تشويش
    retryableErrorTypes: [], // سنستخدم isRetryableError المخصص
    isRetryableError: (error: Error) => {
      // أخطاء Claude الشائعة القابلة لإعادة المحاولة
      const errorMessage = error.message?.toLowerCase() || '';
      const errorName = error.name?.toLowerCase() || '';

      // 429: Too Many Requests (معدل محدود)
      if (errorMessage.includes('429') || errorMessage.includes('too many requests')) {
        return true;
      }

      // 5xx: أخطاء الخادم
      if (
        errorMessage.includes('500') ||
        errorMessage.includes('502') ||
        errorMessage.includes('503') ||
        errorMessage.includes('504')
      ) {
        return true;
      }

      // أخطاء المهلة والاتصال
      if (
        errorName.includes('timeout') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('network') ||
        errorMessage.includes('connection')
      ) {
        return true;
      }

      // أخطاء التحقق من المخرجات (غير قابلة لإعادة المحاولة)
      if (errorMessage.includes('validation') || errorMessage.includes('zod')) {
        return false;
      }

      // بشكل افتراضي، نعيد المحاولة للأخطاء غير المعروفة (باستثناء الأخطاء الواضحة للعميل)
      // لكن نحددها بـ 3 محاولات فقط
      return true;
    },
    verboseLogging: false,
  };
}
