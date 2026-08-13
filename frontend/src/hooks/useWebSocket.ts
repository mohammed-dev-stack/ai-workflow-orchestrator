// ============================================================
// frontend/src/hooks/useWebSocket.ts
// ============================================================
// خطاف WebSocket مع دعم إعادة المحاولة، Ping، والإشعارات.
// ✅ تم إضافة مفتاح تشغيل (Feature Toggle) عبر VITE_WS_ENABLED
//    لمنع محاولة الاتصال بخادم غير موجود أثناء التطوير.
// ✅ تم إصلاح نوع الإشعارات: استخدام variant بدلاً من type
//    للتوافق مع نوع Toast الموحد في ui.store.ts.
// ============================================================

import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '../stores/auth.store';
import { useConversation } from './useConversation';
import { useUIStore } from '../stores/ui.store';

// ============================================================
// 1. تعريف آمن لـ import.meta.env (لتجنب أخطاء TypeScript)
// ============================================================

function getEnv(key: string, defaultValue: string): string {
  try {
    // @ts-ignore - تجاوز TypeScript لأن `env` قد لا يكون معرّفاً في بعض البيئات
    const value = import.meta.env?.[key];
    return value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

// ============================================================
// 2. تعريفات الأنواع
// ============================================================

export type WebSocketMessageType =
  | 'message.received'
  | 'message.status_update'
  | 'conversation.created'
  | 'conversation.updated'
  | 'document.processed'
  | 'document.failed'
  | 'ai.streaming'
  | 'ping'
  | 'error';

export interface WebSocketMessage<T = any> {
  type: WebSocketMessageType;
  payload: T;
  timestamp: string;
  correlationId?: string;
}

export interface MessageReceivedPayload {
  conversationId: string;
  message: {
    id: string;
    content: string;
    role: 'USER' | 'ASSISTANT';
    sentBy: string;
    createdAt: string;
    metadata?: Record<string, any>;
  };
}

export interface ConversationCreatedPayload {
  conversation: {
    id: string;
    phoneNumberId: string;
    customerName?: string;
    status: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
    createdAt: string;
  };
}

export interface AIStreamingPayload {
  conversationId: string;
  chunk: string;
  done: boolean;
  fullContent?: string;
  citations?: string[];
  suggestedQuestions?: string[];
}

export interface UseWebSocketOptions {
  url?: string;
  autoConnect?: boolean;
  maxReconnectDelay?: number;
  connectionTimeout?: number;
  pingEnabled?: boolean;
  pingInterval?: number;
  autoReconnect?: boolean;
}

export interface UseWebSocketReturn {
  isConnected: boolean;
  isConnecting: boolean;
  isClosed: boolean;
  lastError: string | null;
  reconnectAttempts: number;
  sendMessage: (type: WebSocketMessageType, payload: any) => boolean;
  ping: () => void;
  reconnect: () => void;
  disconnect: () => void;
}

// ============================================================
// 3. الخطاف الرئيسي (مع مفتاح التشغيل)
// ============================================================

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  // ✅ قراءة متغير البيئة للتحكم في تفعيل WebSocket
  const WS_ENABLED = getEnv('VITE_WS_ENABLED', 'false') === 'true';
  const WS_URL = getEnv('VITE_WS_URL', 'ws://localhost:3000/ws');

  const {
    url = WS_URL,
    autoConnect = true,
    maxReconnectDelay = 30000,
    connectionTimeout = 5000,
    pingEnabled = true,
    pingInterval = 30000,
    autoReconnect = true,
  } = options;

  // مراجع لإدارة الاتصال
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // الحالة
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isClosed, setIsClosed] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // الوصول إلى المخازن
  const { accessToken } = useAuthStore();
  const { addNotification } = useUIStore();

  // ============================================================
  // 4. التعامل مع useConversation
  // ============================================================

  let conversationHook;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    conversationHook = useConversation();
  } catch {
    conversationHook = {};
  }

  const { fetchMessages = () => Promise.resolve() } = conversationHook as any;

  // ============================================================
  // 5. معالجة الرسائل الواردة (تم إصلاح type → variant)
  // ============================================================

  const isDev = getEnv('VITE_ENV', 'development') === 'development';

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WebSocketMessage;

        if (isDev) {
          console.log('[WebSocket] رسالة واردة:', data.type, data);
        }

        switch (data.type) {
          case 'message.received': {
            const payload = data.payload as MessageReceivedPayload;
            // ✅ تم تغيير type → variant
            addNotification({
              variant: 'info',
              message: `رسالة جديدة من ${payload.message.role === 'USER' ? 'عميل' : 'المساعد'}`,
              duration: 5000,
            });
            if (payload.conversationId) {
              fetchMessages(payload.conversationId).catch(() => {});
            }
            break;
          }
          case 'conversation.created': {
            const payload = data.payload as ConversationCreatedPayload;
            // ✅ تم تغيير type → variant
            addNotification({
              variant: 'success',
              message: `محادثة جديدة مع ${payload.conversation.customerName || 'عميل'}`,
              duration: 5000,
            });
            break;
          }
          case 'document.processed': {
            // ✅ تم تغيير type → variant
            addNotification({
              variant: 'success',
              message: 'اكتملت معالجة المستند بنجاح',
              duration: 5000,
            });
            break;
          }
          case 'document.failed': {
            // ✅ تم تغيير type → variant
            addNotification({
              variant: 'error',
              message: `فشلت معالجة المستند: ${data.payload?.error || 'خطأ غير معروف'}`,
              duration: 8000,
            });
            break;
          }
          case 'ai.streaming': {
            const payload = data.payload as AIStreamingPayload;
            if (payload.conversationId && payload.done) {
              fetchMessages(payload.conversationId).catch(() => {});
            }
            break;
          }
          case 'error': {
            console.error('[WebSocket] خطأ من الخادم:', data.payload);
            setLastError(data.payload?.message || 'خطأ من الخادم');
            break;
          }
          default: {
            if (isDev) {
              console.warn('[WebSocket] نوع رسالة غير معروف:', (data as any).type);
            }
          }
        }
      } catch (error) {
        console.error('[WebSocket] فشل تحليل الرسالة:', error);
      }
    },
    [addNotification, fetchMessages, isDev]
  );

  // ============================================================
  // 6. دوال إدارة الاتصال (مع التحقق من WS_ENABLED)
  // ============================================================

  const connect = useCallback(() => {
    // ✅ إذا كان WebSocket معطلاً، لا تفعل شيئاً
    if (!WS_ENABLED) {
      if (isDev) {
        console.log('[WebSocket] ⏸️ WebSocket معطل (VITE_WS_ENABLED=false)');
      }
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    setIsConnecting(true);
    setIsClosed(false);
    setLastError(null);

    const wsUrl = accessToken ? `${url}?token=${encodeURIComponent(accessToken)}` : url;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
      connectionTimeoutRef.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          setLastError('انتهت مهلة الاتصال بالخادم');
          setIsConnecting(false);
        }
      }, connectionTimeout);

      ws.onopen = () => {
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
        }
        setIsConnected(true);
        setIsConnecting(false);
        setIsClosed(false);
        reconnectAttemptsRef.current = 0;
        setReconnectAttempts(0);
        setLastError(null);

        if (isDev) {
          console.log('[WebSocket] ✅ تم الاتصال بالخادم');
        }

        if (pingEnabled) {
          if (pingTimerRef.current) {
            clearInterval(pingTimerRef.current);
          }
          pingTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
            }
          }, pingInterval);
        }
      };

      ws.onmessage = handleMessage;

      ws.onclose = (event) => {
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
        }
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
        }

        setIsConnected(false);
        setIsConnecting(false);
        setIsClosed(true);

        if (isDev) {
          console.log(`[WebSocket] ❌ تم إغلاق الاتصال (الكود: ${event.code})`);
        }

        if (autoReconnect && event.code !== 1000 && event.code !== 1001) {
          const delay = Math.min(Math.pow(2, reconnectAttemptsRef.current) * 1000, maxReconnectDelay);
          reconnectAttemptsRef.current += 1;
          setReconnectAttempts(reconnectAttemptsRef.current);

          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
          }

          if (isDev) {
            console.log(
              `[WebSocket] 🔄 إعادة المحاولة بعد ${delay}ms (محاولة ${reconnectAttemptsRef.current})`
            );
          }

          reconnectTimerRef.current = setTimeout(() => {
            if (autoConnect) {
              connect();
            }
          }, delay);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] خطأ:', error);
        setLastError('حدث خطأ في اتصال WebSocket');
      };
    } catch (error) {
      console.error('[WebSocket] فشل إنشاء الاتصال:', error);
      setLastError('فشل إنشاء اتصال WebSocket');
      setIsConnecting(false);
      setIsClosed(true);
    }
  }, [
    url,
    accessToken,
    connectionTimeout,
    pingEnabled,
    pingInterval,
    maxReconnectDelay,
    autoReconnect,
    autoConnect,
    handleMessage,
    isDev,
    WS_ENABLED,
  ]);

  // ============================================================
  // 7. دوال عامة (لا تتأثر بمفتاح التشغيل، فقط ترسل أوامر)
  // ============================================================

  const sendMessage = useCallback((type: WebSocketMessageType, payload: any): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] لا يمكن إرسال الرسالة، الاتصال غير مفتوح');
      return false;
    }
    try {
      const message: WebSocketMessage = { type, payload, timestamp: new Date().toISOString() };
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[WebSocket] فشل إرسال الرسالة:', error);
      return false;
    }
  }, []);

  const ping = useCallback(() => {
    sendMessage('ping', {});
  }, [sendMessage]);

  const reconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);

    if (wsRef.current) {
      wsRef.current.close(1000, 'إعادة اتصال يدوية');
      wsRef.current = null;
    }

    setIsClosed(true);
    setIsConnected(false);
    setIsConnecting(false);

    setTimeout(() => connect(), 100);
  }, [connect]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
    }

    if (wsRef.current) {
      wsRef.current.close(1000, 'إغلاق يدوي');
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setIsClosed(true);
    setReconnectAttempts(0);
    reconnectAttemptsRef.current = 0;
  }, []);

  // ============================================================
  // 8. دورة الحياة — تعتمد على WS_ENABLED
  // ============================================================

  useEffect(() => {
    // ✅ لن يحاول الاتصال إلا إذا كان WebSocket مفعلاً ولدينا توكن
    if (autoConnect && accessToken && WS_ENABLED) {
      connect();
    } else if (!accessToken && wsRef.current) {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, accessToken, WS_ENABLED, connect, disconnect]);

  // ============================================================
  // 9. الإرجاع
  // ============================================================

  return {
    isConnected,
    isConnecting,
    isClosed,
    lastError,
    reconnectAttempts,
    sendMessage,
    ping,
    reconnect,
    disconnect,
  };
}

export default useWebSocket;