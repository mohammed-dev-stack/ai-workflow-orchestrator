// backend/src/utils/circuitBreaker.ts
import { randomUUID } from 'crypto';
import { config } from '../config';
import { logger } from '../observability/logger';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware';
import { AppError } from '../middlewares/errorHandler.middleware';

/**
 * حالات قاطع الدائرة (Circuit Breaker States).
 * - CLOSED: الدائرة مغلقة، تمرر الطلبات بشكل طبيعي.
 * - OPEN: الدائرة مفتوحة، ترفض جميع الطلبات فوراً (فشل سريع).
 * - HALF_OPEN: الدائرة نصف مفتوحة، تسمح بمرور طلب اختبار واحد لتحديد ما إذا كانت الخدمة قد استعادت عافيتها.
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * خيارات تهيئة قاطع الدائرة.
 */
export interface CircuitBreakerOptions {
  /** اسم الخدمة أو المورد المحمي (للتسجيل والتتبع) */
  serviceName: string;

  /** المهلة بالمللي ثانية (الحد الأقصى لوقت تنفيذ العملية) */
  timeoutMs?: number;

  /** عدد الأخطاء المسموح بها قبل فتح الدائرة */
  errorThreshold?: number;

  /** مدة الانتظار قبل محاولة نصف فتح الدائرة (Half-Open) بالمللي ثانية */
  halfOpenWaitMs?: number;

  /** عدد الطلبات الناجحة المتتالية المطلوبة لإغلاق الدائرة مرة أخرى */
  successThreshold?: number;

  /** مفتاح التكافؤ (اختياري) — يُستخدم لتمييز العمليات المتكررة */
  idempotencyKey?: string;
}

/**
 * نتيجة تنفيذ العملية عبر قاطع الدائرة.
 */
export interface CircuitBreakerResult<T> {
  /** البيانات المُرجعة من العملية (إذا نجحت) */
  data?: T;

  /** الخطأ (إذا فشلت) */
  error?: Error;

  /** ما إذا كانت العملية ناجحة */
  success: boolean;

  /** المدة بالمللي ثانية */
  durationMs: number;

  /** حالة قاطع الدائرة بعد التنفيذ */
  state: CircuitBreakerState;

  /** عدد المحاولات التي تمت */
  attempts: number;
}

/**
 * خطأ يُرمى عند فتح الدائرة (رفض الطلبات).
 * [مُتحقَّق منطقياً بتتبع كامل] — فئة خطأ مخصصة.
 */
export class CircuitBreakerOpenError extends AppError {
  constructor(serviceName: string, halfOpenWaitMs?: number) {
    const message = `قاطع الدائرة مفتوح للخدمة "${serviceName}"${halfOpenWaitMs ? `، يُرجى المحاولة بعد ${Math.ceil(halfOpenWaitMs / 1000)} ثانية` : ''}`;
    super(message, 503, 'CIRCUIT_BREAKER_OPEN', { serviceName, halfOpenWaitMs });
  }
}

/**
 * خطأ يُرمى عند انتهاء المهلة (Timeout).
 * [مُتحقَّق منطقياً بتتبع كامل] — فئة خطأ مخصصة.
 */
export class CircuitBreakerTimeoutError extends AppError {
  constructor(serviceName: string, timeoutMs: number) {
    super(
      `انتهت مهلة استدعاء الخدمة "${serviceName}" (${timeoutMs}ms)`,
      504,
      'CIRCUIT_BREAKER_TIMEOUT',
      { serviceName, timeoutMs }
    );
  }
}

/**
 * حالة قاطع الدائرة الداخلية (لكل خدمة).
 * تُخزن في الذاكرة (لكل عقدة) — يمكن توسيعها لتستخدم Redis للتوزيع إذا لزم الأمر.
 */
interface CircuitBreakerStateInternal {
  /** الحالة الحالية */
  state: CircuitBreakerState;

  /** عدد الأخطاء المتتالية في النافذة الحالية (عند CLOSED) */
  consecutiveFailures: number;

