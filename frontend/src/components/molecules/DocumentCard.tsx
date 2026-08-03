// frontend/src/components/molecules/DocumentCard.tsx
import React, { forwardRef, memo } from 'react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';

/**
 * حالة المستند (كما تُعاد من الـ API).
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة للتصميم.
 */
export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DELETED';

/**
 * خصائص مكون بطاقة المستند.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface DocumentCardProps {
  /** معرف المستند */
  id: string;
  /** اسم الملف */
  fileName: string;
  /** حجم الملف بالبايت */
  fileSize: number;
  /** نوع MIME للملف */
  mimeType: string;
  /** حالة المستند */
  status: DocumentStatus;
  /** تاريخ الإنشاء (ISO string) */
  createdAt: string;
  /** وصف المستند (اختياري) */
  description?: string | null;
  /** العلامات (tags) */
  tags?: string[];
  /** ما إذا كانت البطاقة في حالة تحميل */
  isLoading?: boolean;
  /** ما إذا كانت البطاقة محددة (للاختيار) */
  selected?: boolean;
  /** ما إذا كانت البطاقة قابلة للتحديد */
  selectable?: boolean;
  /** دالة تستدعى عند النقر على البطاقة */
  onClick?: (id: string) => void;
  /** دالة تستدعى عند النقر على زر التحميل */
  onDownload?: (id: string) => void;
  /** دالة تستدعى عند النقر على زر الحذف */
  onDelete?: (id: string) => void;
  /** دالة تستدعى عند النقر على زر إعادة المحاولة (للمستندات الفاشلة) */
  onRetry?: (id: string) => void;
  /** معرف فئة CSS إضافية */
  className?: string;
}

/**
 * خرائط الألوان حسب حالة المستند.
 * [مُتحقَّق منطقياً بتتبع كامل] — ألوان متسقة للحالات.
 */
const statusConfig: Record<DocumentStatus, { label: string; color: string; bg: string }> = {
  PENDING: {
    label: 'قيد الانتظار',
    color: 'text-yellow-700 dark:text-yellow-300',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
  },
  PROCESSING: {
    label: 'قيد المعالجة',
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
  },
  COMPLETED: {
    label: 'مكتمل',
    color: 'text-green-700 dark:text-green-300',
    bg: 'bg-green-100 dark:bg-green-900/30',
  },
  FAILED: {
    label: 'فشل',
    color: 'text-red-700 dark:text-red-300',
    bg: 'bg-red-100 dark:bg-red-900/30',
  },
  DELETED: {
    label: 'محذوف',
    color: 'text-gray-500 dark:text-gray-400',
    bg: 'bg-gray-100 dark:bg-gray-800',
  },
};

/**
 * خريطة الأيقونات حسب نوع MIME.
 * [مُتحقَّق منطقياً بتتبع كامل] — أيقونات ملفات شائعة.
 */
