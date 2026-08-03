// ============================================================
// frontend/src/services/analytics.api.ts
// ============================================================
// خدمة API للتحليلات — توفر دوال لجلب مقاييس لوحة التحكم،
// اتجاهات المحادثات، أداء الذكاء الاصطناعي، توزيع المستندات والرسائل،
// ومساحة التخزين.
// ✅ تم إصلاح مشكلة params من خلال استخدام RequestOptions الصحيح.
// ✅ تم توحيد استخراج البيانات من response.data.data.
// ============================================================

import { apiClient } from './api.client';
import type {
  DashboardMetrics,
  ConversationTrends,
  AIPerformance,
  DocumentStatusDistribution,
  MessageRoleDistribution,
  StorageUsage,
} from '../types/api.types';

/**
 * نقطة النهاية الأساسية لوحدة التحليلات.
 */
const ANALYTICS_BASE = '/api/analytics';

/**
 * معاملات استعلام التحليلات الأساسية.
 */
export interface AnalyticsQueryParams {
  /** تاريخ البدء (يُحوَّل إلى ISO string) */
  startDate: Date;
  /** تاريخ الانتهاء (يُحوَّل إلى ISO string) */
  endDate: Date;
  /** ما إذا كان سيتم استخدام التخزين المؤقت (افتراضي: true) */
  useCache?: boolean;
}

/**
 * خيارات إضافية للطلب (signal للإلغاء).
 */
export interface AnalyticsRequestOptions {
  /** إشارة لإلغاء الطلب */
  signal?: AbortSignal;
}

/**
 * خدمة API للتحليلات.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الدوال تستخدم apiClient مع تمرير params و signal.
 */
export const analyticsApi = {
  /**
   * جلب مقاييس لوحة المعلومات.
   * @param params - معاملات الاستعلام (startDate, endDate, useCache)
   * @param options - signal للإلغاء
   * @returns DashboardMetrics
   */
  getDashboardMetrics: async (
    params: AnalyticsQueryParams,
    options?: AnalyticsRequestOptions
  ): Promise<DashboardMetrics> => {
    const response = await apiClient.get(`${ANALYTICS_BASE}/dashboard`, {
      params: {
        startDate: params.startDate.toISOString(),
        endDate: params.endDate.toISOString(),
        useCache: params.useCache !== false ? 'true' : 'false',
      },
      signal: options?.signal,
    });
    // استخراج البيانات من response.data.data (حسب هيكل الخادم)
    return response.data.data;
  },

  /**
   * جلب اتجاهات المحادثات (بيانات المخطط الزمني).
   * @param params - startDate, endDate, groupBy, useCache
   * @param options - signal للإلغاء
   * @returns ConversationTrends
   */
  getConversationTrends: async (
    params: AnalyticsQueryParams & { groupBy?: 'day' | 'week' | 'month' },
    options?: AnalyticsRequestOptions
  ): Promise<ConversationTrends> => {
    const response = await apiClient.get(`${ANALYTICS_BASE}/trends`, {
      params: {
        startDate: params.startDate.toISOString(),
        endDate: params.endDate.toISOString(),
        groupBy: params.groupBy || 'day',
        useCache: params.useCache !== false ? 'true' : 'false',
      },
      signal: options?.signal,
    });
    return response.data.data;
  },

  /**
   * جلب أداء الذكاء الاصطناعي.
   * @param params - startDate, endDate, useCache
   * @param options - signal للإلغاء
   * @returns AIPerformance
   */
  getAIPerformance: async (
    params: AnalyticsQueryParams,
    options?: AnalyticsRequestOptions
  ): Promise<AIPerformance> => {
    const response = await apiClient.get(`${ANALYTICS_BASE}/ai-performance`, {
      params: {
        startDate: params.startDate.toISOString(),
        endDate: params.endDate.toISOString(),
        useCache: params.useCache !== false ? 'true' : 'false',
      },
      signal: options?.signal,
    });
    return response.data.data;
  },

  /**
   * جلب توزيع المستندات حسب الحالة.
   * @param params - startDate, endDate, useCache
   * @param options - signal للإلغاء
   * @returns DocumentStatusDistribution
   */
  getDocumentStatusDistribution: async (
    params: AnalyticsQueryParams,
    options?: AnalyticsRequestOptions
  ): Promise<DocumentStatusDistribution> => {
    const response = await apiClient.get(`${ANALYTICS_BASE}/documents/status`, {
      params: {
        startDate: params.startDate.toISOString(),
        endDate: params.endDate.toISOString(),
        useCache: params.useCache !== false ? 'true' : 'false',
      },
      signal: options?.signal,
    });
    return response.data.data;
  },

  /**
   * جلب توزيع الرسائل حسب الدور (USER / ASSISTANT).
   * @param params - startDate, endDate, useCache
   * @param options - signal للإلغاء
   * @returns MessageRoleDistribution
   */
  getMessageRoleDistribution: async (
    params: AnalyticsQueryParams,
    options?: AnalyticsRequestOptions
  ): Promise<MessageRoleDistribution> => {
    const response = await apiClient.get(`${ANALYTICS_BASE}/messages/roles`, {
      params: {
        startDate: params.startDate.toISOString(),
        endDate: params.endDate.toISOString(),
        useCache: params.useCache !== false ? 'true' : 'false',
      },
      signal: options?.signal,
    });
    return response.data.data;
  },

  /**
   * جلب مساحة التخزين المستخدمة (بالبايت والميجابايت والجيجابايت).
   * @param options - signal للإلغاء
   * @returns StorageUsage
   */
  getStorageUsage: async (
    options?: AnalyticsRequestOptions
  ): Promise<StorageUsage> => {
    const response = await apiClient.get(`${ANALYTICS_BASE}/storage`, {
      params: { useCache: 'true' },
      signal: options?.signal,
    });
    return response.data.data;
  },

  /**
   * مسح التخزين المؤقت للتحليلات (يدوياً) – يتطلب صلاحية ADMIN.
   * @param options - tenantId (اختياري، وإلا سيُستخدم مستأجر المستخدم الحالي)
   * @param options - signal للإلغاء
   * @returns { success: boolean; message: string }
   */
  invalidateCache: async (
    options?: { tenantId?: string; signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string }> => {
    const response = await apiClient.post(
      `${ANALYTICS_BASE}/cache/invalidate`,
      { tenantId: options?.tenantId },
      { signal: options?.signal }
    );
    // نقطة النهاية تعيد مباشرة { success, message } (لا تحتوي على data)
    return response.data;
  },
};

/**
 * تصدير الخدمة كافتراضي.
 */
export default analyticsApi;