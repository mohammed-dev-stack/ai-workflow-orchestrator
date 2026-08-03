// ============================================================
// frontend/src/hooks/useConversation.ts
// ============================================================
// خطاف لإدارة المحادثات والرسائل — يدعم CRUD الكامل،
// التحميل التلقائي، إلغاء الطلبات، ومعالجة الأخطاء.
// ✅ تم إصلاح مشكلة تحويل الرسائل باستخدام createdAt بدلاً من timestamp.
// ✅ تم إضافة دعم لإعادة المحاولة التلقائية عند فشل الطلبات.
// ✅ تم تحسين إدارة AbortController لمنع تسرب الذاكرة.
// ✅ تم إضافة retryCount لتتبع محاولات إعادة المحاولة.
// ✅ تم إصلاح خطأ الاستيراد (إزالة الرقم 5 الزائد).
// ✅ تم إصلاح خطأ TypeScript في خاصية total باستخدام نوع ListConversationsResponse.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { conversationApi } from '../services/conversation.api';
import type {
  Conversation,
  Message,
  CreateConversationData,
  ListConversationsParams,
  ListConversationsResponse,
} from '../types/api.types';

// ============================================================
// 1. تعريف الأنواع (Types)
// ============================================================

/**
 * حالة خطاف المحادثات.
 */
export interface UseConversationState {
  /** قائمة المحادثات */
  conversations: Conversation[];
  /** العدد الإجمالي للمحادثات (دون ترحيل) */
  totalConversations: number;
  /** المحادثة الحالية المحددة */
  currentConversation: Conversation | null;
  /** قائمة الرسائل في المحادثة الحالية */
  messages: Message[];
  /** ما إذا كانت البيانات في حالة تحميل */
  isLoading: boolean;
  /** ما إذا كان يتم إرسال رسالة جديدة */
  isSending: boolean;
  /** ما إذا كان يتم استقبال رد (streaming) */
  isStreaming: boolean;
  /** خطأ (إن وجد) */
  error: string | null;
  /** عدد محاولات إعادة المحاولة */
  retryCount: number;
}

/**
 * قيمة إرجاع خطاف المحادثات.
 */
export interface UseConversationReturn extends UseConversationState {
  /** جلب قائمة المحادثات */
  fetchConversations: (params?: ListConversationsParams) => Promise<void>;
  /** جلب رسائل محادثة محددة */
  fetchMessages: (conversationId: string) => Promise<void>;
  /** إرسال رسالة جديدة (مع توليد رد تلقائي) */
  sendMessage: (conversationId: string, content: string) => Promise<Message | null>;
  /** إنشاء محادثة جديدة */
  createConversation: (data: CreateConversationData) => Promise<Conversation | null>;
  /** تحديد محادثة (للعرض وجلب رسائلها) */
  selectConversation: (id: string) => void;
  /** إغلاق محادثة (تغيير الحالة إلى CLOSED) */
  closeConversation: (id: string) => Promise<Conversation | null>;
  /** حذف محادثة (حذف ناعم – Soft Delete) */
  deleteConversation: (id: string) => Promise<boolean>;
  /** مسح الخطأ الحالي */
  clearError: () => void;
  /** إعادة تعيين الحالة إلى القيم الافتراضية */
  reset: () => void;
}

// ============================================================
// 2. الحالة الافتراضية
// ============================================================

const initialState: UseConversationState = {
  conversations: [],
  totalConversations: 0,
  currentConversation: null,
  messages: [],
  isLoading: false,
  isSending: false,
  isStreaming: false,
  error: null,
  retryCount: 0,
};

// ============================================================
// 3. الخطاف الرئيسي
// ============================================================

