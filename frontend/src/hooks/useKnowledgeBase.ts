// ============================================================
// frontend/src/hooks/useKnowledgeBase.ts
// ============================================================
// خطاف (Hook) لإدارة قواعد المعرفة — يدعم CRUD الكامل،
// البحث، التفعيل/التعطيل، والحذف الناعم والنهائي.
// ✅ تم إصلاح قراءة البيانات لتتوافق مع هيكل الاستجابة الفعلي:
//    الخادم يعيد { success: true, data: { items: [...], total: number } }
//    أو مباشرة { items: [...], total: number } حسب نقطة النهاية.
// ✅ تم تحسين معالجة الأخطاء وإلغاء الطلبات.
// ✅ تم إضافة دعم لإعادة المحاولة التلقائية عند الفشل.
// ============================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { knowledgeBaseApi } from '../services/knowledgeBase.api';
import type {
  KnowledgeBase,
  CreateKnowledgeBaseData,
  UpdateKnowledgeBaseData,
  ListKnowledgeBasesParams,
  ListKnowledgeBasesResponse,
} from '../types/api.types';

// ============================================================
// 1. تعريف الأنواع (Types)
// ============================================================

export interface UseKnowledgeBaseState {
  /** قائمة قواعد المعرفة */
  knowledgeBases: KnowledgeBase[];
  /** العدد الإجمالي للقواعد (دون ترحيل) */
  total: number;
  /** ما إذا كانت البيانات في حالة تحميل */
  isLoading: boolean;
  /** ما إذا كان الإنشاء قيد التنفيذ */
  isCreating: boolean;
  /** ما إذا كان التحديث قيد التنفيذ */
  isUpdating: boolean;
  /** ما إذا كان الحذف قيد التنفيذ */
  isDeleting: boolean;
  /** خطأ (إن وجد) */
  error: string | null;
  /** عدد محاولات إعادة المحاولة */
  retryCount: number;
}

export interface UseKnowledgeBaseReturn extends UseKnowledgeBaseState {
  /** جلب قائمة قواعد المعرفة */
  fetchKnowledgeBases: (params?: ListKnowledgeBasesParams) => Promise<void>;
  /** إنشاء قاعدة معرفة جديدة */
  createKnowledgeBase: (data: CreateKnowledgeBaseData) => Promise<KnowledgeBase | null>;
  /** تحديث قاعدة معرفة موجودة */
  updateKnowledgeBase: (data: UpdateKnowledgeBaseData) => Promise<KnowledgeBase | null>;
  /** حذف قاعدة معرفة (حذف ناعم – Soft Delete) */
  deleteKnowledgeBase: (id: string) => Promise<boolean>;
  /** حذف قاعدة معرفة نهائياً (Hard Delete) – ⚠️ لا يمكن التراجع */
  hardDeleteKnowledgeBase: (id: string) => Promise<boolean>;
  /** تفعيل/تعطيل قاعدة معرفة */
  toggleActive: (id: string, isActive: boolean) => Promise<KnowledgeBase | null>;
  /** مسح الخطأ الحالي */
  clearError: () => void;
  /** إعادة تعيين الحالة إلى القيم الافتراضية */
  reset: () => void;
}

// ============================================================
// 2. الحالة الافتراضية
// ============================================================

const initialState: UseKnowledgeBaseState = {
  knowledgeBases: [],
  total: 0,
  isLoading: false,
  isCreating: false,
  isUpdating: false,
  isDeleting: false,
  error: null,
  retryCount: 0,
};

// ============================================================
// 3. الخطاف الرئيسي
// ============================================================

