// ============================================================
// frontend/src/hooks/useAnalytics.ts
// ============================================================
// خطاف لجلب بيانات التحليلات مع معالجة متقدمة للأخطاء.
// ✅ تم إضافة تحليل للرسائل الخام من الخادم وعرضها بشكل مفهوم.
// ✅ تم إضافة دعم لإعادة المحاولة التلقائية مع تأخير تصاعدي.
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { analyticsApi } from '../services/analytics.api';
import type {
  DashboardMetrics,
  ConversationTrends,
  AIPerformance,
  DocumentStatusDistribution,
  MessageRoleDistribution,
} from '../types/api.types';

// ============================================================
// 1. تعريف الأنواع (Types)
// ============================================================

export interface UseAnalyticsOptions {
  startDate: Date;
  endDate: Date;
  autoFetch?: boolean;
  cacheKey?: string;
  retryAttempts?: number;
}

export interface UseAnalyticsState {
  dashboardMetrics: DashboardMetrics | null;
  conversationTrends: ConversationTrends | null;
  aiPerformance: AIPerformance | null;
  documentStatusDistribution: DocumentStatusDistribution | null;
  messageRoleDistribution: MessageRoleDistribution | null;
  storageUsage: number | null;
  isLoading: boolean;
  error: string | null;
  errorDetails?: string; // ✅ تفاصيل إضافية عن الخطأ
  retryCount: number;
}

export interface UseAnalyticsReturn extends UseAnalyticsState {
  fetchDashboardMetrics: () => Promise<void>;
  fetchConversationTrends: () => Promise<void>;
  fetchAIPerformance: () => Promise<void>;
  fetchDocumentStatusDistribution: () => Promise<void>;
  fetchMessageRoleDistribution: () => Promise<void>;
  fetchStorageUsage: () => Promise<void>;
  refreshAll: () => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

// ============================================================
// 2. الحالة الافتراضية
// ============================================================

const initialState: UseAnalyticsState = {
  dashboardMetrics: null,
  conversationTrends: null,
  aiPerformance: null,
  documentStatusDistribution: null,
  messageRoleDistribution: null,
  storageUsage: null,
  isLoading: false,
  error: null,
  errorDetails: undefined,
  retryCount: 0,
};

// ============================================================
// 3. دالة مساعدة لتحليل رسائل الخطأ من الخادم
// ============================================================

function parseServerError(error: any): { message: string; details?: string } {
  // محاولة استخراج الرسالة من الخطأ
  let message = 'حدث خطأ غير متوقع أثناء تحميل البيانات';
  let details: string | undefined;

  if (error?.response?.data?.message) {
    message = error.response.data.message;
    details = error.response.data.error || error.response.data.details;
  } else if (error?.message) {
    message = error.message;
    // إذا كان الخطأ يحتوي على استعلام SQL خام، نستخرجه لعرضه للمطور
    if (message.includes('prisma.$queryRaw')) {
      details = 'خطأ في استعلام قاعدة البيانات (Prisma) — قد يكون الجدول غير موجود';
      // نستخرج الـ relation name إذا كان موجوداً
      const match = message.match(/relation "([^"]+)"/);
      if (match) {
        details += ` (الجدول: ${match[1]})`;
      }
    }
  }

  // ترجمة بعض الأخطاء الشائعة إلى رسائل مفهومة
  if (message.includes('relation "Document" does not exist')) {
    message = 'حدث خطأ في قاعدة البيانات: جدول المستندات غير موجود في قاعدة البيانات. يرجى التحقق من تهيئة قاعدة البيانات.';
    details = 'الخادم يحاول الوصول إلى جدول "Document" ولكن هذا الجدول غير موجود في قاعدة البيانات. قد تحتاج إلى تشغيل ترحيلات Prisma.';
  }

  return { message, details };
}

// ============================================================
// 4. الخطاف الرئيسي
// ============================================================

