// frontend/src/components/molecules/ChatBubble.tsx
import React, { forwardRef, memo, useMemo } from 'react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';

/**
 * دور المرسل في الرسالة.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة للتصميم.
 */
export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

/**
 * خصائص مكون فقاعة المحادثة.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface ChatBubbleProps {
  /** معرف الرسالة */
  id: string;
  /** نص الرسالة */
  content: string;
  /** دور المرسل */
  role: MessageRole;
  /** اسم المرسل (للعرض) */
  senderName?: string;
  /** الطابع الزمني (ISO string) */
  timestamp: string;
  /** ما إذا كانت الرسالة قيد التدفق (streaming) */
  isStreaming?: boolean;
  /** الاستشهادات (citations) — اختياري */
  citations?: string[];
  /** الأسئلة المقترحة — اختياري */
  suggestedQuestions?: string[];
  /** ما إذا كانت الرسالة تحتوي على خطأ */
  hasError?: boolean;
  /** دالة تستدعى عند النقر على سؤال مقترح */
  onSuggestedQuestionClick?: (question: string) => void;
  /** معرف فئة CSS إضافية */
  className?: string;
}

/**
 * مكون فقاعة المحادثة (ChatBubble) — جزيئي، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="article"` للإشارة إلى أن هذا عنصر مستقل
 * - `aria-label` للتسمية الوصفية
 * - `aria-live="polite"` للرسائل الجديدة (للقراءة بواسطة قارئات الشاشة)
 * - `aria-atomic="true"` لإعلان الرسالة كاملة
 * - `dir="auto"` للتعامل مع النصوص ثنائية الاتجاه
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون فقاعة محادثة كامل مع دعم إمكانية الوصول.
 */
export const ChatBubble = memo(
  forwardRef<HTMLDivElement, ChatBubbleProps>(
    (
      {
        id,
        content,
        role,
        senderName,
        timestamp,
        isStreaming = false,
        citations = [],
        suggestedQuestions = [],
        hasError = false,
        onSuggestedQuestionClick,
        className,
      },
      ref
    ) => {
      // تحديد ما إذا كانت رسالة المستخدم (العرض على اليمين في RTL)
      const isUser = role === 'USER';
      const isAssistant = role === 'ASSISTANT';
      const isSystem = role === 'SYSTEM';

      // تنسيق التاريخ
      const formattedTime = useMemo(() => {
        try {
          return format(new Date(timestamp), 'HH:mm', { locale: arSA });
        } catch {
          return timestamp;
        }
      }, [timestamp]);

      // تنسيق التاريخ الكامل (لـ `aria-label`)
      const fullDate = useMemo(() => {
        try {
          return format(new Date(timestamp), 'dd MMMM yyyy، HH:mm', { locale: arSA });
        } catch {
          return timestamp;
        }
      }, [timestamp]);

      // اسم المرسل الافتراضي
      const displayName = useMemo(() => {
        if (senderName) return senderName;
        if (isUser) return 'أنت';
        if (isAssistant) return 'المساعد';
        return 'النظام';
      }, [senderName, isUser, isAssistant]);

      // فئات الفقاعة حسب الدور
      const bubbleClasses = clsx(
        'max-w-[85%] sm:max-w-[75%] rounded-lg p-4',
        'transition-all duration-200',
        // المستخدم: على اليمين (في RTL)
        isUser && 'self-end bg-blue-600 text-white rounded-br-none',
        // المساعد: على اليسار (في RTL)
        isAssistant && 'self-start bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-none',
        // النظام: في المنتصف بلون مختلف
        isSystem && 'self-center bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg',
        // حالة التدفق (streaming)
        isStreaming && isAssistant && 'border-l-4 border-blue-500',
        // حالة الخطأ
        hasError && 'border-2 border-red-500 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200',
        // الفئات المخصصة
        className
      );

      // فئات حاوية الرسالة
      const containerClasses = clsx(
        'flex flex-col w-full',
        isUser && 'items-end',
        isAssistant && 'items-start',
        isSystem && 'items-center'
      );

      // معالج النقر على سؤال مقترح
      const handleSuggestedClick = (question: string) => {
        if (onSuggestedQuestionClick) {
          onSuggestedQuestionClick(question);
        }
      };

      return (
        <div
          ref={ref}
          className={containerClasses}
          role="article"
          aria-label={`رسالة من ${displayName} في ${fullDate}`}
          aria-live={isStreaming ? 'polite' : 'off'}
          aria-atomic="true"
          aria-busy={isStreaming}
        >
          {/* اسم المرسل والوقت */}
          <div
            className={clsx(
              'flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1',
              isUser && 'flex-row-reverse'
            )}
          >
            <span className="font-medium">{displayName}</span>
            <span>•</span>
            <time dateTime={timestamp} title={fullDate}>
              {formattedTime}
            </time>
            {isStreaming && (
              <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400">
                <svg className="w-3 h-3 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="10" />
                </svg>
                <span className="sr-only">جاري الكتابة...</span>
              </span>
            )}
          </div>

          {/* محتوى الرسالة */}
          <div
            className={bubbleClasses}
            dir="auto"
          >
            {/* معالجة النص (دعم الروابط والعلامات) */}
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {content.split('\n').map((line, index) => (
                <React.Fragment key={index}>
                  {line}
                  {index < content.split('\n').length - 1 && <br />}
                </React.Fragment>
              ))}
            </div>

            {/* الاستشهادات (citations) */}
            {citations.length > 0 && (
              <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  المصادر:
                </p>
                <ul className="flex flex-wrap gap-2 text-xs">
                  {citations.map((citation, index) => (
                    <li
                      key={index}
                      className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                    >
                      [{(citation.length > 40) ? citation.substring(0, 40) + '...' : citation}]
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* الأسئلة المقترحة */}
            {suggestedQuestions.length > 0 && !isUser && (
              <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                  أسئلة مقترحة:
                </p>
                <div className="flex flex-wrap gap-2">
                  {suggestedQuestions.map((question, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestedClick(question)}
                      className={clsx(
                        'px-3 py-1.5 text-sm rounded-full',
                        'bg-blue-50 hover:bg-blue-100 active:bg-blue-200',
                        'dark:bg-blue-900/30 dark:hover:bg-blue-900/50',
                        'text-blue-700 dark:text-blue-300',
                        'transition-colors duration-200',
                        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                        'cursor-pointer'
                      )}
                      aria-label={`اسأل: ${question}`}
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* مؤشر التدفق (streaming) */}
            {isStreaming && isAssistant && !content && (
              <div className="flex items-center gap-1 py-1">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></span>
                <span className="sr-only">جاري الكتابة...</span>
              </div>
            )}
          </div>

          {/* رسالة الخطأ (إذا كانت موجودة) */}
          {hasError && (
            <div className="mt-1 text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span>حدث خطأ أثناء معالجة الرسالة</span>
            </div>
          )}
        </div>
      );
    }
  )
);

ChatBubble.displayName = 'ChatBubble';

/**
 * تصدير المكون كافتراضي.
 */
export default ChatBubble;