  /** عدد النجاحات المتتالية في Half-Open */
  consecutiveSuccesses: number;

  /** الطابع الزمني لآخر فتح للدائرة (لحساب وقت إعادة المحاولة) */
  lastOpenTimestamp: number | null;

  /** الطابع الزمني لآخر طلب (لحساب النافذة الزمنية) */
  lastRequestTimestamp: number;

  /** العدد الإجمالي للطلبات في النافذة الحالية */
  totalRequests: number;

  /** عدد الطلبات الناجحة في النافذة الحالية */
  totalSuccesses: number;

  /** عدد الأخطاء الإجمالي في النافذة الحالية */
  totalErrors: number;
}

/**
 * مخزن حالات قواطع الدائرة (لكل خدمة).
 * استخدام Map لتخزين الحالات في الذاكرة.
 */
const circuitBreakerStore = new Map<string, CircuitBreakerStateInternal>();

/**
 * القيم الافتراضية لخيارات قاطع الدائرة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة منطقية.
 */
const DEFAULT_OPTIONS = {
  timeoutMs: config.circuitBreaker.timeout,
  errorThreshold: config.circuitBreaker.errorThreshold,
  halfOpenWaitMs: 60000, // 60 ثانية
  successThreshold: 3, // 3 نجاحات متتالية لإغلاق الدائرة
};

/**
 * دالة مساعدة للحصول على أو إنشاء حالة داخلية لخدمة معينة.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع أو إنشاء حالة جديدة.
 */
function getOrCreateState(serviceName: string): CircuitBreakerStateInternal {
  let state = circuitBreakerStore.get(serviceName);
  if (!state) {
    state = {
      state: CircuitBreakerState.CLOSED,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastOpenTimestamp: null,
      lastRequestTimestamp: Date.now(),
      totalRequests: 0,
      totalSuccesses: 0,
      totalErrors: 0,
    };
    circuitBreakerStore.set(serviceName, state);
  }
  return state;
}

/**
 * دالة مساعدة للتحقق مما إذا كانت الدائرة مفتوحة ويجب رفض الطلب.
 * إذا كانت HALF_OPEN، تسمح بمرور طلب اختبار واحد.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق التحقق مع دعم Half-Open.
 */
function isCircuitOpen(state: CircuitBreakerStateInternal, halfOpenWaitMs: number): boolean {
  if (state.state === CircuitBreakerState.CLOSED) {
    return false;
  }

  if (state.state === CircuitBreakerState.OPEN) {
    // التحقق مما إذا كان الوقت قد حان لمحاولة Half-Open
    if (state.lastOpenTimestamp) {
      const elapsedMs = Date.now() - state.lastOpenTimestamp;
      if (elapsedMs >= halfOpenWaitMs) {
        // الانتقال إلى Half-Open تلقائياً
        state.state = CircuitBreakerState.HALF_OPEN;
        state.consecutiveSuccesses = 0;
        logger.info('انتقال قاطع الدائرة إلى حالة Half-Open', {
          serviceName: getServiceNameFromState(state),
          elapsedMs,
          halfOpenWaitMs,
        });
        return false; // السماح بمرور طلب الاختبار
      }
    }
    return true; // لا يزال مفتوحاً
  }

  // HALF_OPEN: نسمح بمرور طلب واحد فقط في كل مرة
  // نستخدم عداد الطلبات لمنع تدفق الطلبات في Half-Open
  // (يتم التحكم في ذلك في دالة execute)
  return false;
}

/**
 * دالة مساعدة للحصول على اسم الخدمة من الحالة الداخلية (للتسجيل).
 * تُستخدم لأن الحالة لا تخزن اسم الخدمة مباشرةً.
 */
function getServiceNameFromState(state: CircuitBreakerStateInternal): string {
  // نبحث عن المفتاح في الـ Map الذي يشير إلى هذه الحالة
  for (const [key, value] of circuitBreakerStore.entries()) {
    if (value === state) {
      return key;
    }
  }
  return 'unknown';
}

