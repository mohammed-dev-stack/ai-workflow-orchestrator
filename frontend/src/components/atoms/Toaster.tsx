// frontend/src/components/atoms/Toaster.tsx
import React, { forwardRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

/**
 * أنواع الإشعارات المدعومة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة للتصميم.
 */
export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'loading';

/**
 * موقع الإشعار على الشاشة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة للتصميم.
 */
export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * بنية الإشعار الواحد.
 * [مُتحقَّق منطقياً بتتبع كامل] — هيكل الإشعار.
 */
export interface Toast {
  /** معرف فريد للإشعار */
  id: string;
  /** نوع الإشعار */
  variant: ToastVariant;
  /** عنوان الإشعار (اختياري) */
  title?: string;
  /** نص الإشعار */
  message: string;
  /** مدة العرض بالمللي ثانية (افتراضي: 3000) */
  duration?: number;
  /** ما إذا كان الإشعار قابلاً للإغلاق يدوياً (افتراضي: true) */
  dismissible?: boolean;
  /** تاريخ الإنشاء (لترتيب الظهور) */
  createdAt?: number;
  /** بيانات إضافية (اختياري) */
  data?: Record<string, unknown>;
}

/**
 * خصائص مكون Toaster.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface ToasterProps {
  /** قائمة الإشعارات المراد عرضها */
  toasts?: Toast[];
  /** موقع الإشعارات على الشاشة (افتراضي: 'top-right') */
  position?: ToastPosition;
  /** دالة لإزالة إشعار (تُمرر من الوالد) */
  onRemove?: (id: string) => void;
  /** مدة العرض الافتراضية بالمللي ثانية (افتراضي: 3000) */
  defaultDuration?: number;
  /** الحد الأقصى لعدد الإشعارات المعروضة (افتراضي: 5) */
  maxToasts?: number;
  /** ما إذا كان سيتم إضافة أيقونات (افتراضي: true) */
  showIcons?: boolean;
}

/**
 * خريطة الألوان حسب نوع الإشعار.
 * [مُتحقَّق منطقياً بتتبع كامل] — ألوان متسقة.
 */
const variantStyles: Record<ToastVariant, { bg: string; text: string; border: string; icon: string }> = {
  success: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-800 dark:text-green-200',
    border: 'border-green-500 dark:border-green-400',
    icon: 'text-green-500 dark:text-green-400',
  },
  error: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-800 dark:text-red-200',
    border: 'border-red-500 dark:border-red-400',
    icon: 'text-red-500 dark:text-red-400',
  },
  warning: {
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    text: 'text-yellow-800 dark:text-yellow-200',
    border: 'border-yellow-500 dark:border-yellow-400',
    icon: 'text-yellow-500 dark:text-yellow-400',
  },
  info: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-800 dark:text-blue-200',
    border: 'border-blue-500 dark:border-blue-400',
    icon: 'text-blue-500 dark:text-blue-400',
  },
  loading: {
    bg: 'bg-gray-50 dark:bg-gray-800/50',
    text: 'text-gray-800 dark:text-gray-200',
    border: 'border-gray-500 dark:border-gray-400',
    icon: 'text-gray-500 dark:text-gray-400',
  },
};

/**
 * خريطة الأيقونات حسب نوع الإشعار.
 * [مُتحقَّق منطقياً بتتبع كامل] — أيقونات SVG بسيطة.
 */
const iconMap: Record<ToastVariant, React.ReactNode> = {
  success: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
  ),
  loading: (
    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  ),
};

/**
 * خريطة المواقع.
 * [مُتحقَّق منطقياً بتتبع كامل] — تنسيقات المواقع المختلفة.
 */
const positionClasses: Record<ToastPosition, string> = {
  'top-left': 'top-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-4 right-4',
};

/**
 * مكون الإشعار الفردي.
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون فرعي داخلي.
 */
const ToastItem = forwardRef<HTMLDivElement, {
  toast: Toast;
  onRemove: (id: string) => void;
  showIcons: boolean;
}>(({ toast, onRemove, showIcons }, ref) => {
  const { id, variant, title, message, dismissible = true } = toast;
  const styles = variantStyles[variant];
  const icon = showIcons ? iconMap[variant] : null;

  // إزالة الإشعار بعد المدة المحددة
  useEffect(() => {
    const duration = toast.duration || 3000;
    if (duration > 0 && variant !== 'loading') {
      const timer = setTimeout(() => {
        onRemove(id);
      }, duration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [id, toast.duration, variant, onRemove]);

  return (
    <div
      ref={ref}
      className={clsx(
        'flex items-start gap-3 p-4 rounded-lg shadow-lg',
        'border-l-4',
        'transition-all duration-300 ease-in-out',
        'max-w-md w-full',
        styles.bg,
        styles.text,
        styles.border
      )}
      role="alert"
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {/* الأيقونة */}
      {icon && (
        <div className={clsx('flex-shrink-0 mt-0.5', styles.icon)}>
          {icon}
        </div>
      )}

      {/* المحتوى */}
      <div className="flex-1 min-w-0">
        {title && (
          <p className="font-semibold text-sm">{title}</p>
        )}
        <p className={clsx('text-sm', title && 'mt-0.5')}>
          {message}
        </p>
      </div>

      {/* زر الإغلاق */}
      {dismissible && variant !== 'loading' && (
        <button
          onClick={() => onRemove(id)}
          className={clsx(
            'flex-shrink-0 p-1 rounded-lg',
            'hover:bg-black/5 dark:hover:bg-white/5',
            'transition-colors duration-200',
            'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
          )}
          aria-label="إغلاق الإشعار"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  );
});

ToastItem.displayName = 'ToastItem';

/**
 * مكون Toaster — عرض الإشعارات في طبقة منفصلة (Portal).
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="alert"` للإشعارات الهامة
 * - `aria-live="polite"` أو `"assertive"` للإشعارات الديناميكية
 * - `aria-atomic="true"` لإعلان الإشعار كامل
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون Toaster كامل مع دعم إمكانية الوصول.
 */
export const Toaster = forwardRef<HTMLDivElement, ToasterProps>(
  (
    {
      toasts = [],
      position = 'top-right',
      onRemove,
      defaultDuration = 3000,
      maxToasts = 5,
      showIcons = true,
    },
    ref
  ) => {
    // تحديد الإشعارات المعروضة (الحد الأقصى)
    const visibleToasts = toasts.slice(0, maxToasts);
    const hasToasts = visibleToasts.length > 0;

    // إذا لم تكن هناك إشعارات، لا نعرض شيئاً
    if (!hasToasts) {
      return null;
    }

    // محتوى الإشعارات
    const toastElements = visibleToasts.map((toast) => (
      <ToastItem
        key={toast.id}
        toast={{ ...toast, duration: toast.duration || defaultDuration }}
        onRemove={onRemove || (() => {})}
        showIcons={showIcons}
      />
    ));

    // تصدير الإشعارات إلى Portal (لضمان ظهورها فوق جميع المحتوى)
    return createPortal(
      <div
        ref={ref}
        className={clsx(
          'fixed z-[9999] flex flex-col gap-3',
          positionClasses[position],
          'pointer-events-none' // السماح بالنقر من خلال الحاوية
        )}
        style={{
          maxWidth: 'calc(100% - 2rem)',
        }}
      >
        {/* لف الإشعارات بحاوية تسمح بالنقر عليها */}
        <div className="pointer-events-auto flex flex-col gap-3">
          {toastElements}
        </div>
      </div>,
      document.body
    );
  }
);

Toaster.displayName = 'Toaster';

/**
 * تصدير المكون كافتراضي.
 */
export default Toaster;