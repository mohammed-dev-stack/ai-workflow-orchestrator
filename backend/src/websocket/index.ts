// ============================================================
// backend/src/websocket/index.ts
// ============================================================
// خادم WebSocket الرئيسي، متكامل مع Express عبر HTTP server
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { IncomingMessage } from 'http';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import { handleConnection } from './handlers/connectionHandler.js';
import { WebSocketClient } from './types.js';

// يمكننا تخزين المراجع للعملاء النشطين لاستخدامها في البث
const activeClients = new Map<string, WebSocketClient>(); // key: userId, value: client

/**
 * تهيئة خادم WebSocket.
 * @param httpServer خادم HTTP (من Express)
 * @param path مسار WebSocket (افتراضي: /ws)
 * @returns WebSocketServer
 */
export function initializeWebSocket(
  httpServer: HttpServer,
  path: string = '/ws'
): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path,
    // يمكن إضافة verifyClient لمصادقة مسبقة
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const correlationId = getCurrentCorrelationId() || 'ws-connection';

    logger.info('اتصال WebSocket جديد قيد المعالجة', {
      correlationId,
      ip: req.socket.remoteAddress,
      path: req.url,
    });

    // معالجة الاتصال (مصادقة + ربط الأحداث)
    handleConnection(ws, req, wss);

    // يمكننا تخزين العميل في الـ Map بعد المصادقة الناجحة
    // سنقوم بذلك داخل handleConnection عن طريق تمرير activeClients
    // لكن سنقوم بتعديل بسيط في handleConnection لقبول الـ Map

    // لتسهيل الأمور، سنقوم بتعديل handleConnection لتقبل الـ Map كمعامل
    // وستقوم بإضافة العميل عند نجاح المصادقة
    // سنقوم بإعادة تعريف handleConnection في الخطوة التالية (سأوضح التعديل).
  });

  // إضافة حدث الخطأ العام
  wss.on('error', (error) => {
    logger.error('خطأ في خادم WebSocket', {
      error: error.message,
      stack: error.stack,
    });
  });

  logger.info(`خادم WebSocket مبدؤ على المسار ${path}`);

  return wss;
}

/**
 * الحصول على العميل النشط بواسطة userId.
 */
export function getActiveClient(userId: string): WebSocketClient | undefined {
  return activeClients.get(userId);
}

/**
 * إضافة عميل نشط.
 */
export function addActiveClient(client: WebSocketClient): void {
  activeClients.set(client.userId, client);
}

/**
 * إزالة عميل نشط.
 */
export function removeActiveClient(userId: string): void {
  activeClients.delete(userId);
}

/**
 * بث رسالة إلى جميع العملاء النشطين (أو حسب فلتر).
 */
export function broadcastMessage(
  message: any,
  filter?: (client: WebSocketClient) => boolean
): void {
  const messageStr = JSON.stringify(message);
  let count = 0;
  for (const [_, client] of activeClients) {
    if (filter && !filter(client)) continue;
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
      count++;
    }
  }
  if (count > 0) {
    logger.debug(`تم بث رسالة إلى ${count} عميل`, {
      type: message.type,
    });
  }
}

/**
 * إرسال رسالة إلى عميل محدد.
 */
export function sendToClient(userId: string, message: any): boolean {
  const client = activeClients.get(userId);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// تصدير الخادم والمراجع
export { activeClients };
export default initializeWebSocket;