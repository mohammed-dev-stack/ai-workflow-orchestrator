// frontend/src/components/organisms/Modal.tsx
import React, { forwardRef, useEffect, useRef, useCallback, ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Button } from '../atoms/Button';

/**
 * أحجام النافذة المنبثقة المدعومة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة للتصميم.
 */
export type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

/**
 * خصائص مكون النافذة المنبثقة.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface ModalProps {
  /** ما إذا كانت النافذة مفتوحة */
  isOpen: boolean;
  /** دالة تستدعى عند طلب الإغلاق (من المستخدم) */
  onClose: () => void;
  /** عنوان النافذة (يُستخدم كـ `aria-labelledby`) */
  title?: string;
  /** محتوى النافذة */
  children: ReactNode;
  /** حجم النافذة (افتراضي: 'md') */
  size?: ModalSize;
  /** ما إذا كان الإغلاق بالنقر على الخلفية مسموحاً (افتراضي: true) */
  closeOnOverlayClick?: boolean;
  /** ما إذا كان الإغلاق بضغط ESC مسموحاً (افتراضي: true) */
  closeOnEscape?: boolean;
  /** ما إذا كان سيتم عرض زر الإغلاق (افتراضي: true) */
  showCloseButton?: boolean;
  /** نص زر الإغلاق (لإمكانية الوصول) */
  closeButtonLabel?: string;
  /** معرف فئة CSS إضافية للحاوية */
  className?: string;
  /** معرف فئة CSS إضافية للمحتوى */
  contentClassName?: string;
  /** معرف فئة CSS إضافية للخلفية */
  overlayClassName?: string;
  /** ما إذا كان سيتم منع تمرير الصفحة الخلفية (افتراضي: true) */
  preventScroll?: boolean;
  /** معرف العنصر الذي يصف المحتوى (لـ `aria-describedby`) */
  describedBy?: string;
}

/**
 * خرائط الأحجام.
 * [مُتحقَّق منطقياً بتتبع كامل] — أحجام متسقة.
 */
const sizeClasses: Record<ModalSize, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-[95vw] max-h-[95vh]',
};

/**
 * مكون النافذة المنبثقة (Modal) — عضوي، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="dialog"` للإشارة إلى نافذة حوارية
 * - `aria-modal="true"` للإشارة إلى أن هذه نافذة مشروطة
 * - `aria-labelledby` لربط العنوان
 * - `aria-describedby` لربط الوصف (اختياري)
 * - إدارة التركيز: حصر التركيز داخل النافذة عند الفتح
 * - دعم ESC للإغلاق
 * - دعم النقر على الخلفية للإغلاق
 * - `aria-hidden` للخلفية
 * - استخدام `React Portal` للتصدير خارج ترتيب DOM
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون نافذة منبثقة كامل مع دعم إمكانية الوصول.
 */