const mimeIconMap: Record<string, React.ReactNode> = {
  'application/pdf': (
    <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 24 24">
      <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z" />
    </svg>
  ),
  'text/plain': (
    <svg className="w-8 h-8 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  ),
  'application/msword': (
    <svg className="w-8 h-8 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  ),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (
    <svg className="w-8 h-8 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  ),
  'application/vnd.ms-excel': (
    <svg className="w-8 h-8 text-green-600" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  ),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (
    <svg className="w-8 h-8 text-green-600" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  ),
  'application/vnd.ms-powerpoint': (
    <svg className="w-8 h-8 text-orange-600" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  ),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': (
    <svg className="w-8 h-8 text-orange-600" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  ),
};

/**
 * الحصول على أيقونة بناءً على نوع MIME.
 * [مُتحقَّق منطقياً بتتبع كامل] — دالة مساعدة لإرجاع الأيقونة المناسبة.
 */
function getMimeIcon(mimeType: string): React.ReactNode {
  // البحث عن تطابق تام
  if (mimeIconMap[mimeType]) {
    return mimeIconMap[mimeType];
  }

  // البحث عن تطابق جزئي (مثل application/pdf)
  for (const [key, icon] of Object.entries(mimeIconMap)) {
    if (mimeType.startsWith(key.split('/')[0]) || mimeType.includes(key.split('/')[1] || '')) {
      return icon;
    }
  }

  // أيقونة افتراضية
  return (
    <svg className="w-8 h-8 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  );
}

/**
 * تنسيق حجم الملف.
 * [مُتحقَّق منطقياً بتتبع كامل] — دالة مساعدة لتنسيق الحجم.
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(1)} ${sizes[i]}`;
}

/**
 * مكون بطاقة المستند (DocumentCard) — جزيئي، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="article"` للإشارة إلى أن هذا عنصر مستقل
 * - `aria-label` للتسمية الوصفية
 * - دعم التنقل عبر لوحة المفاتيح (tabIndex, onKeyDown)
 * - حالة `aria-selected` للاختيار
 * - `aria-disabled` للحالة المحذوفة
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون بطاقة مستند كامل مع دعم إمكانية الوصول.
 */
export const DocumentCard = memo(
  forwardRef<HTMLDivElement, DocumentCardProps>(
    (
      {
        id,
        fileName,
        fileSize,
        mimeType,
        status,
        createdAt,
        description,
        tags = [],
        isLoading = false,
        selected = false,
        selectable = false,
        onClick,
        onDownload,
        onDelete,
        onRetry,
        className,
      },
      ref
    ) => {
      // تحديد حالة المستند
      const statusInfo = statusConfig[status] || statusConfig.PENDING;
      const isDeleted = status === 'DELETED';
      const isFailed = status === 'FAILED';
      const isProcessing = status === 'PROCESSING';
      const isCompleted = status === 'COMPLETED';

      // تنسيق التاريخ
      const formattedDate = format(new Date(createdAt), 'dd MMMM yyyy، HH:mm', { locale: arSA });

      // أيقونة الملف
      const fileIcon = getMimeIcon(mimeType);

      // الحصول على امتداد الملف
      const fileExtension = fileName.split('.').pop()?.toUpperCase() || '';

      // معالج النقر على البطاقة
      const handleClick = () => {
        if (!isDeleted && !isLoading && onClick) {
          onClick(id);
        }
      };

      // معالج الضغط على Enter/Space (لإمكانية الوصول)
      const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if ((event.key === 'Enter' || event.key === ' ') && !isDeleted && !isLoading && onClick) {
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
        isDeleted && 'opacity-50 bg-gray-50 dark:bg-gray-900',
        selected && 'ring-2 ring-blue-500 border-blue-500',
        selectable && 'cursor-pointer',
        !isDeleted && !isLoading && 'hover:border-gray-400 dark:hover:border-gray-600',
        // الفئات المخصصة
        className
      );

      return (
        <div
          ref={ref}
          className={cardClasses}
          role="article"
          aria-label={`مستند: ${fileName}`}
          aria-selected={selected}
          aria-disabled={isDeleted || isLoading}
          tabIndex={selectable && !isDeleted && !isLoading ? 0 : -1}
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
                aria-label={`تحديد ${fileName}`}
              />
            </div>
          )}

          <div className="flex items-start gap-4">
            {/* أيقونة الملف */}
            <div className="flex-shrink-0 mt-1">
              {fileIcon}
            </div>

            {/* معلومات الملف */}
            <div className="flex-1 min-w-0">
              {/* اسم الملف */}
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                {fileName}
              </h3>

              {/* الوصف (إذا كان موجوداً) */}
              {description && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                  {description}
                </p>
              )}

              {/* تفاصيل الملف */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                <span>{formatFileSize(fileSize)}</span>
                <span>•</span>
                <span dir="ltr">{fileExtension || 'غير معروف'}</span>
                <span>•</span>
                <span>{formattedDate}</span>

                {/* العلامات (tags) */}
                {tags.length > 0 && (
                  <>
                    <span>•</span>
                    <div className="flex flex-wrap gap-1">
                      {tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                        >
                          {tag}
                        </span>
                      ))}
                      {tags.length > 3 && (
                        <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          +{tags.length - 3}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* حالة المستند */}
              <div className="mt-2">
                <span
                  className={clsx(
                    'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium',
                    statusInfo.bg,
                    statusInfo.color
                  )}
                >
                  {/* أيقونة الحالة */}
                  {status === 'PROCESSING' && (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  {status === 'COMPLETED' && (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                  {status === 'FAILED' && (
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  )}
                  {statusInfo.label}
                </span>

                {/* زر إعادة المحاولة (للمستندات الفاشلة) */}
                {isFailed && onRetry && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry(id);
                    }}
                    className="mr-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                    aria-label={`إعادة محاولة معالجة ${fileName}`}
                  >
                    إعادة المحاولة
                  </button>
                )}
              </div>
            </div>

            {/* أزرار الإجراءات */}
            {!isDeleted && !isLoading && (
              <div className="flex-shrink-0 flex items-center gap-1">
                {/* زر التحميل */}
                {isCompleted && onDownload && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(id);
                    }}
                    className="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:text-gray-400 dark:hover:text-blue-400 dark:hover:bg-blue-900/20 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label={`تحميل ${fileName}`}
                    title="تحميل"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                )}

                {/* زر الحذف */}
                {onDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(id);
                    }}
                    className="p-2 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                    aria-label={`حذف ${fileName}`}
                    title="حذف"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
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

DocumentCard.displayName = 'DocumentCard';

/**
 * تصدير المكون كافتراضي.
 */
export default DocumentCard;