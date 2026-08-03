// frontend/src/vite-env.d.ts
/// <reference types="vite/client" />

/**
 * تعريفات متغيرات البيئة (Vite) — SSoT لأنواع import.meta.env
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع المتغيرات المطلوبة مُعرَّفة بأنواع صارمة.
 */
interface ImportMetaEnv {
  /**
   * منفذ خادم التطوير (افتراضي: 5173)
   */
  readonly VITE_PORT?: string;

  /**
   * رابط الخادم الخلفي (Backend API)
   * مثال: http://localhost:3000
   */
  readonly VITE_API_URL: string;

  /**
   * رابط WebSocket للاتصال في الوقت الفعلي
   * مثال: ws://localhost:3000/ws
   */
  readonly VITE_WS_URL: string;

  /**
   * بيئة التشغيل (development, production)
   * @default 'development'
   */
  readonly VITE_ENV?: 'development' | 'production' | 'test';

  /**
   * مفتاح Google Analytics (اختياري)
   */
  readonly VITE_GA_TRACKING_ID?: string;

  /**
   * رابط إعادة التوجيه بعد تسجيل الدخول (لـ OAuth)
   */
  readonly VITE_AUTH_REDIRECT_URI?: string;

  /**
   * إصدار التطبيق (يُحدد تلقائياً من package.json)
   */
  readonly VITE_APP_VERSION?: string;

  /**
   * رابط نقطة نهاية Sentry (للأخطاء)
   */
  readonly VITE_SENTRY_DSN?: string;

  /**
   * اسم البيئة (مخصص)
   */
  readonly VITE_APP_NAME?: string;

  /**
   * ما إذا كان التطبيق في وضع التصحيح (debug)
   */
  readonly VITE_DEBUG?: string;
}

/**
 * توسيع واجهة ImportMeta لإضافة env المُعرَّف أعلاه.
 */
interface ImportMeta {
  readonly env: ImportMetaEnv;
}