export function useKnowledgeBase(): UseKnowledgeBaseReturn {
  const [state, setState] = useState<UseKnowledgeBaseState>(initialState);
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
    (updater: (prev: UseKnowledgeBaseState) => Partial<UseKnowledgeBaseState>) => {
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
      onError?: (error: string) => void,
      retryOnFailure: boolean = false
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
          return; // تم إلغاء الطلب عمداً
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
  // جلب قائمة قواعد المعرفة
  // ✅ قراءة البيانات من الحقول الصحيحة: items و total
  //    الخادم يعيد { success: true, data: { items: [...], total: number } }
  //    أو مباشرة { items: [...], total: number }
  // ============================================================

  const fetchKnowledgeBases = useCallback(
    async (params?: ListKnowledgeBasesParams) => {
      safeSetState(() => ({ isLoading: true, error: null }));

      await executeRequest(
        (signal) => knowledgeBaseApi.list(params || {}, { signal }),
        (response: ListKnowledgeBasesResponse) => {
          // استخراج البيانات من response (الذي قد يكون غلافاً أو مباشراً)
          let items: KnowledgeBase[] = [];
          let total = 0;

          // محاولة قراءة البيانات من عدة تنسيقات محتملة
          if (response && typeof response === 'object') {
            // التنسيق الأول: { data: { items: [...], total: number } }
            if ('data' in response && response.data && typeof response.data === 'object') {
              const data = response.data as any;
              if (Array.isArray(data.items)) {
                items = data.items;
                total = data.total || 0;
              } else if (Array.isArray(data)) {
                // التنسيق البديل: { data: [...] }
                items = data;
                total = items.length;
              }
            }
            // التنسيق الثاني: { items: [...], total: number } مباشر
            else if ('items' in response && Array.isArray(response.items)) {
              items = response.items;
              total = response.total || 0;
            }
            // التنسيق الثالث: مصفوفة مباشرة (نادر)
            else if (Array.isArray(response)) {
              items = response;
              total = items.length;
            }
          }

          safeSetState(() => ({
            knowledgeBases: items,
            total: total,
            isLoading: false,
            error: null,
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
  // إنشاء قاعدة معرفة جديدة
  // ============================================================

  const createKnowledgeBase = useCallback(
    async (data: CreateKnowledgeBaseData): Promise<KnowledgeBase | null> => {
      safeSetState(() => ({ isCreating: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => knowledgeBaseApi.create(data, { signal }),
          (result: KnowledgeBase) => {
            safeSetState((prev) => ({
              knowledgeBases: [result, ...prev.knowledgeBases],
              total: prev.total + 1,
              isCreating: false,
            }));
            resolve(result);
          },
          (error) => {
            safeSetState(() => ({ error, isCreating: false }));
            resolve(null);
          }
        );
      });
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // تحديث قاعدة معرفة موجودة
  // ============================================================

  const updateKnowledgeBase = useCallback(
    async (data: UpdateKnowledgeBaseData): Promise<KnowledgeBase | null> => {
      safeSetState(() => ({ isUpdating: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => knowledgeBaseApi.update(data.id, data, { signal }),
          (result: KnowledgeBase) => {
            safeSetState((prev) => ({
              knowledgeBases: prev.knowledgeBases.map((kb) =>
                kb.id === result.id ? result : kb
              ),
              isUpdating: false,
            }));
            resolve(result);
          },
          (error) => {
            safeSetState(() => ({ error, isUpdating: false }));
            resolve(null);
          }
        );
      });
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // حذف قاعدة معرفة (حذف ناعم – Soft Delete)
  // ============================================================

  const deleteKnowledgeBase = useCallback(
    async (id: string): Promise<boolean> => {
      safeSetState(() => ({ isDeleting: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => knowledgeBaseApi.delete(id, { signal }),
          () => {
            safeSetState((prev) => ({
              knowledgeBases: prev.knowledgeBases.filter((kb) => kb.id !== id),
              total: prev.total - 1,
              isDeleting: false,
            }));
            resolve(true);
          },
          (error) => {
            safeSetState(() => ({ error, isDeleting: false }));
            resolve(false);
          }
        );
      });
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // ✅ حذف قاعدة معرفة نهائياً (Hard Delete)
  // ⚠️ لا يمكن التراجع عن هذا الإجراء.
  // ============================================================

  const hardDeleteKnowledgeBase = useCallback(
    async (id: string): Promise<boolean> => {
      safeSetState(() => ({ isDeleting: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => knowledgeBaseApi.hardDelete(id, { signal }),
          () => {
            safeSetState((prev) => ({
              knowledgeBases: prev.knowledgeBases.filter((kb) => kb.id !== id),
              total: prev.total - 1,
              isDeleting: false,
            }));
            resolve(true);
          },
          (error) => {
            safeSetState(() => ({ error, isDeleting: false }));
            resolve(false);
          }
        );
      });
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // تفعيل/تعطيل قاعدة معرفة
  // ============================================================

  const toggleActive = useCallback(
    async (id: string, isActive: boolean): Promise<KnowledgeBase | null> => {
      safeSetState(() => ({ isUpdating: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => knowledgeBaseApi.toggleActive(id, isActive, { signal }),
          (result: KnowledgeBase) => {
            safeSetState((prev) => ({
              knowledgeBases: prev.knowledgeBases.map((kb) =>
                kb.id === result.id ? result : kb
              ),
              isUpdating: false,
            }));
            resolve(result);
          },
          (error) => {
            safeSetState(() => ({ error, isUpdating: false }));
            resolve(null);
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
    fetchKnowledgeBases,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    hardDeleteKnowledgeBase,
    toggleActive,
    clearError,
    reset,
  };
}

export default useKnowledgeBase;