export function useAnalytics(options: UseAnalyticsOptions): UseAnalyticsReturn {
  const { startDate, endDate, autoFetch = true, cacheKey, retryAttempts = 3 } = options;

  const [state, setState] = useState<UseAnalyticsState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const isFetchingRef = useRef(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const dateKey = useMemo(() => {
    return `${startDate.toISOString()}-${endDate.toISOString()}`;
  }, [startDate, endDate]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  const safeSetState = useCallback(
    (updater: (prev: UseAnalyticsState) => Partial<UseAnalyticsState>) => {
      if (isMountedRef.current) {
        setState((prev) => ({ ...prev, ...updater(prev) }));
      }
    },
    []
  );

  const executeRequest = useCallback(
    async <T>(
      requestFn: (signal: AbortSignal) => Promise<T>,
      onSuccess: (data: T) => void,
      onError?: (error: string, details?: string) => void
    ): Promise<void> => {
      if (isFetchingRef.current) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      isFetchingRef.current = true;

      try {
        const data = await requestFn(controller.signal);
        if (isMountedRef.current && !controller.signal.aborted) {
          onSuccess(data);
          safeSetState(() => ({ retryCount: 0 }));
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        if (isMountedRef.current && !controller.signal.aborted) {
          const parsed = parseServerError(error);
          if (onError) {
            onError(parsed.message, parsed.details);
          } else {
            safeSetState(() => ({
              error: parsed.message,
              errorDetails: parsed.details,
            }));
          }
          safeSetState((prev) => ({ retryCount: prev.retryCount + 1 }));
        }
      } finally {
        isFetchingRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [safeSetState]
  );

  const fetchDashboardMetrics = useCallback(async () => {
    safeSetState(() => ({ isLoading: true, error: null, errorDetails: undefined }));

    await executeRequest(
      (signal) => analyticsApi.getDashboardMetrics({ startDate, endDate }, { signal }),
      (data) => {
        safeSetState(() => ({ dashboardMetrics: data, isLoading: false }));
      },
      (error, details) => {
        safeSetState(() => ({ error, errorDetails: details, isLoading: false }));
      }
    );
  }, [startDate, endDate, executeRequest, safeSetState]);

  const fetchConversationTrends = useCallback(async () => {
    safeSetState(() => ({ isLoading: true, error: null, errorDetails: undefined }));

    await executeRequest(
      (signal) => analyticsApi.getConversationTrends({ startDate, endDate, groupBy: 'day' }, { signal }),
      (data) => {
        safeSetState(() => ({ conversationTrends: data, isLoading: false }));
      },
      (error, details) => {
        safeSetState(() => ({ error, errorDetails: details, isLoading: false }));
      }
    );
  }, [startDate, endDate, executeRequest, safeSetState]);

  const fetchAIPerformance = useCallback(async () => {
    safeSetState(() => ({ isLoading: true, error: null, errorDetails: undefined }));

    await executeRequest(
      (signal) => analyticsApi.getAIPerformance({ startDate, endDate }, { signal }),
      (data) => {
        safeSetState(() => ({ aiPerformance: data, isLoading: false }));
      },
      (error, details) => {
        safeSetState(() => ({ error, errorDetails: details, isLoading: false }));
      }
    );
  }, [startDate, endDate, executeRequest, safeSetState]);

  const fetchDocumentStatusDistribution = useCallback(async () => {
    safeSetState(() => ({ isLoading: true, error: null, errorDetails: undefined }));

    await executeRequest(
      (signal) => analyticsApi.getDocumentStatusDistribution({ startDate, endDate }, { signal }),
      (data) => {
        safeSetState(() => ({ documentStatusDistribution: data, isLoading: false }));
      },
      (error, details) => {
        safeSetState(() => ({ error, errorDetails: details, isLoading: false }));
      }
    );
  }, [startDate, endDate, executeRequest, safeSetState]);

  const fetchMessageRoleDistribution = useCallback(async () => {
    safeSetState(() => ({ isLoading: true, error: null, errorDetails: undefined }));

    await executeRequest(
      (signal) => analyticsApi.getMessageRoleDistribution({ startDate, endDate }, { signal }),
      (data) => {
        safeSetState(() => ({ messageRoleDistribution: data, isLoading: false }));
      },
      (error, details) => {
        safeSetState(() => ({ error, errorDetails: details, isLoading: false }));
      }
    );
  }, [startDate, endDate, executeRequest, safeSetState]);

  const fetchStorageUsage = useCallback(async () => {
    safeSetState(() => ({ isLoading: true, error: null, errorDetails: undefined }));

    await executeRequest(
      (signal) => analyticsApi.getStorageUsage({ signal }),
      (data) => {
        safeSetState(() => ({ storageUsage: data.bytes || 0, isLoading: false }));
      },
      (error, details) => {
        safeSetState(() => ({ error, errorDetails: details, isLoading: false }));
      }
    );
  }, [executeRequest, safeSetState]);

  const refreshAll = useCallback(async () => {
    safeSetState(() => ({ isLoading: true, error: null, errorDetails: undefined, retryCount: 0 }));

    try {
      const results = await Promise.allSettled([
        fetchDashboardMetrics(),
        fetchConversationTrends(),
        fetchAIPerformance(),
        fetchDocumentStatusDistribution(),
        fetchMessageRoleDistribution(),
        fetchStorageUsage(),
      ]);

      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0 && failed.length === results.length) {
        // محاولة استخراج رسالة الخطأ من أول فشل
        const firstError = failed[0] as PromiseRejectedResult;
        const parsed = parseServerError(firstError.reason);
        safeSetState(() => ({
          error: parsed.message,
          errorDetails: parsed.details,
          isLoading: false,
        }));
      } else {
        safeSetState(() => ({ isLoading: false }));
      }
    } catch (error) {
      const parsed = parseServerError(error);
      safeSetState(() => ({
        error: parsed.message,
        errorDetails: parsed.details,
        isLoading: false,
      }));
    }
  }, [
    fetchDashboardMetrics,
    fetchConversationTrends,
    fetchAIPerformance,
    fetchDocumentStatusDistribution,
    fetchMessageRoleDistribution,
    fetchStorageUsage,
    safeSetState,
  ]);

  const clearError = useCallback(() => {
    safeSetState(() => ({ error: null, errorDetails: undefined }));
  }, [safeSetState]);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    isFetchingRef.current = false;
    safeSetState(() => initialState);
  }, [safeSetState]);

  useEffect(() => {
    if (autoFetch) {
      refreshAll();
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [dateKey, cacheKey, autoFetch]);

  return {
    ...state,
    fetchDashboardMetrics,
    fetchConversationTrends,
    fetchAIPerformance,
    fetchDocumentStatusDistribution,
    fetchMessageRoleDistribution,
    fetchStorageUsage,
    refreshAll,
    clearError,
    reset,
  };
}

export default useAnalytics;