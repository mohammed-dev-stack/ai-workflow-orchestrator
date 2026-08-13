// ============================================================
// backend/src/websocket/handlers/messageHandler.ts
// ============================================================
// معالج الرسائل الواردة من العملاء
// ============================================================

import { WebSocketServer } from 'ws';
import { logger } from '../../observability/logger.js';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware.js';
import {
  WebSocketClient,
  WebSocketMessage,
  SendMessagePayload,
  JoinConversationPayload,
  PingPayload,
  TypingPayload,
} from '../types.js';

// سيتم استيراد الخدمات لاحقاً (ChatService, ConversationService)
// سنقوم بتمريرها عبر حقن التبعيات (Dependency Injection)
import { ChatService } from '../../services/chat.service.js';
import { WhatsAppService } from '../../services/whatsapp.service.js';
// سنحتاج إلى إنشاء مثيلات الخدمات أو استلامها كمعاملات.

/**
 * معالج الرسائل الواردة.
 * يُصنف الرسالة حسب نوعها وينادي الدالة المناسبة.
 */
export async function handleMessage(
  client: WebSocketClient,
  messageStr: string,
  wss: WebSocketServer,
  // يمكن حقن الخدمات هنا
  chatService?: ChatService,
  whatsappService?: WhatsAppService
): Promise<void> {
  const correlationId = getCurrentCorrelationId() || 'ws-handle';

  try {
    const data = JSON.parse(messageStr) as WebSocketMessage;
    const { type, payload, timestamp, correlationId: msgCorrelationId } = data;

    // استخدام correlationId من الرسالة إن وجد، وإلا ننشئ واحداً
    const cid = msgCorrelationId || correlationId;

    // تأكد من أن العميل مصادق
    if (!client.isAuthenticated) {
      client.send(
        JSON.stringify({
          type: 'error',
          payload: { message: 'Not authenticated' },
          timestamp: new Date().toISOString(),
          correlationId: cid,
        })
      );
      return;
    }

    logger.debug('استلام رسالة WebSocket', {
      correlationId: cid,
      userId: client.userId,
      type,
      conversationId: payload?.conversationId,
    });

    switch (type) {
      case 'ping': {
        const pingPayload = payload as PingPayload;
        client.send(
          JSON.stringify({
            type: 'pong',
            payload: { timestamp: new Date().toISOString() },
            timestamp: new Date().toISOString(),
            correlationId: cid,
          })
        );
        break;
      }

      case 'message.send': {
        const sendPayload = payload as SendMessagePayload;
        if (!sendPayload.conversationId || !sendPayload.content) {
          client.send(
            JSON.stringify({
              type: 'error',
              payload: { message: 'Missing conversationId or content' },
              timestamp: new Date().toISOString(),
              correlationId: cid,
            })
          );
          return;
        }

        if (!chatService) {
          logger.error('ChatService غير متاح لمعالجة الرسالة', { correlationId: cid });
          client.send(
            JSON.stringify({
              type: 'error',
              payload: { message: 'Service unavailable' },
              timestamp: new Date().toISOString(),
              correlationId: cid,
            })
          );
          return;
        }

        try {
          // استخدام ChatService لإرسال الرسالة وتوليد الرد
          const result = await chatService.sendMessage({
            conversationId: sendPayload.conversationId,
            tenantId: client.tenantId,
            content: sendPayload.content,
            role: 'USER',
            sentBy: client.userId,
            knowledgeBaseId: sendPayload.knowledgeBaseId,
            contextChunkLimit: sendPayload.contextChunkLimit || 5,
            similarityThreshold: sendPayload.similarityThreshold || 0.7,
            idempotencyKey: `ws-${client.connectionId}-${Date.now()}`,
          });

          // إرسال رسالة العميل إلى جميع العملاء الذين يتابعون نفس المحادثة (اختياري)
          // نرسل رسالة إلى العميل المرسل فقط (لأن الخادم سيبثها لمن يحتاج)
          // يمكن البث عبر wss.clients

          // نرسل تأكيداً بالرسالة المرسلة ورد المساعد
          client.send(
            JSON.stringify({
              type: 'message.received',
              payload: {
                conversationId: sendPayload.conversationId,
                message: {
                  id: result.userMessage.id,
                  content: result.userMessage.content,
                  role: 'USER',
                  sentBy: client.userId,
                  createdAt: result.userMessage.createdAt,
                },
              },
              timestamp: new Date().toISOString(),
              correlationId: cid,
            })
          );

          // نرسل رد المساعد كرسالة منفصلة
          client.send(
            JSON.stringify({
              type: 'message.received',
              payload: {
                conversationId: sendPayload.conversationId,
                message: {
                  id: result.assistantMessage.id,
                  content: result.assistantMessage.content,
                  role: 'ASSISTANT',
                  sentBy: 'system',
                  createdAt: result.assistantMessage.createdAt,
                  metadata: {
                    citations: result.contextChunks.map((c: any) => c.documentId),
                    suggestedQuestions: result.assistantMessage.metadata?.suggestedQuestions || [],
                  },
                },
              },
              timestamp: new Date().toISOString(),
              correlationId: cid,
            })
          );

          // (اختياري) يمكن بث رسالة "جاري الكتابة" قبل إرسال الرد
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          logger.error('فشل إرسال الرسالة عبر WebSocket', {
            correlationId: cid,
            userId: client.userId,
            conversationId: sendPayload.conversationId,
            error: errMsg,
          });
          client.send(
            JSON.stringify({
              type: 'error',
              payload: { message: `Failed to send message: ${errMsg}` },
              timestamp: new Date().toISOString(),
              correlationId: cid,
            })
          );
        }
        break;
      }

      case 'conversation.join': {
        const joinPayload = payload as JoinConversationPayload;
        if (!joinPayload.conversationId) {
          client.send(
            JSON.stringify({
              type: 'error',
              payload: { message: 'Missing conversationId' },
              timestamp: new Date().toISOString(),
              correlationId: cid,
            })
          );
          return;
        }
        // تحديث المحادثة الحالية للعميل
        client.currentConversationId = joinPayload.conversationId;
        logger.debug('انضم العميل إلى محادثة', {
          correlationId: cid,
          userId: client.userId,
          conversationId: joinPayload.conversationId,
        });
        // يمكن إرسال تأكيد أو جلب الرسائل التاريخية
        client.send(
          JSON.stringify({
            type: 'conversation.updated',
            payload: {
              conversationId: joinPayload.conversationId,
              status: 'joined',
            },
            timestamp: new Date().toISOString(),
            correlationId: cid,
          })
        );
        break;
      }

      case 'conversation.leave': {
        if (client.currentConversationId) {
          logger.debug('غادر العميل المحادثة', {
            correlationId: cid,
            userId: client.userId,
            conversationId: client.currentConversationId,
          });
          client.currentConversationId = undefined;
        }
        break;
      }

      case 'typing.start':
      case 'typing.stop': {
        const typingPayload = payload as TypingPayload;
        if (!typingPayload.conversationId) {
          client.send(
            JSON.stringify({
              type: 'error',
              payload: { message: 'Missing conversationId' },
              timestamp: new Date().toISOString(),
              correlationId: cid,
            })
          );
          return;
        }
        // بث حالة الكتابة إلى العملاء الآخرين في نفس المحادثة (اختياري)
        // يمكننا تنفيذ البث عبر wss.clients
        break;
      }

      default: {
        logger.warn('نوع رسالة غير معروف', {
          correlationId: cid,
          userId: client.userId,
          type,
        });
        client.send(
          JSON.stringify({
            type: 'error',
            payload: { message: `Unknown message type: ${type}` },
            timestamp: new Date().toISOString(),
            correlationId: cid,
          })
        );
      }
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Invalid JSON';
    logger.error('فشل تحليل رسالة WebSocket', {
      correlationId,
      userId: client.userId,
      error: errMsg,
    });
    client.send(
      JSON.stringify({
        type: 'error',
        payload: { message: 'Invalid message format' },
        timestamp: new Date().toISOString(),
        correlationId: getCurrentCorrelationId() || 'ws-parse-error',
      })
    );
  }
}