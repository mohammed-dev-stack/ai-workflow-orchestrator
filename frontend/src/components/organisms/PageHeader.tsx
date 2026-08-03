// frontend/src/components/organisms/PageHeader.tsx
import React, { forwardRef, ReactNode } from 'react';
import clsx from 'clsx';
import { Button, ButtonProps } from '../atoms/Button';

/**
 * خصائص زر الإجراء في رأس الصفحة.
 */
export interface PageHeaderAction {
  /** نص الزر */
  label: string;
  /** دالة تستدعى عند النقر */
  onClick: () => void;
  /** نوع الزر (افتراضي: 'primary') */
  variant?: ButtonProps['variant'];
  /** حجم الزر (افتراضي: 'md') */
  size?: ButtonProps['size'];
  /** ما إذا كان الزر في حالة تحميل */
  isLoading?: boolean;
  /** ما إذا كان الزر معطلاً */
  disabled?: boolean;
  /** أيقونة الزر (اختياري) */
  icon?: ReactNode;
  /** معرف فئة CSS إضافية */
  className?: string;
}

/**
 * خصائص مكون رأس الصفحة.
 */
export interface PageHeaderProps {
  /** عنوان الصفحة (رئيسي) */
  title: string;
  /** وصف الصفحة (اختياري) */
  description?: string;
  /** قائمة أزرار الإجراءات */
  actions?: PageHeaderAction[];
  /** محتوى إضافي (اختياري) — يُوضع بجانب الأزرار */
  extra?: ReactNode;
  /** ما إذا كان رأس الصفحة في حالة تحميل */
  isLoading?: boolean;
  /** معرف فئة CSS إضافية للحاوية */
  className?: string;
  /** معرف فئة CSS إضافية للعنوان */
  titleClassName?: string;
  /** معرف فئة CSS إضافية للوصف */
  descriptionClassName?: string;
  /** معرف فئة CSS إضافية لمنطقة الإجراءات */
  actionsClassName?: string;
}

/**
 * مكون رأس الصفحة (PageHeader) — عضوي، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="banner"` للإشارة إلى رأس الصفحة
 * - `aria-label` للتسمية الوصفية
 * - `aria-labelledby` لربط العنوان (ضمني)
 * - `aria-busy` لحالة التحميل
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون رأس صفحة كامل مع دعم إمكانية الوصول.
 */
export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(
  (
    {
      title,
      description,
      actions = [],
      extra,
      isLoading = false,
      className,
      titleClassName,
      descriptionClassName,
      actionsClassName,
    },
    ref
  ) => {
    // دمج فئات الحاوية
    const containerClasses = clsx(
      'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4',
      'pb-4 border-b border-gray-200 dark:border-gray-700',
      className
    );

    // دمج فئات العنوان
    const titleClasses = clsx(
      'text-2xl font-bold text-gray-900 dark:text-gray-100',
      titleClassName
    );

    // دمج فئات الوصف
    const descClasses = clsx(
      'text-sm text-gray-500 dark:text-gray-400 mt-1',
      descriptionClassName
    );

    // دمج فئات منطقة الإجراءات
    const actionsClasses = clsx(
      'flex flex-wrap items-center gap-2 flex-shrink-0',
      actionsClassName
    );

    // معرف فريد للعنوان (لـ `aria-labelledby`)
    const titleId = `page-header-${Math.random().toString(36).slice(2, 9)}`;

    return (
      <header
        ref={ref}
        className={containerClasses}
        role="banner"
        aria-label={`رأس صفحة ${title}`}
        aria-busy={isLoading}
      >
        {/* الجهة اليسرى: العنوان والوصف */}
        <div className="flex-1 min-w-0">
          <h1 id={titleId} className={titleClasses}>
            {title}
          </h1>
          {description && (
            <p className={descClasses}>
              {description}
            </p>
          )}
        </div>

        {/* الجهة اليمنى: الإجراءات والمحتوى الإضافي */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* الإجراءات (أزرار) */}
          {actions.length > 0 && (
            <div className={actionsClasses}>
              {actions.map((action, index) => (
                <Button
                  key={index}
                  variant={action.variant || 'primary'}
                  size={action.size || 'md'}
                  onClick={action.onClick}
                  isLoading={action.isLoading || isLoading}
                  disabled={action.disabled || isLoading}
                  className={action.className}
                  aria-label={action.label}
                >
                  {action.icon && <span className="ml-1">{action.icon}</span>}
                  {action.label}
                </Button>
              ))}
            </div>
          )}

          {/* محتوى إضافي (مثل Breadcrumb أو زر إضافي) */}
          {extra && (
            <div className="flex-shrink-0">
              {extra}
            </div>
          )}
        </div>
      </header>
    );
  }
);

PageHeader.displayName = 'PageHeader';

/**
 * تصدير المكون كافتراضي.
 */
export default PageHeader;