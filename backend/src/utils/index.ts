// backend/src/utils/index.ts

// ============================================================
// المصدر الوحيد (SSoT) لوحدة الأدوات المساعدة
// ============================================================

/**
 * قاطع الدائرة (Circuit Breaker) — §4
 * يوفر حماية ضد فشل الخدمات الخارجية المتكرر.
 */
export {
  withCircuitBreaker,
  withCircuitBreakerAndRetry,
  resetCircuitBreaker,
  getCircuitBreakerState,
  getAllCircuitBreakerStates,
  CircuitBreakerState,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
} from './circuitBreaker';
export type {
  CircuitBreakerOptions,
  CircuitBreakerResult,
} from './circuitBreaker';

/**
 * استراتيجية إعادة المحاولة (Retry) — §4
 * توفر تراجعاً أسيًا مع تشويش (Exponential Backoff + Jitter).
 */
export {
  withRetry,
  withRetryAndThrow,
  withRetryDecorator,
  calculateBackoffDelay,
  isNetworkOrTemporaryError,
  createAIRetryOptions,
  RetryExhaustedError,
  COMMON_RETRYABLE_ERRORS,
} from './retry';
export type {
  RetryOptions,
  RetryResult,
} from './retry';

/**
 * التكافؤ (Idempotency) — §4
 * يضمن تنفيذ العمليات مرة واحدة فقط لكل مفتاح تكافؤ.
 */
export {
  generateIdempotencyKey,
  generateIdempotencyKeyFromInput,
  checkIdempotencyKey,
  storeIdempotencyResult,
  withIdempotency,
  deleteIdempotencyKey,
  getIdempotencyKeyInfo,
} from './idempotency';
export type {
  IdempotencyCheckResult,
  IdempotencyStoreOptions,
} from './idempotency';

/**
 * التشفير وإدارة الأسرار (Encryption & Secrets) — §4 و §7
 * يوفر تشفير AES-256-GCM وتدوير الأسرار وإدارة التخزين المؤقت.
 */
export {
  encrypt,
  decrypt,
  decryptSafe,
  getEncryptionKey,
  isValidEncryptionKey,
  generateEncryptionKey,
  refreshEncryptionKey,
  rotateEncryptionKey,
  initializeEncryption,
  cacheSecret,
  getCachedSecret,
  invalidateSecretCache,
  clearSecretCache,
} from './encryption';
export type {
  EncryptionOptions,
  DecryptionResult,
  KeyRotationResult,
} from './encryption';

/**
 * أدوات التعامل مع التواريخ (Date Utilities) — §1 و §5 و §7
 * يوفر تنسيقاً وتحويلاً وتحققاً من التواريخ في جميع أنحاء التطبيق.
 */
export {
  // الثوابت
  DATE_FORMATS,
  TIME_UNITS,
  WEEK_DAYS,

  // التحويل والتحقق
  toDate,
  isValidDate,

  // التنسيق
  formatDate,
  toISOString,
  toDateString,
  toTimeString,
  toShortDateString,
  toLongDateString,

  // حدود الوقت
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,

  // العمليات الحسابية
  addTime,
  addDays,
  addWeeks,
  addMonths,
  diffTime,
  diffDays,
  diffWeeks,
  diffMonths,

  // المقارنة والتصنيف
  isToday,
  isYesterday,
  isThisWeek,
  isThisMonth,
  isSameDay,
  isSameWeek,
  isSameMonth,

  // الوقت النسبي
  timeAgo,

  // تحويل UTC / Local
  toUTC,
  fromUTC,
  toUTCTimestamp,
  fromUTCTimestamp,

  // التحليل
  parseDate,
} from './date';
export type {
  DateFormat,
  TimeUnit,
  WeekDay,
} from './date';

// ============================================================
// كائن التصدير الافتراضي (لتجميع كل شيء)
// ============================================================

/**
 * كائن يحتوي على جميع الأدوات المساعدة.
 * [مُتحقَّق منطقياً بتتبع كامل] — تجميع جميع الأدوات للاستخدام الموحد.
 */