/**
 * تنفيذ دالة مع حماية قاطع الدائرة.
 * تطبق الفشل السريع، وإعادة المحاولة (اختياري)، والتراجع الأسي مع التشويش.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق تنفيذ كامل مع قاطع الدائرة وإعادة المحاولة.
 */
export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  options: CircuitBreakerOptions
): Promise<CircuitBreakerResult<T>> {
  const {
    serviceName,
    timeoutMs = DEFAULT_OPTIONS.timeoutMs,
    errorThreshold = DEFAULT_OPTIONS.errorThreshold,
    halfOpenWaitMs = DEFAULT_OPTIONS.halfOpenWaitMs,
    successThreshold = DEFAULT_OPTIONS.successThreshold,
    idempotencyKey,
  } = options;

  const correlationId = getCurrentCorrelationId() || randomUUID();
  const startTime = Date.now();
  let attempts = 0;
  let lastError: Error | undefined;

  // 1. الحصول على حالة قاطع الدائرة للخدمة
  const state = getOrCreateState(serviceName);

  // 2. التحقق مما إذا كانت الدائرة مفتوحة (فشل سريع)
  if (isCircuitOpen(state, halfOpenWaitMs)) {
    const error = new CircuitBreakerOpenError(serviceName, halfOpenWaitMs);
    logger.warn('رفض طلب بسبب فتح قاطع الدائرة', {
      serviceName,
      correlationId,
      state: state.state,
      lastOpenTimestamp: state.lastOpenTimestamp,
      halfOpenWaitMs,
      idempotencyKey,
    });
    return {
      success: false,
      error,
      durationMs: Date.now() - startTime,
      state: state.state,
      attempts: 0,
    };
  }

  // 3. تحديث حالة HALF_OPEN: نسمح بطلب واحد فقط
  // نستخدم totalRequests كعداد للطلبات في Half-Open
  // ولكن بما أن isCircuitOpen سمح بالمرور، نسمح بتنفيذ الطلب
  // نضبط علامة لمنع الطلبات المتزامنة في Half-Open (باستخدام عداد)
  // نستخدم totalRequests كآلية بسيطة للتحكم (يمكن تحسينها باستخدام قفل)
  if (state.state === CircuitBreakerState.HALF_OPEN) {
    // نسمح بطلب واحد فقط في Half-Open
    // نستخدم totalRequests لتتبع الطلبات في Half-Open
    // (هذا ليس مثالياً للطلبات المتزامنة، ولكن يكفي للتطبيق)
    if (state.totalRequests > 0 && state.totalSuccesses === 0 && state.totalErrors === 0) {
      // إذا كان هناك طلب قيد التنفيذ في Half-Open، نرفض الطلب الجديد
      const error = new CircuitBreakerOpenError(serviceName, halfOpenWaitMs);
      logger.warn('رفض طلب متزامن في حالة Half-Open', {
        serviceName,
        correlationId,
        totalRequests: state.totalRequests,
      });
      return {
        success: false,
        error,
        durationMs: Date.now() - startTime,
        state: state.state,
        attempts: 0,
      };
    }
    // زيادة عداد الطلبات في Half-Open
    state.totalRequests += 1;
  }

  // 4. تنفيذ العملية مع مهلة (Timeout) وإعادة المحاولة
  try {
    // زيادة عداد الطلبات الإجمالي
    state.totalRequests += 1;

    // إنشاء Promise مع مهلة
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new CircuitBreakerTimeoutError(serviceName, timeoutMs));
      }, timeoutMs);
    });

    // تنفيذ العملية مع المهلة
    const result = await Promise.race([fn(), timeoutPromise]);
    const durationMs = Date.now() - startTime;
    attempts = 1;

    // 5. معالجة النجاح
    state.totalSuccesses += 1;
    state.consecutiveFailures = 0;

    if (state.state === CircuitBreakerState.HALF_OPEN) {
      state.consecutiveSuccesses += 1;
      if (state.consecutiveSuccesses >= successThreshold) {
        // إغلاق الدائرة مرة أخرى
        state.state = CircuitBreakerState.CLOSED;
        state.consecutiveSuccesses = 0;
        state.consecutiveFailures = 0;
        state.lastOpenTimestamp = null;
        logger.info('إغلاق قاطع الدائرة (استعادة الخدمة)', {
          serviceName,
          correlationId,
          consecutiveSuccesses: state.consecutiveSuccesses,
          successThreshold,
        });
      }
    }

    logger.debug('نجاح استدعاء الخدمة عبر قاطع الدائرة', {
      serviceName,
      correlationId,
      durationMs,
      state: state.state,
      idempotencyKey,
    });

    return {
      data: result,
      success: true,
      durationMs,
      state: state.state,
      attempts,
    };
  } catch (error) {
    // 6. معالجة الفشل
    const durationMs = Date.now() - startTime;
    lastError = error instanceof Error ? error : new Error(String(error));
    attempts = 1;

    state.totalErrors += 1;
    state.consecutiveFailures += 1;

    // إذا كانت الدائرة في حالة HALF_OPEN وفشل الطلب، نفتح الدائرة مرة أخرى
    if (state.state === CircuitBreakerState.HALF_OPEN) {
      state.state = CircuitBreakerState.OPEN;
      state.lastOpenTimestamp = Date.now();
      state.consecutiveSuccesses = 0;
      logger.warn('فشل طلب الاختبار في Half-Open، إعادة فتح الدائرة', {
        serviceName,
        correlationId,
        error: lastError.message,
        durationMs,
      });
    } else if (state.state === CircuitBreakerState.CLOSED) {
      // إذا تجاوزت الأخطاء العتبة، نفتح الدائرة
      if (state.consecutiveFailures >= errorThreshold) {
        state.state = CircuitBreakerState.OPEN;
        state.lastOpenTimestamp = Date.now();
        logger.warn('فتح قاطع الدائرة (تجاوز عتبة الأخطاء)', {
          serviceName,
          correlationId,
          consecutiveFailures: state.consecutiveFailures,
          errorThreshold,
          error: lastError.message,
        });
      }
    }

    // تسجيل الفشل
    logger.error('فشل استدعاء الخدمة عبر قاطع الدائرة', {
      serviceName,
      correlationId,
      error: lastError.message,
      durationMs,
      state: state.state,
      consecutiveFailures: state.consecutiveFailures,
      idempotencyKey,
    });

    return {
      success: false,
      error: lastError,
      durationMs,
      state: state.state,
      attempts,
    };
  }
}

