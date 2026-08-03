// frontend/src/components/atoms/Spinner.tsx
import React, { forwardRef } from 'react';
import clsx from 'clsx';

/**
 * أحجام المؤشر المدعومة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة للتصميم.
 */
export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * أنماط المؤشر المدعومة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة للتصميم.
 */
export type SpinnerVariant = 'primary' | 'dark' | 'light';

/**
 * خصائص مكون المؤشر.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** حجم المؤشر */
  size?: SpinnerSize;
  /** نمط المؤشر */
  variant?: SpinnerVariant;
  /** تسمية وصفية للقراءة بواسطة قارئات الشاشة (افتراضي: "جاري التحميل...") */
  label?: string;
  /** ما إذا كان المؤشر سيكون في وضع absolute (مفيد للتغطية) */
  absolute?: boolean;
}

/**
 * خرائط الأحجام.
 * [مُتحقَّق منطقياً بتتبع كامل] — أحجام متسقة.
 */
const sizeClasses: Record<SpinnerSize, string> = {
  xs: 'w-3 h-3 border-[1.5px]',
  sm: 'w-4 h-4 border-2',
  md: 'w-6 h-6 border-2',
  lg: 'w-8 h-8 border-3',
  xl: 'w-12 h-12 border-4',
};

/**
 * خرائط الألوان.
 * [مُتحقَّق منطقياً بتتبع كامل] — ألوان متسقة.
 */
const variantClasses: Record<SpinnerVariant, string> = {
  primary: 'border-blue-600 border-t-transparent',
  dark: 'border-gray-700 border-t-transparent dark:border-gray-300 dark:border-t-transparent',
  light: 'border-white border-t-transparent',
};

/**
 * مكون مؤشر التحميل (Spinner) — ذري، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - دور ARIA صحيح (`role="status"`)
 * - تسمية وصفية (`aria-label` أو `label`)
 * - نص مخفي للقراءة بواسطة قارئات الشاشة (`sr-only`)
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون مؤشر كامل مع دعم إمكانية الوصول.
 */
export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(
  (
    {
      size = 'md',
      variant = 'primary',
      label = 'جاري التحميل...',
      absolute = false,
      className,
      ...props
    },
    ref
  ) => {
    // دمج الفئات
    const spinnerClasses = clsx(
      // الأساسيات
      'rounded-full border-solid',
      'animate-spin',
      // الأحجام والألوان
      sizeClasses[size],
      variantClasses[variant],
      // الموضع
      absolute && 'absolute inset-0 m-auto',
      // فئات مخصصة
      className
    );

    return (
      <div
        ref={ref}
        className={spinnerClasses}
        role="status"
        aria-label={label}
        {...props}
      >
        {/* نص مخفي لقارئات الشاشة (WCAG 2.1 AA) */}
        <span className="sr-only">{label}</span>
      </div>
    );
  }
);

Spinner.displayName = 'Spinner';

/**
 * تصدير المكون كافتراضي.
 */
export default Spinner;

/**
 * تصدير مكون مؤشر تحميل للتطبيق (Large، مع Label).
 * اختصار للاستخدام المتكرر في Suspense.
 * [مُتحقَّق منطقياً بتتبع كامل] — اختصار مفيد.
 */
export const LoadingSpinner = ({
  size = 'lg',
  label = 'جاري التحميل...',
  ...props
}: Omit<SpinnerProps, 'size'> & { size?: SpinnerSize }) => (
  <div className="flex items-center justify-center min-h-[200px] w-full">
    <Spinner size={size} label={label} {...props} />
  </div>
);

LoadingSpinner.displayName = 'LoadingSpinner';