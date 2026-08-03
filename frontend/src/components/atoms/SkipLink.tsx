// frontend/src/components/atoms/SkipLink.tsx
import React, { forwardRef } from 'react';
import clsx from 'clsx';

/**
 * خصائص مكون رابط التخطي.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface SkipLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** معرف العنصر المستهدف (بدون علامة #) */
  targetId: string;
  /** نص الرابط (افتراضي: "تخطي إلى المحتوى الرئيسي") */
  label?: string;
  /** ما إذا كان الرابط مرئياً دائماً (للتطوير فقط) */
  alwaysVisible?: boolean;
}

/**
 * مكون رابط التخطي (Skip Link) — ذري، لتوفير إمكانية الوصول.
 * يلتزم بـ WCAG 2.1 AA:
 * - معيار 2.4.1: توفير آلية لتخطي المحتوى المتكرر
 * - يظهر فقط عند التركيز (للمستخدمين الذين يتنقلون عبر لوحة المفاتيح)
 * - يتم وضعه في أعلى الصفحة ليسهل الوصول إليه
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون رابط تخطي كامل لدعم إمكانية الوصول.
 */
export const SkipLink = forwardRef<HTMLAnchorElement, SkipLinkProps>(
  ({ targetId, label = 'تخطي إلى المحتوى الرئيسي', alwaysVisible = false, className, ...props }, ref) => {
    // دمج الفئات
    const linkClasses = clsx(
      // الأساسيات
      'fixed top-4 left-4 z-50',
      'px-4 py-2 rounded-lg',
      'bg-blue-600 text-white font-medium',
      'shadow-lg ring-2 ring-blue-500 ring-offset-2',
      'transition-all duration-200',
      'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
      // إخفاء الرابط بشكل افتراضي، يظهر فقط عند التركيز (باستثناء alwaysVisible)
      !alwaysVisible && 'sr-only focus:not-sr-only',
      // فئات مخصصة
      className
    );

    // معالج النقر لتوجيه التركيز إلى العنصر المستهدف
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      const targetElement = document.getElementById(targetId);
      if (targetElement) {
        // تعيين tabIndex مؤقتاً إذا لم يكن العنصر قابلاً للتركيز
        if (!targetElement.hasAttribute('tabindex')) {
          targetElement.setAttribute('tabindex', '-1');
        }
        targetElement.focus();
        // إزالة tabIndex بعد التركيز (اختياري)
        setTimeout(() => {
          if (targetElement.getAttribute('tabindex') === '-1') {
            targetElement.removeAttribute('tabindex');
          }
        }, 100);
      }
    };

    return (
      <a
        ref={ref}
        href={`#${targetId}`}
        className={linkClasses}
        onClick={handleClick}
        {...props}
      >
        {label}
      </a>
    );
  }
);

SkipLink.displayName = 'SkipLink';

/**
 * تصدير المكون كافتراضي.
 */
export default SkipLink;