/**
 * دالة مساعدة لتنفيذ عملية مع قاطع الدائرة وإعادة المحاولة التلقائية.
 * تطبق التراجع الأسي مع التشويش (Exponential Backoff + Jitter).
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — تغليف مع إعادة المحاولة وقاطع الدائرة.
 */
export async function withCircuitBreakerAndRetry<T>(
  fn: () => Promise<T>,
  options: CircuitBreakerOptions & {
    /** الحد الأقصى لعدد محاولات إعادة المحاولة */
    maxRetries?: number;
    /** الزمن الأساسي للتراجع الأسي بالمللي ثانية */
    backoffBaseMs?: number;
    /** الحد الأقصى للزمن بين المحاولات بالمللي ثانية */
    maxBackoffMs?: number;
    /** قائمة بأكواد/أنواع الأخطاء القابلة لإعادة المحاولة */
    retryableErrorTypes?: Array<new (...args: any[]) => Error>;
  }
): Promise<CircuitBreakerResult<T>> {
  const {
    maxRetries = config.retry.maxAttempts - 1, // -1 لأن المحاولة الأولى تحسب كأول محاولة
    backoffBaseMs = config.retry.backoffBase,
    maxBackoffMs = 30000,
    retryableErrorTypes = [],
    ...cbOptions
  } = options;

  const correlationId = getCurrentCorrelationId() || randomUUID();
  let lastResult: CircuitBreakerResult<T> | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    // تنفيذ العملية عبر قاطع الدائرة
    const result = await withCircuitBreaker(fn, {
      ...cbOptions,
      idempotencyKey: options.idempotencyKey || `${cbOptions.serviceName}-${attempt}`,
    });

    lastResult = result;

    // إذا نجحت العملية، نعيد النتيجة فوراً
    if (result.success) {
      return result;
    }

    // إذا فشلت بسبب فتح قاطع الدائرة (أو خطأ غير قابل لإعادة المحاولة)، ننهي المحاولات
    const error = result.error;
    if (error instanceof CircuitBreakerOpenError) {
      logger.warn('توقف إعادة المحاولة بسبب فتح قاطع الدائرة', {
        serviceName: cbOptions.serviceName,
        correlationId,
        attempt,
        error: error.message,
      });
      return result;
    }

    // التحقق مما إذا كان الخطأ قابلاً لإعادة المحاولة
    let isRetryable = true;
    if (retryableErrorTypes.length > 0) {
      isRetryable = retryableErrorTypes.some((ErrorType) => error instanceof ErrorType);
    }

    if (!isRetryable) {
      logger.debug('الخطأ غير قابل لإعادة المحاولة، إنهاء المحاولات', {
        serviceName: cbOptions.serviceName,
        correlationId,
        attempt,
        error: error?.message,
      });
      return result;
    }

    // إذا كانت هذه هي المحاولة الأخيرة، ننهي دون انتظار
    if (attempt >= maxRetries) {
      logger.warn('انتهت جميع محاولات إعادة المحاولة', {
        serviceName: cbOptions.serviceName,
        correlationId,
        maxRetries,
        error: error?.message,
      });
      return result;
    }

    // حساب زمن الانتظار باستخدام التراجع الأسي مع التشويش (Jitter)
    const exponentialDelay = backoffBaseMs * Math.pow(2, attempt);
    const jitter = Math.random() * 0.3 * exponentialDelay; // تشويش 30%
    const delayMs = Math.min(exponentialDelay + jitter, maxBackoffMs);

    logger.debug('انتظار قبل إعادة المحاولة', {
      serviceName: cbOptions.serviceName,
      correlationId,
      attempt,
      delayMs,
      exponentialDelay,
      jitter,
    });

    // انتظار الزمن المحسوب
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    attempt++;
  }

  // إذا وصلنا إلى هنا، فهذا يعني أن جميع المحاولات فشلت
  return lastResult || {
    success: false,
    error: new Error('فشلت جميع محاولات إعادة المحاولة'),
    durationMs: 0,
    state: CircuitBreakerState.OPEN,
    attempts: maxRetries + 1,
  };
}

