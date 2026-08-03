// ============================================================
// frontend/src/components/pages/ChatPage.tsx
// ============================================================
// صفحة المحادثات الرئيسية — تعرض قائمة المحادثات ونافذة المحادثة.
// ✅ تم إصلاح مشكلة TypeScript في ListConversationsParams (إضافة search).
// ✅ تم إصلاح تحويل الرسائل باستخدام createdAt بدلاً من timestamp.
// ✅ تم تحسين معالجة الأخطاء وإعادة المحاولة.
// ✅ تم إضافة دعم للبحث في المحادثات مع debounce.
// ============================================================

import React, { forwardRef, memo, useState, useCallback, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useConversation } from '../../hooks/useConversation';
import { useAuthStore } from '../../stores/auth.store';
import { ChatWindow } from '../organisms/ChatWindow';
import { Button } from '../atoms/Button';
import { Spinner } from '../atoms/Spinner';
import { SearchBar } from '../molecules/SearchBar';
import { Toaster } from '../atoms/Toaster';
import type { ListConversationsParams } from '../../types/api.types';

// ============================================================
// 1. توسيع نوع ListConversationsParams محلياً لدعم البحث
// ============================================================

/**
 * معاملات جلب المحادثات مع دعم البحث.
 * يتم توسيع النوع الأصلي لإضافة `search`.
 */
interface ExtendedListConversationsParams extends ListConversationsParams {
  /** نص البحث في أسماء العملاء أو أرقام الهواتف */
  search?: string;
}

// ============================================================
// 2. تعريف خصائص الصفحة
// ============================================================

export interface ChatPageProps {
  /** معرف فئة CSS إضافية */
  className?: string;
}

// ============================================================
// 3. مكون الصفحة الرئيسي
// ============================================================

/**
 * مكون صفحة المحادثة (ChatPage) — صفحة كاملة.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="main"` للإشارة إلى المحتوى الرئيسي
 * - `aria-label` للتسمية الوصفية
 * - `aria-live="polite"` للرسائل الديناميكية
 * - دعم التنقل عبر لوحة المفاتيح
 */