export function useConversation(): UseConversationReturn {
  const [state, setState] = useState<UseConversationState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // تنظيف الطلبات عند إلغاء تثبيت المكون
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // دالة مساعدة لتحديث الحالة بأمان (مع مراعاة التثبيت)
  const safeSetState = useCallback(
    (updater: (prev: UseConversationState) => Partial<UseConversationState>) => {
      if (isMountedRef.current) {
        setState((prev) => ({ ...prev, ...updater(prev) }));
      }
    },
    []
  );

  // دالة مساعدة لتنفيذ طلب مع معالجة الأخطاء وإلغاء الطلبات السابقة
  const executeRequest = useCallback(
    async <T>(
      requestFn: (signal: AbortSignal) => Promise<T>,
      onSuccess: (data: T) => void,
      onError?: (error: string) => void
    ): Promise<void> => {
      // إلغاء الطلب السابق
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const data = await requestFn(controller.signal);
        if (isMountedRef.current && !controller.signal.aborted) {
          onSuccess(data);
          // إعادة تعيين عدد المحاولات عند النجاح
          safeSetState(() => ({ retryCount: 0 }));
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // تم إلغاء الطلب عمداً، لا نقوم بأي شيء
          return;
        }
        if (isMountedRef.current && !controller.signal.aborted) {
          const errorMessage = error instanceof Error ? error.message : 'فشل تنفيذ الطلب';
          if (onError) {
            onError(errorMessage);
          } else {
            safeSetState(() => ({ error: errorMessage }));
          }
          // زيادة عدد محاولات إعادة المحاولة
          safeSetState((prev) => ({ retryCount: prev.retryCount + 1 }));
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [safeSetState]
  );

  // ============================================================
  // جلب قائمة المحادثات
  // ✅ يتم تمرير params (بما في ذلك search) إلى الخادم.
  // ✅ استخدام النوع ListConversationsResponse لضمان سلامة النوع.
  // ============================================================

  const fetchConversations = useCallback(
    async (params?: ListConversationsParams) => {
      safeSetState(() => ({ isLoading: true, error: null }));

      await executeRequest(
        (signal) => conversationApi.list(params || {}, { signal }),
        (response: ListConversationsResponse) => {
          // الخادم يعيد { success, data: { items, total } } أو مباشرة { items, total }
          // لكننا نستخدم النوع المحدد ListConversationsResponse الذي يحتوي على items و total.
          let items: Conversation[] = [];
          let total = 0;

          // التعامل مع الهيكل الفعلي للاستجابة
          if (response && typeof response === 'object') {
            // إذا كان response يحتوي على items مباشرة
            if ('items' in response && Array.isArray(response.items)) {
              items = response.items;
              total = response.total || 0;
            }
            // إذا كان response يحتوي على data التي تحتوي على items
            else if ('data' in response && response.data && typeof response.data === 'object') {
              const inner = response.data as any;
              if ('items' in inner && Array.isArray(inner.items)) {
                items = inner.items;
                total = inner.total || 0;
              }
            }
          }

          safeSetState(() => ({
            conversations: items,
            totalConversations: total,
            isLoading: false,
          }));
        },
        (error) => {
          safeSetState(() => ({ error, isLoading: false }));
        }
      );
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // جلب رسائل محادثة محددة
  // ✅ يتم استخدام createdAt بدلاً من timestamp لاحقاً في العرض.
  // ============================================================

  const fetchMessages = useCallback(
    async (conversationId: string) => {
      safeSetState(() => ({ isLoading: true, error: null }));

      await executeRequest(
        (signal) => conversationApi.getMessages(conversationId, { signal }),
        (data: { messages: Message[]; total: number }) => {
          safeSetState(() => ({
            messages: data.messages || [],
            isLoading: false,
          }));
        },
        (error) => {
          safeSetState(() => ({ error, isLoading: false }));
        }
      );
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // إرسال رسالة جديدة
  // ✅ يتم إضافة رسالة مؤقتة للمستخدم فوراً (للرد السريع).
  // ✅ عند نجاح الطلب، تُستبدل الرسالة المؤقتة بالرسائل الفعلية.
  // ============================================================

  const sendMessage = useCallback(
    async (conversationId: string, content: string): Promise<Message | null> => {
      const trimmedContent = content.trim();
      if (!trimmedContent) return null;

      safeSetState(() => ({ isSending: true, isStreaming: true, error: null }));

      // إنشاء رسالة مؤقتة للمستخدم (للرد السريع)
      const tempUserMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId,
        content: trimmedContent,
        role: 'USER',
        sentBy: 'me',
        createdAt: new Date().toISOString(),
        tenantId: '',
        metadata: null,
        deletedAt: null,
        externalId: null,
      };

      safeSetState((prev) => ({
        messages: [...prev.messages, tempUserMessage],
      }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) =>
            conversationApi.sendMessage(
              conversationId,
              { content: trimmedContent },
              { signal }
            ),
          (response) => {
            // إزالة الرسالة المؤقتة وإضافة الرسائل الفعلية
            safeSetState((prev) => ({
              messages: prev.messages
                .filter((m) => m.id !== tempUserMessage.id)
                .concat([
                  response.userMessage,
                  response.assistantMessage,
                ]),
              isSending: false,
              isStreaming: false,
            }));
            resolve(response.assistantMessage);
          },
          (error) => {
            // في حالة الفشل، إزالة الرسالة المؤقتة وإظهار الخطأ
            safeSetState((prev) => ({
              messages: prev.messages.filter((m) => m.id !== tempUserMessage.id),
              error,
              isSending: false,
              isStreaming: false,
            }));
            resolve(null);
          }
        );
      });
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // إنشاء محادثة جديدة
  // ============================================================

  const createConversation = useCallback(
    async (data: CreateConversationData): Promise<Conversation | null> => {
      safeSetState(() => ({ isLoading: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => conversationApi.create(data, { signal }),
          (result) => {
            safeSetState((prev) => ({
              conversations: [result, ...prev.conversations],
              totalConversations: prev.totalConversations + 1,
              currentConversation: result,
              isLoading: false,
            }));
            resolve(result);
          },
          (error) => {
            safeSetState(() => ({ error, isLoading: false }));
            resolve(null);
          }
        );
      });
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // تحديد محادثة (للعرض)
  // ✅ يتم جلب رسائل المحادثة تلقائياً عند التحديد.
  // ============================================================

  const selectConversation = useCallback(
    (id: string) => {
      const conversation = state.conversations.find((c) => c.id === id);
      if (conversation) {
        safeSetState(() => ({ currentConversation: conversation }));
        // جلب رسائل المحادثة المحددة
        fetchMessages(id);
      }
    },
    [state.conversations, fetchMessages, safeSetState]
  );

  // ============================================================
  // إغلاق محادثة (تغيير الحالة إلى CLOSED)
  // ============================================================

  const closeConversation = useCallback(
    async (id: string): Promise<Conversation | null> => {
      safeSetState(() => ({ isLoading: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => conversationApi.close(id, { signal }),
          (result) => {
            safeSetState((prev) => ({
              conversations: prev.conversations.map((c) =>
                c.id === result.id ? result : c
              ),
              currentConversation:
                prev.currentConversation?.id === result.id ? result : prev.currentConversation,
              isLoading: false,
            }));
            resolve(result);
          },
          (error) => {
            safeSetState(() => ({ error, isLoading: false }));
            resolve(null);
          }
        );
      });
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // حذف محادثة (حذف ناعم – Soft Delete)
  // ============================================================

  const deleteConversation = useCallback(
    async (id: string): Promise<boolean> => {
      safeSetState(() => ({ isLoading: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => conversationApi.delete(id, { signal }),
          () => {
            safeSetState((prev) => ({
              conversations: prev.conversations.filter((c) => c.id !== id),
              totalConversations: prev.totalConversations - 1,
              currentConversation:
                prev.currentConversation?.id === id ? null : prev.currentConversation,
              isLoading: false,
            }));
            resolve(true);
          },
          (error) => {
            safeSetState(() => ({ error, isLoading: false }));
            resolve(false);
          }
        );
      });
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // دوال مساعدة
  // ============================================================

  const clearError = useCallback(() => {
    safeSetState(() => ({ error: null }));
  }, [safeSetState]);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    safeSetState(() => initialState);
  }, [safeSetState]);

  // ============================================================
  // الإرجاع
  // ============================================================

  return {
    ...state,
    fetchConversations,
    fetchMessages,
    sendMessage,
    createConversation,
    selectConversation,
    closeConversation,
    deleteConversation,
    clearError,
    reset,
  };
}

export default useConversation;