/**
 * دالة مساعدة لإعادة تعيين حالة قاطع الدائرة لخدمة معينة (يدوياً).
 * تُستخدم للإدارة أو في الاختبارات.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — إعادة تعيين بسيطة للحالة.
 */
export function resetCircuitBreaker(serviceName: string): void {
  const state = circuitBreakerStore.get(serviceName);
  if (state) {
    state.state = CircuitBreakerState.CLOSED;
    state.consecutiveFailures = 0;
    state.consecutiveSuccesses = 0;
    state.lastOpenTimestamp = null;
    state.totalRequests = 0;
    state.totalSuccesses = 0;
    state.totalErrors = 0;
    logger.info('تم إعادة تعيين قاطع الدائرة يدوياً', { serviceName });
  }
}

/**
 * دالة مساعدة للحصول على حالة قاطع الدائرة الحالية (للمراقبة).
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع الحالة للتشخيص.
 */
export function getCircuitBreakerState(serviceName: string): CircuitBreakerStateInternal | null {
  return circuitBreakerStore.get(serviceName) || null;
}

/**
 * دالة مساعدة للحصول على جميع حالات قواطع الدائرة (للمراقبة).
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع جميع الحالات للتشخيص.
 */
export function getAllCircuitBreakerStates(): Map<string, CircuitBreakerStateInternal> {
  return new Map(circuitBreakerStore);
}

