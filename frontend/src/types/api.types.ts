// ============================================================
// frontend/src/types/api.types.ts
// ============================================================
// المصدر الوحيد (SSoT) لأنواع البيانات المشتركة بين الواجهة الأمامية والخادم.
// ✅ تم إصلاح جميع الأنواع لتتوافق مع الاستجابات الفعلية للخادم.
// ✅ تم إضافة الحقول المفقودة في DashboardMetrics، ConversationTrends، AIPerformance.
// ✅ تم إصلاح ListKnowledgeBasesResponse و ListConversationsResponse.
// ✅ تم إضافة search إلى ListConversationsParams.
// ✅ تم توحيد هيكل الاستجابات المرحلية (PaginatedResponse).
// ============================================================

// ============================================================
// 1. الأنواع الأساسية (Primitive Types)
// ============================================================

/**
 * معرف فريد (UUID).
 */
export type ID = string;

/**
 * طابع زمني (ISO 8601).
 */
export type Timestamp = string;

// ============================================================
// 2. أنواع الأدوار والحالات (Enums)
// ============================================================

/**
 * دور المستخدم في النظام (RBAC).
 */
export type UserRole = 'ADMIN' | 'AGENT' | 'VIEWER';

/**
 * خطة المستأجر (التسعير).
 */
export type TenantPlan = 'FREE' | 'PRO' | 'ENTERPRISE';

/**
 * حالة المستأجر.
 */
export type TenantStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

/**
 * حالة المستخدم.
 */
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

/**
 * حالة المستند.
 */
export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DELETED';

/**
 * حالة المحادثة.
 */
export type ConversationStatus = 'ACTIVE' | 'CLOSED' | 'ARCHIVED';

/**
 * دور المرسل في الرسالة.
 */
export type MessageRole = 'USER' | 'ASSISTANT' | 'SYSTEM';

// ============================================================
// 3. كيانات النطاق الأساسية (Domain Entities)
// ============================================================

/**
 * مستأجر (شركة/مؤسسة).
 */
export interface Tenant {
  id: ID;
  name: string;
  domain: string;
  adminEmail: string;
  adminName: string;
  plan: TenantPlan;
  status: TenantStatus;
  whatsappPhoneNumberId: string | null;
  createdBy: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
  settings: TenantSettings;
}

/**
 * إعدادات المستأجر (كما تُعاد من الخادم).
 */
export interface TenantSettings {
  ai: {
    maxTokensPerRequest: number;
    allowedModels: string[];
    monthlyAILimit: number;
  };
  storage: {
    maxStorageBytes: number;
  };
  documents: {
    maxDocumentsPerKB: number;
    maxFileSizeBytes: number;
  };
  chat: {
    maxActiveConversations: number;
    messageRetentionDays: number;
  };
  users: {
    maxUsers: number;
    allowedRoles: UserRole[];
  };
  whatsapp: {
    phoneNumberId?: string | null;
    enabled: boolean;
  };
}

/**
 * مستخدم (موظف/عميل داخلي).
 */
export interface User {
  id: ID;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  role: UserRole;
  status: UserStatus;
  tenantId: ID;
  lastLoginAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
  permissions?: string[];
}

/**
 * قاعدة المعرفة (Knowledge Base).
 */
export interface KnowledgeBase {
  id: ID;
  name: string;
  description: string | null;
  isActive: boolean;
  tags: string[];
  tenantId: ID;
  createdBy: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
  documentCount?: number;
}

/**
 * مستند (ملف مرفوع).
 */
export interface Document {
  id: ID;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  fileUrl?: string; // ✅ إضافة fileUrl كبديل لـ storagePath
  description: string | null;
  tags: string[];
  status: DocumentStatus;
  errorMessage: string | null;
  knowledgeBaseId: ID;
  tenantId: ID;
  uploadedBy: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt: Timestamp | null;
  processedAt: Timestamp | null;
  chunkCount: number | null;
  vectorCount: number | null;
}

/**
 * مقطع مستند (مع متجه التضمين).
 */
export interface DocumentChunk {
  id: ID;
  content: string;
  vector: number[] | null;
  chunkIndex: number;
  metadata: Record<string, any> | null;
  documentId: ID;
  knowledgeBaseId: ID;
  tenantId: ID;
  createdAt: Timestamp;
}

