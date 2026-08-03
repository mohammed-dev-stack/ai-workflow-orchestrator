// backend/src/routes/index.ts
import { Router } from 'express';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';

// استيراد جميع المسارات الفرعية
import authRoutes from './auth.routes.js';
import knowledgeBaseRoutes from './knowledgeBase.routes';
import documentRoutes from './document.routes';
import conversationRoutes from './conversation.routes';
import webhookRoutes from './webhook.routes';
import analyticsRoutes from './analytics.routes';

/**
 * المصدر الوحيد (SSoT) لتجميع جميع مسارات API.
 * [مُتحقَّق منطقياً بتتبع كامل] — تجميع جميع المسارات في Router واحد.
 */
const router = Router();

// ============================================================
// تسجيل المسارات
// ============================================================

/**
 * مسارات المصادقة (بدون مصادقة مسبقة)
 * - POST /api/auth/login
 * - POST /api/auth/register
 * - POST /api/auth/refresh
 * - POST /api/auth/logout (يتطلب مصادقة)
 * - POST /api/auth/logout-all (يتطلب مصادقة)
 * - POST /api/auth/change-password (يتطلب مصادقة)
 * - PUT /api/auth/profile (يتطلب مصادقة)
 * - GET /api/auth/me (يتطلب مصادقة)
 * - POST /api/auth/validate (يتطلب مصادقة)
 */
router.use('/api/auth', authRoutes);

/**
 * مسارات قواعد المعرفة (تتطلب مصادقة وعزل مستأجرين)
 * - GET /api/knowledge-bases
 * - GET /api/knowledge-bases/:id
 * - POST /api/knowledge-bases (ADMIN)
 * - PUT /api/knowledge-bases/:id (ADMIN)
 * - DELETE /api/knowledge-bases/:id (ADMIN)
 * - POST /api/knowledge-bases/:id/restore (ADMIN)
 * - GET /api/knowledge-bases/:id/documents/count
 */
router.use('/api/knowledge-bases', knowledgeBaseRoutes);

/**
 * مسارات المستندات (تتطلب مصادقة وعزل مستأجرين)
 * - GET /api/documents
 * - GET /api/documents/:id
 * - POST /api/documents (ADMIN)
 * - PUT /api/documents/:id (ADMIN)
 * - DELETE /api/documents/:id (ADMIN)
 * - POST /api/documents/:id/restore (ADMIN)
 * - POST /api/documents/:id/process (ADMIN)
 * - POST /api/documents/:id/status (ADMIN)
 */
router.use('/api/documents', documentRoutes);

/**
 * مسارات المحادثات (تتطلب مصادقة وعزل مستأجرين)
 * - GET /api/conversations
 * - GET /api/conversations/:id
 * - POST /api/conversations (ADMIN/AGENT)
 * - POST /api/conversations/:id/messages
 * - POST /api/conversations/:id/close (ADMIN/AGENT)
 * - DELETE /api/conversations/:id (ADMIN)
 * - POST /api/conversations/:id/send-whatsapp (ADMIN/AGENT)
 */
router.use('/api/conversations', conversationRoutes);

/**
 * مسارات التحليلات (تتطلب مصادقة وعزل مستأجرين)
 * - GET /api/analytics/dashboard
 * - GET /api/analytics/trends
 * - GET /api/analytics/ai-performance
 * - GET /api/analytics/documents/status
 * - GET /api/analytics/messages/roles
 * - GET /api/analytics/storage
 * - POST /api/analytics/cache/invalidate (ADMIN)
 */
router.use('/api/analytics', analyticsRoutes);

/**
 * مسارات ويب هوك (بدون مصادقة — يتحقق من التوقيع داخلياً)
 * - GET /webhook (للتسجيل الأولي)
 * - POST /webhook (استقبال الرسائل والحالات)
 * - POST /webhook/test (للتطوير فقط، يتطلب مصادقة)
 */
router.use('/webhook', webhookRoutes);

// ============================================================
// تسجيل تهيئة المسارات (مرة واحدة عند بدء التشغيل)
// ============================================================

/**
 * تسجيل معلومات المسارات المُحمّلة (للتشخيص).
 * [مُتحقَّق منطقياً بتتبع كامل] — تسجيل تهيئة المسارات.
 */
const correlationId = getCurrentCorrelationId() || 'startup';

logger.info('تم تهيئة المسارات', {
  correlationId,
  routes: [
    '/api/auth',
    '/api/knowledge-bases',
    '/api/documents',
    '/api/conversations',
    '/api/analytics',
    '/webhook',
  ],
});

// ============================================================
// تصدير الـ Router المُجمّع
// ============================================================

/**
 * تصدير الـ Router المُجمّع كافتراضي.
 * [مُتحقَّق منطقياً بتتبع كامل] — Router جاهز للاستخدام في server.ts.
 */
export default router;

/**
 * تصدير جميع المسارات الفرعية للاستخدام في الاختبارات أو التوسع.
 */
export {
  authRoutes,
  knowledgeBaseRoutes,
  documentRoutes,
  conversationRoutes,
  webhookRoutes,
  analyticsRoutes,
};
