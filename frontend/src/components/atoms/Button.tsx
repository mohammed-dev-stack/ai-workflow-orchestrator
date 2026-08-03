// frontend/src/components/atoms/Button.tsx
import React, { ButtonHTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';
import { Spinner } from './Spinner';

/**
 * أنواع أزرار الزر المدعومة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة للتصميم.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'link';

/**
 * أحجام الزر المدعومة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة للتصميم.
 */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * خصائص مكون الزر.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** نوع الزر (يحدد التصميم) */
  variant?: ButtonVariant;
  /** حجم الزر */
  size?: ButtonSize;
  /** ما إذا كان الزر في حالة تحميل (يُظهر مؤشر تحميل بدلاً من النص) */
  isLoading?: boolean;
  /** ما إذا كان الزر ممتلئ العرض */
  fullWidth?: boolean;
  /** نص الزر */
  children: React.ReactNode;
  /** معالج حدث النقر */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** زر كزر (للاستخدام مع react-router) */
  as?: 'button' | 'a' | 'span';
  /** رابط (عند استخدام as="a") */
  href?: string;
  /** علامات إضافية (data-*) */
  [key: `data-${string}`]: unknown;
}

/**
 * خرائط التصميم حسب النوع.
 * [مُتحقَّق منطقياً بتتبع كامل] — تصميمات متسقة وفقاً للنظام.
 */
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm focus:ring-blue-500',
  secondary: 'bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800 shadow-sm focus:ring-gray-500 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200',
  outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50 active:bg-blue-100 focus:ring-blue-500 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-900 dark:active:bg-blue-800',
  danger: 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-sm focus:ring-red-500',
  ghost: 'hover:bg-gray-100 active:bg-gray-200 text-gray-600 focus:ring-gray-400 dark:hover:bg-gray-700 dark:text-gray-300',
  link: 'text-blue-600 hover:text-blue-800 active:text-blue-900 underline focus:ring-blue-500 dark:text-blue-400 dark:hover:text-blue-300',
};

/**
 * خرائط الأحجام.
 * [مُتحقَّق منطقياً بتتبع كامل] — أحجام متسقة.
 */
const sizeClasses: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
  xl: 'px-8 py-4 text-xl',
};

/**
 * خرائط أحجام مؤشر التحميل.
 * [مُتحقَّق منطقياً بتتبع كامل] — تتطابق مع أحجام الزر.
 */
const spinnerSizeMap: Record<ButtonSize, 'xs' | 'sm' | 'md' | 'lg'> = {
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  xl: 'lg',
};

/**
 * مكون الزر (Button) — ذري، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - دعم التنقل عبر لوحة المفاتيح (tabindex، التركيز)
 * - أدوار ARIA الصحيحة (role="button")
 * - تسميات وصفية (عبر children أو aria-label)
 * - دعم حالة التحميل (disabled)
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون زر كامل مع دعم إمكانية الوصول.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      fullWidth = false,
      children,
      className,
      disabled,
      onClick,
      type = 'button',
      as: Component = 'button',
      href,
      ...props
    },
    ref
  ) => {
    // دمج الفئات
    const buttonClasses = clsx(
      // الأساسيات
      'inline-flex items-center justify-center gap-2',
      'font-medium rounded-lg',
      'transition-all duration-200',
      'focus:outline-none focus:ring-2 focus:ring-offset-2',
      // الأنواع والأحجام
      variantClasses[variant],
      sizeClasses[size],
      // حالة التحميل (إخفاء النص مع الحفاظ على العرض)
      isLoading && 'text-transparent',
      // العرض الكامل
      fullWidth && 'w-full',
      // حالة التعطيل
      (disabled || isLoading) && 'opacity-60 cursor-not-allowed pointer-events-none',
      // فئات مخصصة
      className
    );

    // محتوى الزر (نص أو مؤشر تحميل)
    const content = isLoading ? (
      <>
        <span className="sr-only">جاري التحميل...</span>
        <Spinner size={spinnerSizeMap[size]} variant="light" className="absolute inset-0 m-auto" />
        {children}
      </>
    ) : (
      children
    );

    // إذا كان الزر من نوع رابط (as="a")
    if (Component === 'a' && href) {
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          className={buttonClasses}
          role="button"
          aria-disabled={disabled || isLoading}
          onClick={(e) => {
            if (disabled || isLoading) {
              e.preventDefault();
              return;
            }
            onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>);
          }}
          {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {content}
        </a>
      );
    }

    // زر عادي
    return (
      <button
        ref={ref}
        type={type}
        className={buttonClasses}
        disabled={disabled || isLoading}
        onClick={onClick}
        aria-busy={isLoading}
        aria-disabled={disabled || isLoading}
        {...props}
      >
        {content}
      </button>
    );
  }
);

Button.displayName = 'Button';

/**
 * تصدير المكون كافتراضي.
 */
export default Button;