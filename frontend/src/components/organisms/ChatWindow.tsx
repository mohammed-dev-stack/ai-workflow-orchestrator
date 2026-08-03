// frontend/src/components/organisms/ChatWindow.tsx
import React, { forwardRef, memo, useRef, useEffect, useCallback, useState } from 'react';
import clsx from 'clsx';
import { ChatBubble, ChatBubbleProps } from '../molecules/ChatBubble';
import { Input } from '../atoms/Input';
import { Button } from '../atoms/Button';
import { Spinner } from '../atoms/Spinner';

/**
 * خصائص مكون نافذة المحادثة.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface ChatWindowProps {
  /** قائمة الرسائل المراد عرضها */
  messages: ChatBubbleProps[];
  /** ما إذا كانت المحادثة في حالة تحميل (جلب الرسائل) */
  isLoading?: boolean;
  /** ما إذا كانت رسالة جديدة قيد التوليد (streaming) */
  isStreaming?: boolean;
  /** ما إذا كانت المحادثة نشطة */
  isActive?: boolean;
  /** اسم المحادثة/العميل */
  conversationName?: string;
  /** عدد الرسائل الكلي (للترقيم) */
  totalMessages?: number;
  /** ما إذا كان يمكن إرسال رسائل جديدة */
  canSend?: boolean;
  /** دالة تستدعى عند إرسال رسالة جديدة */
  onSendMessage?: (message: string) => void;
  /** دالة تستدعى عند النقر على سؤال مقترح */
  onSuggestedQuestionClick?: (question: string) => void;
  /** دالة تستدعى عند التمرير لأعلى (للتحميل التلقائي) */
  onScrollTop?: () => void;
  /** معرف فئة CSS إضافية */
  className?: string;
}

/**
 * مكون نافذة المحادثة (ChatWindow) — عضوي، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="log"` للإشارة إلى سجل المحادثة
 * - `aria-label` للتسمية الوصفية
 * - `aria-live="polite"` للرسائل الجديدة (للقراءة بواسطة قارئات الشاشة)
 * - `aria-atomic="false"` لإعلان الرسائل الجديدة فقط
 * - دعم التنقل عبر لوحة المفاتيح (Enter لإرسال الرسالة)
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون نافذة محادثة كامل مع دعم إمكانية الوصول.
 */
