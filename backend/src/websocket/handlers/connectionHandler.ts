// ============================================================
// backend/src/websocket/handlers/connectionHandler.ts (مع التعديل)
// ============================================================

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import url from 'url';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { logger } from '../../observability/logger.js';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware.js';
import { WebSocketClient } from '../types.js';
import { handleMessage } from './messageHandler.js';
import { addActiveClient, removeActiveClient, broadcastMessage } from '../index.js';

export function authenticateConnection(
  ws: WebSocket,
  req: IncomingMessage
): WebSocketClient | null {
  const correlationId = getCurrentCorrelationId() || 'ws-auth';
  const parsedUrl = url.parse(req.url || '', true);
  const token = parsedUrl.query.token as string | undefined;

  if (!token) {
    logger.warn('محاولة اتصال WebSocket بدون توكن', {
      correlationId,
      ip: req.socket.remoteAddress,
    });
    ws.close(1008, 'Unauthorized: token required');
    return null;
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as any;
    if (!decoded.userId || !decoded.tenantId || !decoded.role) {
      ws.close(1008, 'Invalid token: missing fields');
      return null;
    }
    const client = ws as WebSocketClient;
    client.userId = decoded.userId;
    client.tenantId = decoded.tenantId;
    client.role = decoded.role;
    client.connectionId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    client.isAuthenticated = true;
    client.currentConversationId = undefined;
    logger.info('تمت مصادقة اتصال WebSocket', {
      correlationId,
      userId: client.userId,
      tenantId: client.tenantId,
    });
    return client;
  } catch (error) {
    let message = 'Invalid token';
    if (error instanceof jwt.TokenExpiredError) message = 'Token expired';
    ws.close(1008, message);
    return null;
  }
}

export function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  wss: WebSocketServer
): void {
  const correlationId = getCurrentCorrelationId() || 'ws-connection';

  const client = authenticateConnection(ws, req);
  if (!client) return;

  // إضافة العميل إلى الخريطة النشطة
  addActiveClient(client);

  // إرسال ترحيب
  client.send(
    JSON.stringify({
      type: 'conversation.created',
      payload: {
        conversation: {
          id: 'system-welcome',
          phoneNumberId: 'system',
          customerName: 'النظام',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
        },
      },
      timestamp: new Date().toISOString(),
      correlationId,
    })
  );

  // معالج الرسائل
  client.on('message', async (data: Buffer) => {
    try {
      await handleMessage(client, data.toString(), wss);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown';
      client.send(
        JSON.stringify({
          type: 'error',
          payload: { message: 'Internal server error', error: errorMsg },
          timestamp: new Date().toISOString(),
          correlationId,
        })
      );
    }
  });

  // معالج الإغلاق
  client.on('close', (code, reason) => {
    removeActiveClient(client.userId);
    logger.info('تم إغلاق اتصال WebSocket', {
      correlationId,
      userId: client.userId,
      connectionId: client.connectionId,
      code,
      reason: reason.toString(),
    });
  });

  client.on('error', (error) => {
    logger.error('خطأ في اتصال WebSocket', {
      correlationId,
      userId: client.userId,
      error: error.message,
    });
  });
}