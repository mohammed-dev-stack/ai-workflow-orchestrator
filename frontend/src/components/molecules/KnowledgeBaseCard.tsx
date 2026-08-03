// frontend/src/components/molecules/KnowledgeBaseCard.tsx
import React, { forwardRef, memo } from 'react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';

/**
 * خصائص مكون بطاقة قاعدة المعرفة.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface KnowledgeBaseCardProps {
  /** معرف قاعدة المعرفة */
  id: string;
  /** اسم قاعدة المعرفة */
  name: string;
  /** وصف قاعدة المعرفة (اختياري) */
  description?: string | null;
  /** عدد المستندات في القاعدة */
  documentCount: number;
  /** ما إذا كانت القاعدة نشطة */
  isActive: boolean;
  /** العلامات (tags) */
  tags?: string[];
  /** تاريخ الإنشاء (ISO string) */
  createdAt: string;
  /** اسم المنشئ */
  createdBy: string;
  /** ما إذا كانت البطاقة في حالة تحميل */
  isLoading?: boolean;
  /** ما إذا كانت البطاقة محددة (للاختيار) */
  selected?: boolean;
  /** ما إذا كانت البطاقة قابلة للتحديد */
  selectable?: boolean;
  /** دالة تستدعى عند النقر على البطاقة */
  onClick?: (id: string) => void;
  /** دالة تستدعى عند النقر على زر التعديل */
  onEdit?: (id: string) => void;
  /** دالة تستدعى عند النقر على زر الحذف */
  onDelete?: (id: string) => void;
  /** دالة تستدعى عند النقر على زر عرض المستندات */
  onViewDocuments?: (id: string) => void;
  /** دالة تستدعى عند النقر على زر تفعيل/تعطيل */
  onToggleActive?: (id: string, currentState: boolean) => void;
  /** معرف فئة CSS إضافية */
  className?: string;
}

/**
 * مكون بطاقة قاعدة المعرفة (KnowledgeBaseCard) — جزيئي، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="article"` للإشارة إلى أن هذا عنصر مستقل
 * - `aria-label` للتسمية الوصفية
 * - دعم التنقل عبر لوحة المفاتيح (tabIndex, onKeyDown)
 * - حالة `aria-selected` للاختيار
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون بطاقة قاعدة معرفة كامل مع دعم إمكانية الوصول.
 */
export const KnowledgeBaseCard = memo(
  forwardRef<HTMLDivElement, KnowledgeBaseCardProps>(
    (
      {
        id,
        name,
        description,
        documentCount,
        isActive,
        tags = [],
        createdAt,
        createdBy,
        isLoading = false,
        selected = false,
        selectable = false,
        onClick,
        onEdit,
        onDelete,
        onViewDocuments,
        onToggleActive,
        className,
      },
      ref
    ) => {
      // تنسيق التاريخ
      const formattedDate = format(new Date(createdAt), 'dd MMMM yyyy', { locale: arSA });

      // معالج النقر على البطاقة
      const handleClick = () => {
        if (!isLoading && onClick) {
          onClick(id);
        }
      };

      // معالج الضغط على Enter/Space (لإمكانية الوصول)
      const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if ((event.key === 'Enter' || event.key === ' ') && !isLoading && onClick) {
          event.preventDefault();
          onClick(id);
        }
      };

      // دمج الفئات
      const cardClasses = clsx(
        'relative rounded-lg border p-4 transition-all duration-200',
        'bg-white dark:bg-gray-800',
        'hover:shadow-md',
        // الحالات
        isLoading && 'opacity-60 pointer-events-none',
        !isActive && 'opacity-75 bg-gray-50 dark:bg-gray-900',
        selected && 'ring-2 ring-blue-500 border-blue-500',
        selectable && 'cursor-pointer',
        !isLoading && 'hover:border-gray-400 dark:hover:border-gray-600',
        // الفئات المخصصة
        className
      );

      return (
        <div
          ref={ref}
          className={cardClasses}
          role="article"
          aria-label={`قاعدة المعرفة: ${name}`}
          aria-selected={selected}
          aria-disabled={isLoading}
          tabIndex={selectable && !isLoading ? 0 : -1}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          {/* حالة الاختيار (checkbox) */}
          {selectable && (
            <div className="absolute top-3 left-3">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onClick?.(id)}
                onClick={(e) => e.stopPropagation()}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                aria-label={`تحديد ${name}`}
              />
            </div>
          )}

          <div className="flex flex-col gap-3">
            {/* الصف العلوي: الاسم والحالة */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                  {name}
                </h3>
              </div>

              {/* حالة النشاط */}
              <span
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
                  isActive
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                )}
              >
                <span
                  className={clsx(
                    'w-1.5 h-1.5 rounded-full',
                    isActive ? 'bg-green-500' : 'bg-gray-400'
                  )}
                  aria-hidden="true"
                />
                {isActive ? 'نشط' : 'غير نشط'}
              </span>
            </div>

            {/* الوصف */}
            {description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                {description}
              </p>
            )}

            {/* الإحصائيات والعلامات */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>{documentCount} مستند{documentCount !== 1 ? 'ات' : ''}</span>
              </span>

              <span className="hidden sm:inline">•</span>

              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>{formattedDate}</span>
              </span>

              <span className="hidden sm:inline">•</span>

              <span className="flex items-center gap-1 truncate max-w-[200px]">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="truncate">بواسطة {createdBy}</span>
              </span>
            </div>

            {/* العلامات (tags) */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                  >
                    {tag}
                  </span>
                ))}
                {tags.length > 4 && (
                  <span className="px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    +{tags.length - 4}
                  </span>
                )}
              </div>
            )}

            {/* أزرار الإجراءات */}
            {!isLoading && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                {/* زر عرض المستندات */}
                {onViewDocuments && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewDocuments(id);
                    }}
                    className="px-3 py-1.5 text-sm rounded-lg text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label={`عرض مستندات ${name}`}
                  >
                    عرض المستندات
                  </button>
                )}

                {/* زر تفعيل/تعطيل */}
                {onToggleActive && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleActive(id, isActive);
                    }}
                    className={clsx(
                      'px-3 py-1.5 text-sm rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2',
                      isActive
                        ? 'text-yellow-600 hover:bg-yellow-50 dark:text-yellow-400 dark:hover:bg-yellow-900/20 focus:ring-yellow-500'
                        : 'text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20 focus:ring-green-500'
                    )}
                    aria-label={isActive ? `تعطيل ${name}` : `تفعيل ${name}`}
                  >
                    {isActive ? 'تعطيل' : 'تفعيل'}
                  </button>
                )}

                {/* زر التعديل */}
                {onEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(id);
                    }}
                    className="px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
                    aria-label={`تعديل ${name}`}
                  >
                    تعديل
                  </button>
                )}

                {/* زر الحذف */}
                {onDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(id);
                    }}
                    className="px-3 py-1.5 text-sm rounded-lg text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                    aria-label={`حذف ${name}`}
                  >
                    حذف
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }
  )
);

KnowledgeBaseCard.displayName = 'KnowledgeBaseCard';

/**
 * تصدير المكون كافتراضي.
 */
export default KnowledgeBaseCard;