/**
 * محادثة (Conversation).
 */
export interface Conversation {
  id: ID;
  phoneNumberId: string;
  customerName: string | null;
  status: ConversationStatus;
  tenantId: ID;
  knowledgeBaseId: ID | null;
  createdBy: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  closedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  messageCount: number;
}

/**
 * رسالة (Message).
 */
export interface Message {
  id: ID;
  content: string;
  role: MessageRole;
  metadata: Record<string, any> | null;
  conversationId: ID;
  tenantId: ID;
  sentBy: ID;
  createdAt: Timestamp;
  deletedAt: Timestamp | null;
  externalId: string | null;
}

// ============================================================
// 4. أنواع المصادقة (Authentication)
// ============================================================

/**
 * بيانات تسجيل الدخول.
 */
export interface LoginCredentials {
  email: string;
  password: string;
  tenantId?: string;
}

/**
 * بيانات التسجيل.
 */
export interface RegisterData {
  email: string;
  password: string;
  fullName: string;
  tenantId?: string;
  role?: UserRole;
  phoneNumber?: string;
}

/**
 * استجابة المصادقة (تسجيل دخول/تسجيل/تحديث).
 */
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

/**
 * بيانات تغيير كلمة المرور.
 */
export interface ChangePasswordData {
  userId: ID;
  currentPassword: string;
  newPassword: string;
}

/**
 * بيانات تحديث الملف الشخصي.
 */
export interface UpdateProfileData {
  fullName?: string;
  email?: string;
  phoneNumber?: string;
}

// ============================================================
// 5. أنواع قواعد المعرفة (Knowledge Base)
// ============================================================

/**
 * بيانات إنشاء قاعدة معرفة.
 */
export interface CreateKnowledgeBaseData {
  name: string;
  description?: string;
  isActive?: boolean;
  tags?: string[];
}

/**
 * بيانات تحديث قاعدة معرفة.
 */
export interface UpdateKnowledgeBaseData {
  id: ID;
  name?: string;
  description?: string;
  isActive?: boolean;
  tags?: string[];
}

/**
 * معاملات جلب قائمة قواعد المعرفة.
 */
export interface ListKnowledgeBasesParams {
  limit?: number;
  offset?: number;
  search?: string;
  isActive?: boolean;
}

/**
 * استجابة جلب قائمة قواعد المعرفة.
 * ✅ الخادم يعيد { success: true, data: { items: [...], total: number }, pagination: { limit, offset } }
 * ✅ أو مباشرة { items: [...], total: number, limit, offset }
 */
export interface ListKnowledgeBasesResponse {
  items: KnowledgeBase[];
  total: number;
  limit?: number;
  offset?: number;
}

// ============================================================
// 6. أنواع المستندات (Documents)
// ============================================================

/**
 * بيانات رفع مستند.
 */
export interface UploadDocumentData {
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  knowledgeBaseId: ID;
  tenantId: ID;
  uploadedBy: ID;
  description?: string;
  tags?: string[];
  status?: DocumentStatus;
}

/**
 * بيانات تحديث مستند.
 */
export interface UpdateDocumentData {
  description?: string;
  tags?: string[];
}

/**
 * معاملات جلب قائمة المستندات.
 */
export interface ListDocumentsParams {
  limit?: number;
  offset?: number;
  search?: string;
  status?: DocumentStatus;
  knowledgeBaseId?: ID;
}

/**
 * استجابة جلب قائمة المستندات.
 * ✅ الخادم يعيد { success: true, data: [...], pagination: { total, limit, offset } }
 */
export interface ListDocumentsResponse {
  items: Document[];
  total: number;
  limit?: number;
  offset?: number;
}

// ============================================================
// 7. أنواع المحادثات (Conversations)
// ============================================================

/**
 * بيانات إنشاء محادثة.
 */
export interface CreateConversationData {
  phoneNumberId: string;
  customerName?: string;
  knowledgeBaseId?: ID;
}

/**
 * بيانات إرسال رسالة.
 */
export interface SendMessageData {
  content: string;
  knowledgeBaseId?: ID;
  contextChunkLimit?: number;
  similarityThreshold?: number;
}

/**
 * معاملات جلب قائمة المحادثات.
 * ✅ تم إضافة search للبحث في أسماء العملاء وأرقام الهواتف.
 */
