// ============================================================
// frontend/src/hooks/useDocuments.ts
// ============================================================
// خطاف (Hook) لإدارة المستندات.
// تم إصلاح قراءة البيانات لتتوافق مع هيكل الاستجابة الفعلي للخادم.
// الخادم يعيد: { success: true, data: [...], pagination: { total: ... } }
// ✅ تم تصحيح قراءة response.data و response.pagination.total بدلاً من response.items و response.total.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { documentApi } from '../services/document.api';
import type {
  Document,
  UploadDocumentData,
  UpdateDocumentData,
  ListDocumentsParams,
  DocumentStatus,
} from '../types/api.types';

// ============================================================
// 1. تعريف الأنواع (Types)
// ============================================================

/**
 * حالة خطاف المستندات.
 */
export interface UseDocumentsState {
  /** قائمة المستندات */
  documents: Document[];
  /** العدد الإجمالي للمستندات */
  total: number;
  /** ما إذا كانت البيانات في حالة تحميل */
  isLoading: boolean;
  /** ما إذا كان الرفع قيد التنفيذ */
  isUploading: boolean;
  /** ما إذا كان التحديث قيد التنفيذ */
  isUpdating: boolean;
  /** ما إذا كان الحذف قيد التنفيذ */
  isDeleting: boolean;
  /** تقدم رفع الملف (0-100) */
  uploadProgress: number | null;
  /** خطأ (إن وجد) */
  error: string | null;
}

/**
 * قيمة إرجاع خطاف المستندات.
 */
export interface UseDocumentsReturn extends UseDocumentsState {
  /** جلب قائمة المستندات */
  fetchDocuments: (params?: ListDocumentsParams) => Promise<void>;
  /** جلب مستند بواسطة المعرف */
  getDocument: (id: string) => Promise<Document | null>;
  /** رفع مستند جديد */
  uploadDocument: (data: UploadDocumentData & { file: File }) => Promise<Document | null>;
  /** تحديث مستند */
  updateDocument: (id: string, data: UpdateDocumentData) => Promise<Document | null>;
  /** حذف مستند */
  deleteDocument: (id: string) => Promise<boolean>;
  /** استعادة مستند محذوف */
  restoreDocument: (id: string) => Promise<Document | null>;
  /** تشغيل معالجة المستند */
  processDocument: (id: string) => Promise<{ status: string; message: string } | null>;
  /** تحديث حالة المستند (للاستخدام الداخلي) */
  updateDocumentStatus: (id: string, status: DocumentStatus, errorMessage?: string) => Promise<Document | null>;
  /** مسح الخطأ */
  clearError: () => void;
  /** إعادة تعيين الحالة */
  reset: () => void;
}

// ============================================================
// 2. الحالة الافتراضية
// ============================================================

const initialState: UseDocumentsState = {
  documents: [],
  total: 0,
  isLoading: false,
  isUploading: false,
  isUpdating: false,
  isDeleting: false,
  uploadProgress: null,
  error: null,
};

// ============================================================
// 3. الخطاف الرئيسي
// ============================================================

