// ============================================================
// frontend/src/services/knowledgeBase.api.ts
// ============================================================
// خدمة API لقواعد المعرفة.
// تم إضافة دالة للحذف النهائي (Hard Delete) لدعم الإزالة الكاملة من قاعدة البيانات.
// ============================================================

import { apiClient } from './api.client';
import type {
  KnowledgeBase,
  CreateKnowledgeBaseData,
  UpdateKnowledgeBaseData,
  ListKnowledgeBasesParams,
  ListKnowledgeBasesResponse,
} from '../types/api.types';

/**
 * نقطة النهاية الأساسية لوحدة قواعد المعرفة.
 */
const KB_BASE = '/api/knowledge-bases';

/**
 * خدمة API لقواعد المعرفة.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع دوال CRUD الأساسية مع دعم إلغاء الطلبات.
 */
export const knowledgeBaseApi = {
  /**
   * جلب قائمة قواعد المعرفة (مع الترحيل والبحث).
   */
  list: async (
    params: ListKnowledgeBasesParams,
    options?: { signal?: AbortSignal }
  ): Promise<ListKnowledgeBasesResponse> => {
    const response = await apiClient.get<ListKnowledgeBasesResponse>(KB_BASE, {
      params,
      signal: options?.signal,
    });
    return response.data;
  },

  /**
   * جلب قاعدة معرفة بواسطة المعرف.
   */
  get: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<KnowledgeBase> => {
    const response = await apiClient.get<{ data: KnowledgeBase }>(
      `${KB_BASE}/${id}`,
      { signal: options?.signal }
    );
    return response.data.data;
  },

  /**
   * إنشاء قاعدة معرفة جديدة.
   */
  create: async (
    data: CreateKnowledgeBaseData,
    options?: { signal?: AbortSignal }
  ): Promise<KnowledgeBase> => {
    const response = await apiClient.post<{ data: KnowledgeBase }>(
      KB_BASE,
      data,
      { signal: options?.signal }
    );
    return response.data.data;
  },

  /**
   * تحديث قاعدة معرفة موجودة.
   * ✅ تم إزالة `updatedBy` – غير مطلوب في الخادم بعد الآن.
   */
  update: async (
    id: string,
    data: UpdateKnowledgeBaseData,
    options?: { signal?: AbortSignal }
  ): Promise<KnowledgeBase> => {
    // نقوم بنسخ البيانات وإزالة updatedBy إن وجدت (للتأكد)
    const payload = { ...data };
    delete (payload as any).updatedBy;
    const response = await apiClient.put<{ data: KnowledgeBase }>(
      `${KB_BASE}/${id}`,
      payload,
      { signal: options?.signal }
    );
    return response.data.data;
  },

  /**
   * حذف قاعدة معرفة (حذف ناعم – Soft Delete).
   */
  delete: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<boolean> => {
    await apiClient.delete(`${KB_BASE}/${id}`, { signal: options?.signal });
    return true;
  },

  /**
   * ✅ حذف قاعدة معرفة نهائياً (Hard Delete).
   * ⚠️ هذا الإجراء لا يمكن التراجع عنه ويحذف جميع المستندات المرتبطة.
   */
  hardDelete: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<boolean> => {
    await apiClient.delete(`${KB_BASE}/${id}/hard`, { signal: options?.signal });
    return true;
  },

  /**
   * تفعيل/تعطيل قاعدة معرفة.
   */
  toggleActive: async (
    id: string,
    isActive: boolean,
    options?: { signal?: AbortSignal }
  ): Promise<KnowledgeBase> => {
    const response = await apiClient.put<{ data: KnowledgeBase }>(
      `${KB_BASE}/${id}`,
      { isActive },
      { signal: options?.signal }
    );
    return response.data.data;
  },

  /**
   * استعادة قاعدة معرفة محذوفة.
   */
  restore: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<KnowledgeBase> => {
    const response = await apiClient.post<{ data: KnowledgeBase }>(
      `${KB_BASE}/${id}/restore`,
      {},
      { signal: options?.signal }
    );
    return response.data.data;
  },

  /**
   * الحصول على عدد المستندات في قاعدة معرفة.
   */
  getDocumentCount: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<number> => {
    const response = await apiClient.get<{ data: { count: number } }>(
      `${KB_BASE}/${id}/documents/count`,
      { signal: options?.signal }
    );
    return response.data.data.count;
  },
};

/**
 * تصدير الخدمة كافتراضي.
 */
export default knowledgeBaseApi;