export interface ListConversationsParams {
  limit?: number;
  offset?: number;
  status?: ConversationStatus;
  phoneNumberId?: string;
  search?: string;
}

/**
 * استجابة جلب قائمة المحادثات.
 * ✅ الخادم يعيد { success: true, data: { items: [...], total: number }, pagination: { limit, offset } }
 * ✅ أو مباشرة { items: [...], total: number, limit, offset }
 */
export interface ListConversationsResponse {
  items: Conversation[];
  total: number;
  limit?: number;
  offset?: number;
}

/**
 * استجابة جلب محادثة (مع الرسائل).
 */
export interface GetConversationResponse {
  conversation: Conversation;
  messages: Message[];
  totalMessages: number;
}

/**
 * استجابة إرسال رسالة.
 */
export interface SendMessageResponse {
  userMessage: Message;
  assistantMessage: Message;
  contextChunks: Array<{
    id: ID;
    documentId: ID;
    content: string;
    similarity: number;
  }>;
  conversationId: ID;
}

// ============================================================
// 8. أنواع التحليلات (Analytics)
// ============================================================

/**
 * مقاييس لوحة المعلومات.
 * ✅ تم إضافة جميع الحقول المطلوبة من قبل Dashboard component.
 */
export interface DashboardMetrics {
  totalConversations: number;
  activeConversations: number;
  closedConversations: number;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  totalDocuments: number;
  completedDocuments: number;
  processingDocuments: number;
  failedDocuments: number;
  aiTotalRequests: number;
  aiAverageTokensPerRequest: number;
  aiSuccessRate: number;
  totalStorageBytes: number;
  trends?: {
    conversationsChange: number;
    messagesChange: number;
    documentsChange: number;
  };
  period: {
    startDate: Timestamp;
    endDate: Timestamp;
  };
}

/**
 * اتجاهات المحادثات (بيانات المخطط الزمني).
 * ✅ تم إصلاح الهيكل ليتوافق مع استجابة الخادم الفعلية.
 *    الخادم يعيد: { data: [{ date: string, count: number }], groupBy, period }
 */
export interface ConversationTrends {
  data: Array<{
    date: string;
    count: number;
  }>;
  groupBy: 'day' | 'week' | 'month';
  period: {
    start: Timestamp;
    end: Timestamp;
  };
}

/**
 * أداء الذكاء الاصطناعي.
 * ✅ تم إضافة averageResponseTimeMs و totalTokensUsed و averageTokensPerRequest.
 */
export interface AIPerformance {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  averageResponseTimeMs: number;
  totalTokensUsed: number;
  averageTokensPerRequest: number;
  errorDistribution?: {
    timeout: number;
    rateLimit: number;
    serverError: number;
    validation: number;
    other: number;
  };
}

/**
 * توزيع المستندات حسب الحالة.
 */
export type DocumentStatusDistribution = Array<{
  status: DocumentStatus | string;
  count: number;
}>;

/**
 * توزيع الرسائل حسب الدور.
 */
export type MessageRoleDistribution = Array<{
  role: MessageRole | string;
  count: number;
}>;

/**
 * مساحة التخزين المستخدمة.
 */
export interface StorageUsage {
  bytes: number;
  megabytes: number;
  gigabytes: number;
}

// ============================================================
// 9. أنواع الأخطاء الموحدة
// ============================================================

/**
 * خطأ API موحّد.
 */
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
  correlationId?: string;
  timestamp?: string;
  details?: Record<string, any>;
}

// ============================================================
// 10. أنواع مساعدة للاستجابات العامة
// ============================================================

/**
 * استجابة عامة مع بيانات.
 * ✅ الخادم يعيد { success: true, data: T, message?: string }
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  correlationId?: string;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
  };
}

/**
 * استجابة ترحيل عامة.
 * ✅ تستخدم داخلياً لتوحيد استجابات القوائم.
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================
// 11. تصدير جميع الأنواع (للاستخدام السهل)
// ============================================================

export type { ApiResponse as ApiResponseType };
export type { PaginatedResponse as PaginatedResponseType };

export default {
  // يمكن استخدام هذا التصدير للتجميع، لكن الأفضل استخدام الاستيرادات الفردية
};