export function useDocuments(): UseDocumentsReturn {
  const [state, setState] = useState<UseDocumentsState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // تنظيف الطلبات عند إلغاء تثبيت المكون
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // دالة مساعدة لتحديث الحالة بأمان
  const safeSetState = useCallback(
    (updater: (prev: UseDocumentsState) => Partial<UseDocumentsState>) => {
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
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const data = await requestFn(controller.signal);
        if (isMountedRef.current && !controller.signal.aborted) {
          onSuccess(data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        if (isMountedRef.current) {
          const errorMessage = error instanceof Error ? error.message : 'فشل تنفيذ الطلب';
          if (onError) {
            onError(errorMessage);
          } else {
            safeSetState(() => ({ error: errorMessage }));
          }
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
  // جلب قائمة المستندات
  // ✅ التصحيح الجوهري: قراءة البيانات من الحقول الصحيحة
  //    الخادم يعيد: { success: true, data: [...], pagination: { total: ... } }
  // ============================================================

  const fetchDocuments = useCallback(
    async (params?: ListDocumentsParams) => {
      safeSetState(() => ({ isLoading: true, error: null }));

      await executeRequest(
        (signal) => documentApi.list(params || {}, { signal }),
        (response: any) => {
          // ✅ استخدام response.data (المصفوفة) و response.pagination.total
          safeSetState(() => ({
            documents: response.data || [],
            total: response.pagination?.total || 0,
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
  // جلب مستند بواسطة المعرف
  // ============================================================

  const getDocument = useCallback(
    async (id: string): Promise<Document | null> => {
      safeSetState(() => ({ isLoading: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => documentApi.get(id, { signal }),
          (data) => {
            safeSetState(() => ({ isLoading: false }));
            resolve(data);
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
  // رفع مستند جديد
  // ============================================================

  const uploadDocument = useCallback(
    async (data: UploadDocumentData & { file: File }): Promise<Document | null> => {
      safeSetState(() => ({
        isUploading: true,
        uploadProgress: 0,
        error: null,
      }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) =>
            documentApi.upload(data, {
              signal,
              onProgress: (progress) => {
                safeSetState(() => ({ uploadProgress: progress }));
              },
            }),
          (result) => {
            safeSetState((prev) => ({
              documents: [result, ...prev.documents],
              total: prev.total + 1,
              isUploading: false,
              uploadProgress: null,
            }));
            resolve(result);
          },
          (error) => {
            safeSetState(() => ({
              error,
              isUploading: false,
              uploadProgress: null,
            }));
            resolve(null);
          }
        );
      });
    },
    [executeRequest, safeSetState]
  );

  // ============================================================
  // تحديث مستند
  // ============================================================

  const updateDocument = useCallback(
    async (id: string, data: UpdateDocumentData): Promise<Document | null> => {
      safeSetState(() => ({ isUpdating: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => documentApi.update(id, data, { signal }),
          (result) => {
            safeSetState((prev) => ({
              documents: prev.documents.map((doc) => (doc.id === result.id ? result : doc)),
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
  // حذف مستند (حذف ناعم – Soft Delete)
  // ============================================================

  const deleteDocument = useCallback(
    async (id: string): Promise<boolean> => {
      safeSetState(() => ({ isDeleting: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => documentApi.delete(id, { signal }),
          () => {
            safeSetState((prev) => ({
              documents: prev.documents.filter((doc) => doc.id !== id),
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
  // استعادة مستند محذوف
  // ============================================================

  const restoreDocument = useCallback(
    async (id: string): Promise<Document | null> => {
      safeSetState(() => ({ isUpdating: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => documentApi.restore(id, { signal }),
          (result) => {
            safeSetState((prev) => ({
              documents: prev.documents.map((doc) => (doc.id === result.id ? result : doc)),
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
  // تشغيل معالجة المستند
  // ============================================================

  const processDocument = useCallback(
    async (id: string): Promise<{ status: string; message: string } | null> => {
      safeSetState(() => ({ isLoading: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => documentApi.process(id, { signal }),
          (result) => {
            // تحديث حالة المستند في القائمة (سيتم تحديثه لاحقاً عبر الجلب)
            safeSetState((prev) => ({
              documents: prev.documents.map((doc) =>
                doc.id === id ? { ...doc, status: 'PROCESSING' as DocumentStatus } : doc
              ),
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
  // تحديث حالة المستند (للاستخدام الداخلي)
  // ============================================================

  const updateDocumentStatus = useCallback(
    async (
      id: string,
      status: DocumentStatus,
      errorMessage?: string
    ): Promise<Document | null> => {
      safeSetState(() => ({ isUpdating: true, error: null }));

      return new Promise((resolve) => {
        executeRequest(
          (signal) => documentApi.updateStatus(id, status, errorMessage, { signal }),
          (result) => {
            safeSetState((prev) => ({
              documents: prev.documents.map((doc) => (doc.id === result.id ? result : doc)),
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
    }
    safeSetState(() => initialState);
  }, [safeSetState]);

  // ============================================================
  // الإرجاع
  // ============================================================

  return {
    ...state,
    fetchDocuments,
    getDocument,
    uploadDocument,
    updateDocument,
    deleteDocument,
    restoreDocument,
    processDocument,
    updateDocumentStatus,
    clearError,
    reset,
  };
}

export default useDocuments;