export const ChatPage = memo(
  forwardRef<HTMLDivElement, ChatPageProps>(({ className }, ref) => {
    const { conversationId } = useParams<{ conversationId?: string }>();
    const navigate = useNavigate();
    const { user } = useAuthStore();

    // حالة البحث عن المحادثات (للقائمة الجانبية)
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // خطاف المحادثة
    const {
      conversations,
      totalConversations,
      currentConversation,
      messages,
      isLoading,
      isStreaming,
      error,
      fetchConversations,
      fetchMessages,
      sendMessage,
      createConversation,
      selectConversation,
      clearError,
      isSending,
    } = useConversation();

    // ============================================================
    // 3.1. إدارة البحث مع debounce
    // ============================================================

    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedSearch(searchQuery);
      }, 500);
      return () => clearTimeout(timer);
    }, [searchQuery]);

    // جلب المحادثات عند تغيير البحث
    useEffect(() => {
      // ✅ استخدام النوع الموسع لتمرير search
      const params: ExtendedListConversationsParams = {
        limit: 20,
        offset: 0,
        search: debouncedSearch || undefined,
      };
      fetchConversations(params);
    }, [debouncedSearch, fetchConversations]);

    // ============================================================
    // 3.2. إدارة المحادثة المحددة
    // ============================================================

    // عند تغيير معرف المحادثة في الرابط، حدد المحادثة
    useEffect(() => {
      if (conversationId) {
        selectConversation(conversationId);
      }
    }, [conversationId, selectConversation]);

    // جلب الرسائل عند تغيير المحادثة المحددة
    useEffect(() => {
      if (currentConversation) {
        fetchMessages(currentConversation.id);
      }
    }, [currentConversation, fetchMessages]);

    // ============================================================
    // 3.3. معالجات الأحداث (Event Handlers)
    // ============================================================

    // إنشاء محادثة جديدة
    const handleNewConversation = useCallback(async () => {
      const newConv = await createConversation({
        phoneNumberId: 'new-' + Date.now(), // مؤقت، سيتم استبداله برقم حقيقي
        customerName: 'عميل جديد',
      });
      if (newConv) {
        navigate(`/chat/${newConv.id}`);
      }
    }, [createConversation, navigate]);

    // إرسال رسالة
    const handleSendMessage = useCallback(
      async (message: string) => {
        if (currentConversation) {
          await sendMessage(currentConversation.id, message);
        }
      },
      [currentConversation, sendMessage]
    );

    // النقر على سؤال مقترح
    const handleSuggestedQuestion = useCallback(
      (question: string) => {
        if (currentConversation) {
          sendMessage(currentConversation.id, question);
        }
      },
      [currentConversation, sendMessage]
    );

    // اختيار محادثة من القائمة
    const handleSelectConversation = useCallback(
      (id: string) => {
        navigate(`/chat/${id}`);
      },
      [navigate]
    );

    // إعادة محاولة تحميل المحادثات
    const handleRetry = useCallback(() => {
      const params: ExtendedListConversationsParams = {
        limit: 20,
        offset: 0,
        search: debouncedSearch || undefined,
      };
      fetchConversations(params);
      clearError();
    }, [debouncedSearch, fetchConversations, clearError]);

    // ============================================================
    // 3.4. تحويل الرسائل إلى تنسيق ChatBubbleProps
    // ✅ استخدام createdAt بدلاً من timestamp
    // ============================================================

    const chatMessages = useMemo(() => {
      return messages.map((msg) => ({
        id: msg.id,
        content: msg.content,
        role: msg.role as 'USER' | 'ASSISTANT' | 'SYSTEM',
        timestamp: msg.createdAt, // ✅ استخدام createdAt كـ timestamp
        senderName: msg.sentBy === 'system' ? 'النظام' : msg.sentBy || 'غير معروف',
        isStreaming: false,
        citations: msg.metadata?.citations || [],
        suggestedQuestions: msg.metadata?.suggestedQuestions || [],
        hasError: false,
      }));
    }, [messages]);

    // ============================================================
    // 3.5. حالات العرض (Loading, Error, Empty)
    // ============================================================

    // حالة التحميل الأولي
    if (isLoading && !currentConversation && conversations.length === 0) {
      return (
        <div
          ref={ref}
          className="flex items-center justify-center min-h-[400px] w-full"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex flex-col items-center gap-4">
            <Spinner size="lg" variant="primary" />
            <p className="text-gray-500 dark:text-gray-400">جاري تحميل المحادثات...</p>
          </div>
        </div>
      );
    }

    // حالة الخطأ
    if (error && !currentConversation && conversations.length === 0) {
      return (
        <div
          ref={ref}
          className={clsx(
            'flex flex-col items-center justify-center min-h-[400px] w-full p-8',
            'bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800'
          )}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <svg
            className="w-12 h-12 text-red-500 dark:text-red-400 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
            فشل تحميل المحادثات
          </h3>
          <p className="text-sm text-red-600 dark:text-red-300 mb-4 text-center max-w-md">
            {error}
          </p>
          <Button variant="primary" onClick={handleRetry}>
            إعادة المحاولة
          </Button>
        </div>
      );
    }

    // ============================================================
    // 3.6. العرض الرئيسي
    // ============================================================

    return (
      <div
        ref={ref}
        className={clsx('flex flex-col h-full', className)}
        role="main"
        aria-label="صفحة المحادثات"
      >
        {/* رأس الصفحة */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              المحادثات
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              تواصل مع العملاء عبر WhatsApp
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={handleNewConversation}
              aria-label="بدء محادثة جديدة"
            >
              <svg
                className="w-5 h-5 ml-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              محادثة جديدة
            </Button>
          </div>
        </div>

        {/* تخطيط ثنائي الأعمدة (قائمة المحادثات + نافذة المحادثة) */}
        <div className="flex flex-1 gap-4 pt-4 overflow-hidden">
          {/* القائمة الجانبية للمحادثات */}
          <aside
            className={clsx(
              'flex-shrink-0 w-72 flex flex-col gap-3',
              'bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3',
              'overflow-hidden'
            )}
            aria-label="قائمة المحادثات"
          >
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="ابحث عن محادثة..."
              isLoading={isLoading}
              fullWidth
              size="sm"
              aria-label="البحث في المحادثات"
            />

            <div className="flex-1 overflow-y-auto space-y-1.5">
              {conversations.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
                  {searchQuery ? 'لا توجد نتائج للبحث' : 'لا توجد محادثات بعد'}
                </div>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv.id)}
                    className={clsx(
                      'w-full text-right p-3 rounded-lg transition-all duration-200',
                      'hover:bg-gray-50 dark:hover:bg-gray-700',
                      'focus:outline-none focus:ring-2 focus:ring-blue-500',
                      currentConversation?.id === conv.id
                        ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500'
                        : 'bg-transparent'
                    )}
                    aria-current={currentConversation?.id === conv.id ? 'page' : undefined}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                        {conv.customerName || conv.phoneNumberId || 'محادثة'}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                        {conv.messageCount || 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {conv.status === 'ACTIVE'
                          ? 'نشطة'
                          : conv.status === 'CLOSED'
                            ? 'مغلقة'
                            : 'مؤرشفة'}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(conv.updatedAt).toLocaleDateString('ar-SA')}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {totalConversations > conversations.length && (
              <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">
                عرض {conversations.length} من {totalConversations}
              </div>
            )}
          </aside>

          {/* نافذة المحادثة */}
          <div className="flex-1 min-w-0">
            {currentConversation ? (
              <ChatWindow
                messages={chatMessages}
                isLoading={isLoading && messages.length === 0}
                isStreaming={isStreaming}
                isActive={currentConversation.status === 'ACTIVE'}
                conversationName={
                  currentConversation.customerName ||
                  currentConversation.phoneNumberId ||
                  'محادثة'
                }
                totalMessages={currentConversation.messageCount || 0}
                canSend={true}
                onSendMessage={handleSendMessage}
                onSuggestedQuestionClick={handleSuggestedQuestion}
                onScrollTop={() => {
                  // يمكن إضافة تحميل تلقائي للرسائل القديمة هنا
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-center">
                  <svg
                    className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                  <p className="text-gray-500 dark:text-gray-400">اختر محادثة من القائمة</p>
                  <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                    أو ابدأ محادثة جديدة
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <Toaster position="top-right" />
      </div>
    );
  })
);

ChatPage.displayName = 'ChatPage';

export default ChatPage;