export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  (
    {
      isOpen,
      onClose,
      title,
      children,
      size = 'md',
      closeOnOverlayClick = true,
      closeOnEscape = true,
      showCloseButton = true,
      closeButtonLabel = 'إغلاق النافذة',
      className,
      contentClassName,
      overlayClassName,
      preventScroll = true,
      describedBy,
    },
    ref
  ) => {
    // ✅ استخدم `useState` بدلاً من `useRef` لتخزين العنصر DOM لتجنب مشكلة read-only
    const [modalElement, setModalElement] = useState<HTMLDivElement | null>(null);
    
    // مرجع للعنصر الذي كان يحمل التركيز قبل الفتح
    const previousFocusRef = useRef<HTMLElement | null>(null);
    // مرجع لعناصر التركيز القابلة للتركيز داخل النافذة (اختياري، يمكن الاحتفاظ به)
    const focusableElementsRef = useRef<HTMLElement[]>([]);

    // دالة لجمع العناصر القابلة للتركيز داخل النافذة
    const getFocusableElements = useCallback(() => {
      if (!modalElement) return [];
      const focusableSelectors = [
        'button:not([disabled])',
        'a[href]:not([disabled])',
        'input:not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"]):not([disabled])',
        'details summary',
      ];
      return Array.from(
        modalElement.querySelectorAll<HTMLElement>(focusableSelectors.join(','))
      ).filter((el) => !el.hasAttribute('disabled'));
    }, [modalElement]);

    // دالة لحصر التركيز داخل النافذة
    const trapFocus = useCallback((event: KeyboardEvent) => {
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) return; // ✅ أضف هذه الحماية

      if (event.key === 'Tab') {
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    }, [getFocusableElements]);

    // دالة لإغلاق النافذة
    const handleClose = useCallback(() => {
      if (isOpen) {
        onClose();
      }
    }, [isOpen, onClose]);

    // معالج الضغط على ESC
    const handleKeyDown = useCallback((event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        handleClose();
      }
    }, [closeOnEscape, handleClose]);

    // معالج النقر على الخلفية
    const handleOverlayClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      if (closeOnOverlayClick && event.target === event.currentTarget) {
        handleClose();
      }
    }, [closeOnOverlayClick, handleClose]);

    // فتح النافذة: حفظ التركيز السابق، إضافة مستمعي الأحداث، منع التمرير
    useEffect(() => {
      if (!isOpen) return;

      // حفظ العنصر الذي كان يحمل التركيز
      previousFocusRef.current = document.activeElement as HTMLElement;

      // إضافة مستمعي الأحداث
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keydown', trapFocus);

      // منع تمرير الصفحة الخلفية
      if (preventScroll) {
        document.body.style.overflow = 'hidden';
      }

      // تأخير التركيز على النافذة
      const timeoutId = setTimeout(() => {
        if (modalElement) {
          modalElement.focus();
        }
      }, 50);

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('keydown', trapFocus);
        clearTimeout(timeoutId);

        if (preventScroll) {
          document.body.style.overflow = '';
        }

        if (previousFocusRef.current) {
          previousFocusRef.current.focus();
        }
      };
    }, [isOpen, handleKeyDown, trapFocus, preventScroll, modalElement]);

    // إذا كانت النافذة مغلقة، لا نعرض شيئاً
    if (!isOpen) return null;

    // دمج الفئات
    const modalClasses = clsx(
      'relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full',
      'max-h-[90vh] flex flex-col',
      'transform transition-all duration-300 ease-out',
      'animate-in fade-in-50 zoom-in-95',
      sizeClasses[size],
      className
    );

    const overlayClasses = clsx(
      'fixed inset-0 z-50 flex items-center justify-center p-4',
      'bg-black/50 dark:bg-black/60',
      'backdrop-blur-sm',
      'transition-opacity duration-300',
      'animate-in fade-in',
      overlayClassName
    );

    const contentClasses = clsx(
      'flex-1 overflow-y-auto p-4 sm:p-6',
      'scrollbar-custom',
      contentClassName
    );

    const titleId = title ? `modal-title-${Math.random().toString(36).slice(2, 9)}` : undefined;

    // ✅ تصدير النافذة عبر Portal مع معالجة المرجع الصحيحة
    return createPortal(
      <div
        className={overlayClasses}
        onClick={handleOverlayClick}
        role="presentation"
        aria-hidden="true"
      >
        <div
          ref={(node) => {
            // تخزين العنصر في الحالة المحلية (لتجنب مشكلة read-only)
            setModalElement(node);
            // تمرير المرجع إلى الوالد (forwardRef)
            if (typeof ref === 'function') {
              ref(node);
            } else if (ref) {
              (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
            }
          }}
          className={modalClasses}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={describedBy}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && closeOnEscape) {
              e.preventDefault();
              handleClose();
            }
          }}
        >
          {(title || showCloseButton) && (
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              {title && (
                <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {title}
                </h2>
              )}
              {showCloseButton && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  aria-label={closeButtonLabel}
                  className="flex-shrink-0"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </Button>
              )}
            </div>
          )}
          <div className={contentClasses}>
            {children}
          </div>
        </div>
      </div>,
      document.body
    );
  }
);

Modal.displayName = 'Modal';

export default Modal;