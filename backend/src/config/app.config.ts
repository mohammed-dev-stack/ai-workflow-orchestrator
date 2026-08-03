// ============================================================
// backend/src/config/app.config.ts
// ============================================================
// إعدادات التطبيق (منطق الأعمال وواجهة المستخدم)
// المصدر الوحيد (SSoT) للإعدادات على مستوى التطبيق
// جميع القيم إما من envConfig أو قيم افتراضية مُوثَّقة
// ============================================================

import { envConfig } from './env.schema';

/**
 * كائن إعدادات التطبيق.
 * يُجمِّع كل الإعدادات المتعلقة بمنطق الأعمال، وواجهة المستخدم، والأمان، والرفع، والترقيم، إلخ.
 * يتبع مبدأ الفشل السريع (Fail-Fast) في حال عدم توفر قيم أساسية.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص مُعرَّفة، والأنواع مستنتجة بدقة.
 */
export const appConfig = {
  /**
   * إعدادات الخادم (HTTP)
   */
  server: {
    port: envConfig.PORT,
    host: '0.0.0.0', // ثابت، يمكن تغييره عبر متغير البيئة HOST إذا أُضيف إلى env.schema
    corsOrigin: envConfig.CORS_ORIGIN,
    /**
     * مهلة الطلب بالمللي ثانية (الحد الأقصى لوقت معالجة الطلب قبل قطع الاتصال).
     * قيمة افتراضية: 60 ثانية، يمكن زيادتها للطلبات التي تتضمن معالجة مستندات كبيرة.
     */
    requestTimeoutMs: 60000,
  },

  /**
   * إعدادات الصفحات والترقيم (Pagination)
   */
  pagination: {
    /**
     * عدد العناصر الافتراضي في الصفحة الواحدة.
     */
    defaultLimit: 20,
    /**
     * أقصى عدد مسموح به للعناصر في الصفحة (لمنع استنزاف الموارد).
     */
    maxLimit: 100,
  },

  /**
   * إعدادات رفع الملفات (الأمان والأداء)
   */
  upload: {
    /**
     * أقصى حجم للملف بالبايت (10 ميجابايت).
     * يُطبق في middleware قبل الوصول إلى الخدمة.
     */
    maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
    /**
     * أنواع MIME المسموح بها للمستندات.
     * قائمة مقيدة لمنع رفع ملفات ضارة.
     */
    allowedMimeTypes: [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ] as const,
    /**
     * الحد الأقصى لعدد المستندات التي يمكن رفعها في طلب واحد.
     */
    maxFilesPerRequest: 10,
  },

  /**
   * إعدادات التسجيل (Logging) — مُشتقة من envConfig
   */
  logging: {
    level: envConfig.LOG_LEVEL,
    /**
     * تنسيق السجل (JSON إلزامي حسب §5).
     */
    format: 'json' as const,
    /**
     * ما إذا كان سيتم طباعة السجلات في وحدة التحكم (للتطوير فقط).
     */
    prettyPrint: envConfig.NODE_ENV === 'development',
  },

  /**
   * إعدادات تحديد المعدل (Rate Limiting) — مُشتقة من envConfig
   */
  rateLimit: {
    windowMs: envConfig.RATE_LIMIT_WINDOW_MS,
    maxRequests: envConfig.RATE_LIMIT_MAX_REQUESTS,
    /**
     * رسالة الخطأ المعروضة عند تجاوز الحد.
     */
    errorMessage: 'تم تجاوز حد الطلبات المسموح به. يرجى المحاولة بعد قليل.',
  },

  /**
   * إعدادات الجلسات والمصادقة
   */
  auth: {
    /**
     * مدة صلاحية التوكن (من envConfig).
     */
    jwtExpiry: envConfig.JWT_EXPIRY,
    /**
     * مدة صلاحية توكن التحديث (Refresh Token) — قيمة افتراضية: 30 يوم.
     * يمكن جعلها متغير بيئة إذا لزم الأمر.
     */
    refreshTokenExpiry: '30d',
  },

  /**
   * إعدادات التخزين المؤقت (Cache) — تستخدم في Redis بشكل أساسي.
   */
  cache: {
    /**
     * مدة بقاء الإعدادات المؤقتة (مثل نتائج التضمين) بالثواني.
     */
    defaultTtlSeconds: 3600, // ساعة واحدة
    /**
     * أقصى مدة بقاء للبيانات المؤقتة.
     */
    maxTtlSeconds: 86400, // 24 ساعة
  },

  /**
   * إعدادات الأمان الإضافية (على مستوى التطبيق)
   */
  security: {
    /**
     * الحد الأقصى لطول النص في الطلبات (لمنع هجمات الحجم).
     */
    maxPayloadSizeBytes: 1024 * 1024, // 1 MB
    /**
     * ما إذا كان سيتم تمكين حماية CSRF (للواجهة الأمامية).
     */
    enableCsrfProtection: true,
    /**
     * قائمة بالعناصر المحظورة في أسماء الملفات (لمنع هجمات المسار).
     */
    sanitizeFilenamePattern: /[^a-zA-Z0-9\-_.]/g,
  },

  /**
   * إعدادات قوائم الانتظار (BullMQ) — تُستخدم للمعالجة غير المتزامنة.
   */
  queues: {
    /**
     * مهلة معالجة المهمة (Job) بالمللي ثانية.
     * إذا تجاوزت المهمة هذه المهلة، تُعتبر فاشلة وتُعاد محاولتها أو تُرسل إلى DLQ.
     * قيمة افتراضية: 5 دقائق (للمهام التي تتضمن معالجة مستندات كبيرة).
     */
    jobTimeoutMs: 300000, // 5 minutes

    /**
     * عدد مرات إعادة محاولة المهمة الفاشلة.
     */
    retryAttempts: 3,

    /**
     * مدة تأخير إعادة المحاولة (باستخدام تراجع أسي).
     * القيمة الأساسية بالمللي ثانية (مشتقة من envConfig.RETRY_BACKOFF_BASE).
     */
    retryBackoffMs: envConfig.RETRY_BACKOFF_BASE,

    /**
     * مدة بقاء المهمة في قائمة الانتظار (TTL) بالثواني.
     * قيمة افتراضية: 7 أيام.
     */
    jobTtlSeconds: 604800, // 7 days

    /**
     * مدة بقاء المهمة المنتهية (completed/failed) في قائمة الانتظار بالثواني.
     * قيمة افتراضية: 24 ساعة.
     */
    jobHistoryTtlSeconds: 86400, // 24 hours
  },

  encryption: {
  key: envConfig.ENCRYPTION_KEY ?? (() => {
    if (envConfig.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY غير معرّف في بيئة الإنتاج. تأكد من تعيينه.');
    }
    const defaultKey = 'default-32-byte-key-for-dev-only!!';
    console.warn('⚠️ استخدام مفتاح تشفير افتراضي (ضعيف) في بيئة التطوير. يُوصى بتعيين ENCRYPTION_KEY.');
    return defaultKey;
  })(),
  algorithm: 'aes-256-gcm' as const,
},
} as const;

/**
 * استنتاج النوع من كائن appConfig.
 * يضمن سلامة النوع 100% ولا وجود لـ `any`.
 * [مُتحقَّق منطقياً بتتبع كامل] — استدلال TypeScript مع `as const` يوفر نوعاً صارماً للقراءة فقط.
 */
export type AppConfig = typeof appConfig;

/**
 * تصدير الكائن كافتراضي لسهولة الاستيراد في وحدات التطبيق.
 */
export default appConfig;