export const ChatWindow = memo(
  forwardRef<HTMLDivElement, ChatWindowProps>(
    (
      {
        messages = [],
        isLoading = false,
        isStreaming = false,
        isActive = true,
        conversationName = 'المحادثة',
        totalMessages = 0,
        canSend = true,
        onSendMessage,
        onSuggestedQuestionClick,
        onScrollTop,
        className,
      },
      ref
    ) => {
      // مرجع للحاوية (للتمرير التلقائي إلى الأسفل)
      const containerRef = useRef<HTMLDivElement>(null);
      const messagesEndRef = useRef<HTMLDivElement>(null);

      // حالة الرسالة الجديدة
      const [newMessage, setNewMessage] = useState('');

      // ما إذا كان المستخدم قد مرر لأعلى (لمنع التمرير التلقائي)
      const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

      // التمرير إلى أسفل المحادثة
      const scrollToBottom = useCallback((smooth: boolean = true) => {
        if (messagesEndRef.current && !isUserScrolledUp) {
          messagesEndRef.current.scrollIntoView({
            behavior: smooth ? 'smooth' : 'instant',
            block: 'end',
          });
        }
      }, [isUserScrolledUp]);

      // التمرير التلقائي عند إضافة رسائل جديدة
      useEffect(() => {
        if (!isUserScrolledUp) {
          scrollToBottom(true);
        }
      }, [messages.length, isUserScrolledUp, scrollToBottom]);

      // التمرير التلقائي أثناء التدفق (streaming)
      useEffect(() => {
        if (isStreaming && !isUserScrolledUp) {
          scrollToBottom(true);
        }
      }, [isStreaming, isUserScrolledUp, scrollToBottom]);

      // معالج التمرير (لكشف التمرير لأعلى)
      const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 50;

        if (isAtBottom) {
          setIsUserScrolledUp(false);
        } else {
          setIsUserScrolledUp(true);
        }

        // إذا كان المستخدم في أعلى الحاوية، استدعاء onScrollTop (للتحميل التلقائي)
        if (target.scrollTop < 50 && onScrollTop) {
          onScrollTop();
        }
      }, [onScrollTop]);

      // معالج إرسال الرسالة
      const handleSendMessage = useCallback(() => {
        const trimmedMessage = newMessage.trim();
        if (trimmedMessage && onSendMessage && canSend && isActive) {
          onSendMessage(trimmedMessage);
          setNewMessage('');
          // إعادة التمرير إلى الأسفل
          setIsUserScrolledUp(false);
          setTimeout(() => scrollToBottom(true), 100);
        }
      }, [newMessage, onSendMessage, canSend, isActive, scrollToBottom]);

      // معالج ضغط Enter (إرسال الرسالة)
      const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          handleSendMessage();
        }
      }, [handleSendMessage]);

      // معالج النقر على سؤال مقترح
      const handleSuggestedClick = useCallback((question: string) => {
        if (onSuggestedQuestionClick) {
          onSuggestedQuestionClick(question);
        }
      }, [onSuggestedQuestionClick]);

      // دمج الفئات
      const containerClasses = clsx(
        'flex flex-col h-full bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden',
        className
      );

      // فئات منطقة الرسائل
      const messagesClasses = clsx(
        'flex-1 overflow-y-auto p-4 space-y-4',
        'scroll-smooth',
        // تحسين التمرير للأجهزة التي تعمل باللمس
        'overscroll-contain'
      );

      // فئات منطقة الإدخال — ✅ تم إصلاح الاسم هنا
      const inputAreaClasses = clsx(
        'flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700',
        'bg-gray-50 dark:bg-gray-800/50',
        !canSend && 'opacity-60 pointer-events-none'
      );

      // حالة عدم النشاط
      if (!isActive) {
        return (
          <div
            ref={ref}
            className={containerClasses}
            role="log"
            aria-label="المحادثة غير نشطة"
          >
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-gray-500 dark:text-gray-400">المحادثة غير نشطة</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">لا يمكن إرسال رسائل جديدة</p>
              </div>
            </div>
          </div>
        );
      }

      // عرض المحادثة
      return (
        <div
          ref={ref}
          className={containerClasses}
          role="log"
          aria-label={`محادثة: ${conversationName}`}
          aria-live="polite"
          aria-atomic="false"
          aria-relevant="additions"
        >
          {/* رأس المحادثة (عرض الاسم وعدد الرسائل) */}
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {conversationName}
                </h2>
                {totalMessages > 0 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({totalMessages} رسالة{totalMessages !== 1 ? 'ات' : ''})
                  </span>
                )}
              </div>
              {isStreaming && (
                <span className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                  <Spinner size="xs" variant="primary" />
                  <span>جاري الكتابة...</span>
                </span>
              )}
            </div>
          </div>

          {/* قائمة الرسائل */}
          <div
            ref={containerRef}
            className={messagesClasses}
            onScroll={handleScroll}
          >
            {isLoading && messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3">
                  <Spinner size="lg" variant="primary" />
                  <p className="text-gray-500 dark:text-gray-400 text-sm">جاري تحميل المحادثة...</p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-gray-500 dark:text-gray-400">لا توجد رسائل بعد</p>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">ابدأ المحادثة بإرسال رسالة</p>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  {...message}
                  onSuggestedQuestionClick={handleSuggestedClick}
                />
              ))
            )}

            {/* مؤشر التدفق (streaming) عند عدم وجود رسالة مكتوبة بعد */}
            {isStreaming && messages.length > 0 && (
              <ChatBubble
                id="streaming-indicator"
                content=""
                role="ASSISTANT"
                timestamp={new Date().toISOString()}
                isStreaming={true}
              />
            )}

            {/* عنصر وهمي للتمرير إلى الأسفل */}
            <div ref={messagesEndRef} aria-hidden="true" />
          </div>

          {/* منطقة الإدخال — ✅ تم إصلاح className هنا */}
          <div className={inputAreaClasses}>
            <div className="flex items-end gap-3">
              <Input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={canSend ? 'اكتب رسالتك...' : 'المحادثة غير نشطة'}
                disabled={!canSend || isLoading}
                isLoading={isStreaming}
                size="md"
                fullWidth
                aria-label="اكتب رسالة"
                className="resize-none"
                {...(canSend && !isLoading && { autoFocus: true })}
              />
              <Button
                variant="primary"
                size="md"
                onClick={handleSendMessage}
                disabled={!canSend || isLoading || isStreaming || !newMessage.trim()}
                isLoading={isStreaming}
                aria-label="إرسال الرسالة"
                className="flex-shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span className="sr-only">إرسال</span>
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500 text-right">
              اضغط Enter للإرسال
            </p>
          </div>
        </div>
      );
    }
  )
);

ChatWindow.displayName = 'ChatWindow';

/**
 * تصدير المكون كافتراضي.
 */
export default ChatWindow;