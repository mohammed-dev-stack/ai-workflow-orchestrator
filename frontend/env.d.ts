// frontend/src/env.d.ts
/// <reference types="vite/client" />

/**
 * ============================================================
 * تعريفات متغيرات البيئة (Environment Variables)
 * ============================================================
 * 
 * المصدر الوحيد (SSoT) لأنواع import.meta.env.
 * يضمن سلامة النوع 100% لجميع متغيرات البيئة في التطبيق.
 * 
 * @see https://vitejs.dev/guide/env-and-mode.html#env-files
 * ============================================================
 */

/**
 * واجهة متغيرات البيئة المخصصة.
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع المتغيرات المطلوبة مُعرَّفة بأنواع صارمة.
 */
interface ImportMetaEnv {
  /**
   * ==========================================================
   * متغيرات البيئة الأساسية (مطلوبة)
   * ==========================================================
   */

  /**
   * رابط الخادم الخلفي (Backend API)
   * 
   * @example 'http://localhost:3000'
   * @example 'https://api.whatsapp-ai.local'
   */
  readonly VITE_API_URL: string;

  /**
   * رابط WebSocket للاتصال في الوقت الفعلي
   * 
   * @example 'ws://localhost:3000/ws'
   * @example 'wss://api.whatsapp-ai.local/ws'
   */
  readonly VITE_WS_URL: string;

  /**
   * ==========================================================
   * متغيرات البيئة الاختيارية (لها قيم افتراضية)
   * ==========================================================
   */

  /**
   * منفذ خادم التطوير
   * @default '5173'
   */
  readonly VITE_PORT?: string;

  /**
   * بيئة التشغيل
   * @default 'development'
   */
  readonly VITE_ENV?: 'development' | 'production' | 'test';

  /**
   * اسم التطبيق (يُستخدم في شريط العنوان والعناصر العامة)
   * @default 'WhatsApp AI Agent'
   */
  readonly VITE_APP_NAME?: string;

  /**
   * إصدار التطبيق (يُحدد تلقائياً من package.json)
   */
  readonly VITE_APP_VERSION?: string;

  /**
   * رابط نقطة نهاية Sentry (لتتبع الأخطاء)
   * @example 'https://sentry.io/your-project'
   */
  readonly VITE_SENTRY_DSN?: string;

  /**
   * مفتاح Google Analytics (لتتبع الزوار)
   * @example 'UA-XXXXXXXXX-X'
   */
  readonly VITE_GA_TRACKING_ID?: string;

  /**
   * رابط إعادة التوجيه بعد تسجيل الدخول (لـ OAuth)
   * @example 'http://localhost:5173/auth/callback'
   */
  readonly VITE_AUTH_REDIRECT_URI?: string;

  /**
   * ما إذا كان التطبيق في وضع التصحيح (debug)
   * @default 'false'
   */
  readonly VITE_DEBUG?: 'true' | 'false';

  /**
   * ==========================================================
   * متغيرات مدمجة من Vite (متوفرة تلقائياً)
   * ==========================================================
   */

  /**
   * ما إذا كانت بيئة التطوير (DEV)
   * - Vite تُعيّن هذا تلقائياً
   */
  readonly DEV?: boolean;

  /**
   * ما إذا كانت بيئة الإنتاج (PROD)
   * - Vite تُعيّن هذا تلقائياً
   */
  readonly PROD?: boolean;

  /**
   * وضع التشغيل (MODE)
   * - Vite تُعيّن هذا تلقائياً من متغير `--mode`
   * @example 'development', 'production', 'test'
   */
  readonly MODE?: string;

  /**
   * المسار الأساسي (BASE_URL)
   * - Vite تُعيّن هذا تلقائياً من `base` في vite.config.ts
   */
  readonly BASE_URL?: string;

  /**
   * ==========================================================
   * متغيرات إضافية يمكن إضافتها حسب الحاجة
   * ==========================================================
   */

  /**
   * رابط نقطة نهاية OpenTelemetry (للتتبع الموزع)
   * @example 'http://localhost:4318/v1/traces'
   */
  readonly VITE_OTLP_ENDPOINT?: string;

  /**
   * مفتاح API لخدمة خارجية (مثل Mapbox, Stripe)
   * @example 'pk.abc123...'
   */
  readonly VITE_THIRD_PARTY_API_KEY?: string;
}

/**
 * توسيع واجهة ImportMeta لإضافة env المُعرَّف أعلاه.
 * هذا يضمن أن `import.meta.env` يعرف جميع متغيراتنا المخصصة.
 */
interface ImportMeta {
  /**
   * كائن متغيرات البيئة.
   * يحتوي على جميع المتغيرات المُعرَّفة في `.env` والملفات المرتبطة.
   * 
   * @example
   * const apiUrl = import.meta.env.VITE_API_URL;
   * const isDev = import.meta.env.DEV;
   */
  readonly env: ImportMetaEnv;
}

/**
 * ============================================================
 * ملاحظات هامة
 * ============================================================
 * 
 * 1. جميع المتغيرات التي تبدأ بـ VITE_ متاحة في الكود عبر import.meta.env
 * 2. المتغيرات الأخرى (غير المبدوءة بـ VITE_) غير متاحة في الواجهة الأمامية
 * 3. هذا الملف يجب أن يكون موجوداً في src/ ليتمكن TypeScript من قراءته
 * 4. عند إضافة متغير جديد، يجب تحديث هذا الملف
 * 5. المتغيرات الاختيارية (?) تحتاج إلى التحقق من وجودها قبل الاستخدام
 * ============================================================
 */