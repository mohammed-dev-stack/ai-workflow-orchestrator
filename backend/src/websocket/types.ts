// ============================================================
// backend/src/websocket/types.ts
// ============================================================
// أنواع مشتركة لخادم WebSocket
// ============================================================

import { WebSocket } from 'ws';
import { AuthenticatedUser } from '../middlewares/auth.middleware.js';

/**
 * أنواع الرسائل المرسلة من العميل.
 */
export type ClientMessageType =
  | 'ping'
  | 'message.send'
  | 'conversation.join'
  | 'conversation.leave'
  | 'typing.start'
  | 'typing.stop';

/**
 * أنواع الرسائل المرسلة من الخادم.
 */
export type ServerMessageType =
  | 'pong'
  | 'message.received'
  | 'message.status_update'
  | 'conversation.created'
  | 'conversation.updated'
  | 'document.processed'
  | 'document.failed'
  | 'ai.streaming'
  | 'error';

/**
 * هيكل الرسالة الأساسي (مطابق للعميل).
 */
export interface WebSocketMessage<T = any> {
  type: ClientMessageType | ServerMessageType;
  payload: T;
  timestamp: string;
  correlationId?: string;
}

/**
 * هيكل رسالة ping/pong.
 */
export interface PingPayload {
  timestamp: string;
}

/**
 * هيكل رسالة إرسال رسالة جديدة.
 */
export interface SendMessagePayload {
  conversationId: string;
  content: string;
  knowledgeBaseId?: string;
  contextChunkLimit?: number;
  similarityThreshold?: number;
}

/**
 * هيكل رسالة الانضمام إلى محادثة.
 */
export interface JoinConversationPayload {
  conversationId: string;
}

/**
 * هيكل رسالة حالة الكتابة.
 */
export interface TypingPayload {
  conversationId: string;
  isTyping: boolean;
}

/**
 * معلومات العميل المتصلة.
 */
export interface WebSocketClient extends WebSocket {
  /** معرف المستخدم (من التوكن) */
  userId: string;
  /** معرف المستأجر */
  tenantId: string;
  /** دور المستخدم */
  role: 'ADMIN' | 'AGENT' | 'VIEWER';
  /** المحادثة التي يتابعها العميل حالياً (إن وجدت) */
  currentConversationId?: string;
  /** معرف فريد للاتصال */
  connectionId: string;
  /** هل العميل مصادق؟ */
  isAuthenticated: boolean;
}