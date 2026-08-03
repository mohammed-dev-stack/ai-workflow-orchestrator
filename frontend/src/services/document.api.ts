// ============================================================
// frontend/src/services/document.api.ts
// ============================================================
// خدمة API للمستندات – تم إصلاح رفع الملفات بإرسال JSON بدلاً من FormData.
// ============================================================

import { apiClient } from './api.client';
import type {
  Document,
  UploadDocumentData,
  ListDocumentsParams,
  ListDocumentsResponse,
  UpdateDocumentData,
} from '../types/api.types';

const DOC_BASE = '/api/documents';

export const documentApi = {
  list: async (
    params: ListDocumentsParams,
    options?: { signal?: AbortSignal }
  ): Promise<ListDocumentsResponse> => {
    const response = await apiClient.get(DOC_BASE, {
      params,
      signal: options?.signal,
    });
    return response.data;
  },

  get: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<Document> => {
    const response = await apiClient.get(`${DOC_BASE}/${id}`, {
      signal: options?.signal,
    });
    return response.data.data;
  },

  /**
   * رفع مستند جديد.
   * ✅ يتم إرسال البيانات كـ JSON (وليس multipart/form-data).
   * ✅ لا نحتاج إلى إرسال محتوى الملف، فقط بيانات التعريف.
   */
  upload: async (
    data: UploadDocumentData & { file?: File }, // file optional, not used
    options?: { signal?: AbortSignal; onProgress?: (progress: number) => void }
  ): Promise<Document> => {
    // استخراج الحقول المطلوبة
    const fileSize = data.fileSize || data.file?.size || 0;
    const mimeType = data.mimeType || data.file?.type || 'application/octet-stream';
    const storagePath = data.storagePath || `/uploads/${data.fileName}`;

    // بناء جسم الطلب (JSON)
    const payload = {
      knowledgeBaseId: data.knowledgeBaseId,
      fileName: data.fileName,
      fileSize: fileSize,
      mimeType: mimeType,
      storagePath: storagePath,
      description: data.description || '',
      tags: data.tags || [],
      tenantId: data.tenantId || 'default-tenant-id',
      uploadedBy: data.uploadedBy || 'unknown',
      status: 'PENDING', // يمكن تغييره إلى COMPLETED إذا أردت
    };

    // إزالة الحقول غير المعرفة
    Object.keys(payload).forEach((key) => {
      if (payload[key as keyof typeof payload] === undefined) {
        delete payload[key as keyof typeof payload];
      }
    });

    const response = await apiClient.post(DOC_BASE, payload, {
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      // لا حاجة لـ onUploadProgress لأننا لا نرسل ملفاً
    });

    return response.data.data;
  },

  update: async (
    id: string,
    data: UpdateDocumentData,
    options?: { signal?: AbortSignal }
  ): Promise<Document> => {
    const response = await apiClient.put(`${DOC_BASE}/${id}`, data, {
      signal: options?.signal,
    });
    return response.data.data;
  },

  delete: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<boolean> => {
    await apiClient.delete(`${DOC_BASE}/${id}`, { signal: options?.signal });
    return true;
  },

  restore: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<Document> => {
    const response = await apiClient.post(`${DOC_BASE}/${id}/restore`, {}, {
      signal: options?.signal,
    });
    return response.data.data;
  },

  process: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ status: string; message: string }> => {
    const response = await apiClient.post(`${DOC_BASE}/${id}/process`, {}, {
      signal: options?.signal,
    });
    return {
      status: response.data.status || 'PROCESSING',
      message: response.data.message || 'تم بدء المعالجة',
    };
  },

  updateStatus: async (
    id: string,
    status: string,
    errorMessage?: string,
    options?: { signal?: AbortSignal }
  ): Promise<Document> => {
    const response = await apiClient.post(`${DOC_BASE}/${id}/status`, { status, errorMessage }, {
      signal: options?.signal,
    });
    return response.data.data;
  },
};

export default documentApi;