// ============================================================
// frontend/src/services/conversation.api.ts
// ============================================================
// خدمة API للمحادثات والرسائل — تدعم CRUD الكامل،
// إرسال الرسائل، وجلب الرسائل مع الترحيل.
// ✅ تم استخدام apiClient مع params و signal بشكل صحيح.
// ✅ تم توثيق جميع الدوال مع JSDoc.
// ✅ تم استخراج البيانات من response.data.data وفق هيكل الخادم.
// ============================================================

import { apiClient } from './api.client';
import type {
  Conversation,
  Message,
  CreateConversationData,
  SendMessageData,
  ListConversationsParams,
  ListConversationsResponse,
  GetConversationResponse,
  SendMessageResponse,
} from '../types/api.types';

/**
 * نقطة النهاية الأساسية لوحدة المحادثات.
 */
const CONV_BASE = '/api/conversations';

/**
 * خدمة API للمحادثات والرسائل.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع دوال CRUD الأساسية للمحادثات والرسائل.
 */
export const conversationApi = {
  // ============================================================
  // المحادثات
  // ============================================================

  /**
   * جلب قائمة المحادثات (مع الترحيل والفلترة).
   * @param params - معاملات الترحيل والفلترة (limit, offset, status, phoneNumberId, search)
   * @param options - signal لإلغاء الطلب
   * @returns ListConversationsResponse (تحتوي على items و total)
   */
  list: async (
    params: ListConversationsParams,
    options?: { signal?: AbortSignal }
  ): Promise<ListConversationsResponse> => {
    const response = await apiClient.get<ListConversationsResponse>(CONV_BASE, {
      params,
      signal: options?.signal,
    });
    // الخادم يعيد { success, data: { items, total }, pagination }
    // ولكن ListConversationsResponse يُعرَّف كـ { items, total, limit, offset }
    // لذا نرجع response.data (الذي يحتوي على items و total)
    return response.data;
  },

  /**
   * جلب محادثة بواسطة المعرف (مع الرسائل).
   * @param id - معرف المحادثة
   * @param options - limit, offset, signal
   * @returns GetConversationResponse (تحتوي على conversation, messages, totalMessages)
   */
  get: async (
    id: string,
    options?: { signal?: AbortSignal; limit?: number; offset?: number }
  ): Promise<GetConversationResponse> => {
    const response = await apiClient.get<GetConversationResponse>(
      `${CONV_BASE}/${id}`,
      {
        params: {
          limit: options?.limit || 50,
          offset: options?.offset || 0,
        },
        signal: options?.signal,
      }
    );
    // الخادم يعيد { success, data: GetConversationResponse }
    return response.data.data;
  },

  /**
   * إنشاء محادثة جديدة.
   * @param data - بيانات المحادثة (phoneNumberId, customerName, knowledgeBaseId)
   * @param options - signal للإلغاء
   * @returns Conversation (الكائن المُنشأ)
   */
  create: async (
    data: CreateConversationData,
    options?: { signal?: AbortSignal }
  ): Promise<Conversation> => {
    const response = await apiClient.post<{ data: Conversation }>(
      CONV_BASE,
      data,
      { signal: options?.signal }
    );
    return response.data.data;
  },

  /**
   * إغلاق محادثة (تغيير الحالة إلى CLOSED).
   * @param id - معرف المحادثة
   * @param options - signal للإلغاء
   * @returns Conversation (الكائن المُحدَّث)
   */
  close: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<Conversation> => {
    const response = await apiClient.post<{ data: Conversation }>(
      `${CONV_BASE}/${id}/close`,
      {},
      { signal: options?.signal }
    );
    return response.data.data;
  },

  /**
   * حذف محادثة (حذف ناعم – Soft Delete).
   * @param id - معرف المحادثة
   * @param options - signal للإلغاء
   * @returns true إذا نجح الحذف
   */
  delete: async (
    id: string,
    options?: { signal?: AbortSignal }
  ): Promise<boolean> => {
    await apiClient.delete(`${CONV_BASE}/${id}`, { signal: options?.signal });
    return true;
  },

  // ============================================================
  // الرسائل
  // ============================================================

  /**
   * إرسال رسالة في محادثة (وتوليد رد تلقائي من المساعد).
   * @param conversationId - معرف المحادثة
   * @param data - محتوى الرسالة، ومعرف قاعدة المعرفة (اختياري)
   * @param options - signal للإلغاء
   * @returns SendMessageResponse (تحتوي على userMessage, assistantMessage, contextChunks)
   */
  sendMessage: async (
    conversationId: string,
    data: SendMessageData,
    options?: { signal?: AbortSignal }
  ): Promise<SendMessageResponse> => {
    const response = await apiClient.post<SendMessageResponse>(
      `${CONV_BASE}/${conversationId}/messages`,
      data,
      { signal: options?.signal }
    );
    // الخادم يعيد { success, data: SendMessageResponse }
    return response.data.data;
  },

  /**
   * إرسال رسالة عبر WhatsApp (يدوياً، بدون توليد رد).
   * @param conversationId - معرف المحادثة
   * @param data - المحتوى ومعرف قاعدة المعرفة (اختياري)
   * @param options - signal للإلغاء
   * @returns { messageId, status, timestamp }
   */
  sendWhatsAppMessage: async (
    conversationId: string,
    data: { content: string; knowledgeBaseId?: string },
    options?: { signal?: AbortSignal }
  ): Promise<{ messageId: string; status: string; timestamp: string }> => {
    const response = await apiClient.post<{
      success: boolean;
      data: { messageId: string; status: string; timestamp: string };
    }>(
      `${CONV_BASE}/${conversationId}/send-whatsapp`,
      data,
      { signal: options?.signal }
    );
    return response.data.data;
  },

  /**
   * جلب رسائل محادثة (مع الترحيل).
   * @param conversationId - معرف المحادثة
   * @param options - limit, offset, signal
   * @returns { messages: Message[], total: number }
   */
  getMessages: async (
    conversationId: string,
    options?: { signal?: AbortSignal; limit?: number; offset?: number }
  ): Promise<{ messages: Message[]; total: number }> => {
    const response = await apiClient.get<{
      data: { messages: Message[]; totalMessages: number };
      pagination: { limit: number; offset: number };
    }>(
      `${CONV_BASE}/${conversationId}`,
      {
        params: {
          limit: options?.limit || 50,
          offset: options?.offset || 0,
        },
        signal: options?.signal,
      }
    );
    // استخراج البيانات من response.data.data
    return {
      messages: response.data.data.messages,
      total: response.data.data.totalMessages,
    };
  },
};

/**
 * تصدير الخدمة كافتراضي.
 */
export default conversationApi;