export default {
  // قاطع الدائرة
  circuitBreaker: {
    withCircuitBreaker: require('./circuitBreaker').withCircuitBreaker,
    withCircuitBreakerAndRetry: require('./circuitBreaker').withCircuitBreakerAndRetry,
    resetCircuitBreaker: require('./circuitBreaker').resetCircuitBreaker,
    getCircuitBreakerState: require('./circuitBreaker').getCircuitBreakerState,
    getAllCircuitBreakerStates: require('./circuitBreaker').getAllCircuitBreakerStates,
    CircuitBreakerState: require('./circuitBreaker').CircuitBreakerState,
    CircuitBreakerOpenError: require('./circuitBreaker').CircuitBreakerOpenError,
    CircuitBreakerTimeoutError: require('./circuitBreaker').CircuitBreakerTimeoutError,
  },

  // إعادة المحاولة
  retry: {
    withRetry: require('./retry').withRetry,
    withRetryAndThrow: require('./retry').withRetryAndThrow,
    withRetryDecorator: require('./retry').withRetryDecorator,
    calculateBackoffDelay: require('./retry').calculateBackoffDelay,
    isNetworkOrTemporaryError: require('./retry').isNetworkOrTemporaryError,
    createAIRetryOptions: require('./retry').createAIRetryOptions,
    RetryExhaustedError: require('./retry').RetryExhaustedError,
    COMMON_RETRYABLE_ERRORS: require('./retry').COMMON_RETRYABLE_ERRORS,
  },

  // التكافؤ
  idempotency: {
    generateIdempotencyKey: require('./idempotency').generateIdempotencyKey,
    generateIdempotencyKeyFromInput: require('./idempotency').generateIdempotencyKeyFromInput,
    checkIdempotencyKey: require('./idempotency').checkIdempotencyKey,
    storeIdempotencyResult: require('./idempotency').storeIdempotencyResult,
    withIdempotency: require('./idempotency').withIdempotency,
    deleteIdempotencyKey: require('./idempotency').deleteIdempotencyKey,
    getIdempotencyKeyInfo: require('./idempotency').getIdempotencyKeyInfo,
  },

  // التشفير
  encryption: {
    encrypt: require('./encryption').encrypt,
    decrypt: require('./encryption').decrypt,
    decryptSafe: require('./encryption').decryptSafe,
    getEncryptionKey: require('./encryption').getEncryptionKey,
    isValidEncryptionKey: require('./encryption').isValidEncryptionKey,
    generateEncryptionKey: require('./encryption').generateEncryptionKey,
    refreshEncryptionKey: require('./encryption').refreshEncryptionKey,
    rotateEncryptionKey: require('./encryption').rotateEncryptionKey,
    initializeEncryption: require('./encryption').initializeEncryption,
    cacheSecret: require('./encryption').cacheSecret,
    getCachedSecret: require('./encryption').getCachedSecret,
    invalidateSecretCache: require('./encryption').invalidateSecretCache,
    clearSecretCache: require('./encryption').clearSecretCache,
  },

  // التواريخ
  date: {
    // الثوابت
    DATE_FORMATS: require('./date').DATE_FORMATS,
    TIME_UNITS: require('./date').TIME_UNITS,
    WEEK_DAYS: require('./date').WEEK_DAYS,

    // التحويل والتحقق
    toDate: require('./date').toDate,
    isValidDate: require('./date').isValidDate,

    // التنسيق
    formatDate: require('./date').formatDate,
    toISOString: require('./date').toISOString,
    toDateString: require('./date').toDateString,
    toTimeString: require('./date').toTimeString,
    toShortDateString: require('./date').toShortDateString,
    toLongDateString: require('./date').toLongDateString,

    // حدود الوقت
    startOfDay: require('./date').startOfDay,
    endOfDay: require('./date').endOfDay,
    startOfWeek: require('./date').startOfWeek,
    endOfWeek: require('./date').endOfWeek,
    startOfMonth: require('./date').startOfMonth,
    endOfMonth: require('./date').endOfMonth,

    // العمليات الحسابية
    addTime: require('./date').addTime,
    addDays: require('./date').addDays,
    addWeeks: require('./date').addWeeks,
    addMonths: require('./date').addMonths,
    diffTime: require('./date').diffTime,
    diffDays: require('./date').diffDays,
    diffWeeks: require('./date').diffWeeks,
    diffMonths: require('./date').diffMonths,

    // المقارنة والتصنيف
    isToday: require('./date').isToday,
    isYesterday: require('./date').isYesterday,
    isThisWeek: require('./date').isThisWeek,
    isThisMonth: require('./date').isThisMonth,
    isSameDay: require('./date').isSameDay,
    isSameWeek: require('./date').isSameWeek,
    isSameMonth: require('./date').isSameMonth,

    // الوقت النسبي
    timeAgo: require('./date').timeAgo,

    // تحويل UTC / Local
    toUTC: require('./date').toUTC,
    fromUTC: require('./date').fromUTC,
    toUTCTimestamp: require('./date').toUTCTimestamp,
    fromUTCTimestamp: require('./date').fromUTCTimestamp,

    // التحليل
    parseDate: require('./date').parseDate,
  },
};

