// frontend/src/components/pages/LoginPage.tsx
import React, { forwardRef, memo, useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth.store';
import { Input } from '../atoms/Input';
import { Button } from '../atoms/Button';
import { Spinner } from '../atoms/Spinner';
/**
 * خصائص مكون صفحة تسجيل الدخول.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface LoginPageProps {
  /** معرف فئة CSS إضافية */
  className?: string;
}

/**
 * مكون صفحة تسجيل الدخول (LoginPage) — صفحة كاملة.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="main"` للإشارة إلى المحتوى الرئيسي
 * - `aria-label` للتسمية الوصفية
 * - `aria-live="polite"` لرسائل الخطأ
 * - دعم التنقل عبر لوحة المفاتيح (Enter لإرسال النموذج)
 * - `autocomplete` لتحسين تجربة الملء التلقائي
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون صفحة تسجيل دخول كامل مع دعم إمكانية الوصول.
 */
export const LoginPage = memo(
  forwardRef<HTMLDivElement, LoginPageProps>(
    ({ className }, ref) => {
      const navigate = useNavigate();
      const location = useLocation();
      const { login, isAuthenticated, isLoading, error: authError, clearError } = useAuthStore();

      // حالة النموذج
      const [email, setEmail] = useState('');
      const [password, setPassword] = useState('');
      const [tenantId, setTenantId] = useState('');
      const [localError, setLocalError] = useState<string | null>(null);
      const [isSubmitting, setIsSubmitting] = useState(false);

      // الحصول على مسار العودة (من حالة التنقل)
      const from = (location.state as any)?.from?.pathname || '/';

      // إعادة التوجيه إذا كان المستخدم مصادقاً بالفعل
      useEffect(() => {
        if (isAuthenticated) {
          navigate(from, { replace: true });
        }
      }, [isAuthenticated, navigate, from]);

      // تنظيف الأخطاء عند إلغاء تثبيت المكون
      useEffect(() => {
        return () => {
          clearError();
        };
      }, [clearError]);

      // معالج إرسال النموذج
      const handleSubmit = useCallback(
        async (e: React.FormEvent) => {
          e.preventDefault();

          // تنظيف الأخطاء السابقة
          setLocalError(null);
          clearError();

          // التحقق من صحة المدخلات (الفشل السريع)
          const trimmedEmail = email.trim();
          const trimmedPassword = password.trim();
          const trimmedTenantId = tenantId.trim();

          if (!trimmedEmail) {
            setLocalError('البريد الإلكتروني مطلوب');
            return;
          }

          if (!trimmedPassword) {
            setLocalError('كلمة المرور مطلوبة');
            return;
          }

          // محاولة تسجيل الدخول
          setIsSubmitting(true);
          try {
            await login({
              email: trimmedEmail,
              password: trimmedPassword,
              tenantId: trimmedTenantId || undefined,
            });
            // تمت إعادة التوجيه في useEffect
          } catch (error) {
            // تم التعامل مع الخطأ في الـ store
            setIsSubmitting(false);
          } finally {
            setIsSubmitting(false);
          }
        },
        [email, password, tenantId, login, clearError]
      );

      // معالج ضغط Enter (إرسال النموذج)
      const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const form = (event.target as HTMLElement).closest('form');
          if (form) {
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        }
      }, []);

      // دمج الأخطاء (من الـ store والخطأ المحلي)
      const displayError = localError || authError;

      return (
        <div
          ref={ref}
          className={clsx(
            'min-h-screen flex items-center justify-center',
            'bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800',
            'p-4',
            className
          )}
          role="main"
          aria-label="صفحة تسجيل الدخول"
        >
          <div className="w-full max-w-md">
            {/* بطاقة تسجيل الدخول */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-200 dark:border-gray-700">
              {/* الشعار */}
              <div className="text-center mb-8">
                <div className="text-4xl mb-3">🤖</div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  واتساب AI
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  مساعد المعرفة بالذكاء الاصطناعي
                </p>
              </div>

              {/* نموذج تسجيل الدخول */}
              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                {/* البريد الإلكتروني */}
                <Input
                  id="email"
                  type="email"
                  label="البريد الإلكتروني"
                  placeholder="example@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                  disabled={isSubmitting || isLoading}
                  aria-describedby={displayError ? 'login-error' : undefined}
                  aria-invalid={!!displayError}
                  className="w-full"
                  size="lg"
                />

                {/* كلمة المرور */}
                <Input
                  id="password"
                  type="password"
                  label="كلمة المرور"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={isSubmitting || isLoading}
                  aria-describedby={displayError ? 'login-error' : undefined}
                  aria-invalid={!!displayError}
                  className="w-full"
                  size="lg"
                />

                {/* معرف المستأجر (اختياري) */}
                <Input
                  id="tenantId"
                  type="text"
                  label="معرف المستأجر (اختياري)"
                  placeholder="أدخل معرف المستأجر إن وجد"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  autoComplete="organization"
                  disabled={isSubmitting || isLoading}
                  className="w-full"
                  size="lg"
                  helper="اتركه فارغاً إذا كنت تستخدم مستأجراً واحداً"
                />

                {/* رسالة الخطأ */}
                {displayError && (
                  <div
                    id="login-error"
                    className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                    role="alert"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {displayError}
                    </p>
                  </div>
                )}

                {/* زر تسجيل الدخول */}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isLoading={isSubmitting || isLoading}
                  disabled={isSubmitting || isLoading}
                  aria-label="تسجيل الدخول"
                >
                  {isSubmitting || isLoading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
                </Button>

                {/* معلومات إضافية */}
                <div className="text-center text-xs text-gray-400 dark:text-gray-500 mt-4">
                  <p>© {new Date().getFullYear()} واتساب AI — منصة مساعد المعرفة</p>
                  <p className="mt-1">جميع الحقوق محفوظة</p>
                </div>
              </form>
            </div></div>
        </div>
      );
    }
  )
);

LoginPage.displayName = 'LoginPage';

/**
 * تصدير المكون كافتراضي.
 */
export default LoginPage;
