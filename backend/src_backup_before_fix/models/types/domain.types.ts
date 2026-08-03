// backend/src/models/types/domain.types.ts

// ============================================================
// الأنواع الأساسية (Primitive Types)
// ============================================================

/**
 * معرف فريد (UUID v4).
 */
export type ID = string;

/**
 * طابع زمني (ISO 8601).
 */
export type Timestamp = string;

/**
 * معرف المستأجر (UUID).
 */
export type TenantId = ID;

/**
 * معرف المستخدم (UUID).
 */
export type UserId = ID;

// ============================================================
// الثوابت (Constants) — SSoT للقيم الثابتة
// ============================================================

/**
 * أدوار المستخدم في النظام (RBAC).
 * [مُتحقَّق منطقياً بتتبع كامل] — قائمة الأدوار المسموح بها.
 */
export const UserRoles = {
  ADMIN: 'ADMIN',
  AGENT: 'AGENT',
  VIEWER: 'VIEWER',
} as const;

export type UserRole = typeof UserRoles[keyof typeof UserRoles];

/**
 * خطط المستأجر (التسعير).
 */
export const TenantPlans = {
  FREE: 'FREE',
  PRO: 'PRO',
  ENTERPRISE: 'ENTERPRISE',
} as const;

export type TenantPlan = typeof TenantPlans[keyof typeof TenantPlans];

/**
 * حالات المستأجر.
 */
export const TenantStatuses = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;

export type TenantStatus = typeof TenantStatuses[keyof typeof TenantStatuses];

/**
 * حالات المستخدم.
 */
export const UserStatuses = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  BLOCKED: 'BLOCKED',
} as const;

export type UserStatus = typeof UserStatuses[keyof typeof UserStatuses];

/**
 * حالات المستند.
 */
export const DocumentStatuses = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DELETED: 'DELETED',
} as const;

export type DocumentStatus = typeof DocumentStatuses[keyof typeof DocumentStatuses];

/**
 * حالات المحادثة.
 */
export const ConversationStatuses = {
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type ConversationStatus = typeof ConversationStatuses[keyof typeof ConversationStatuses];

/**
 * أدوار المرسل في الرسالة.
 */
export const MessageRoles = {
  USER: 'USER',
  ASSISTANT: 'ASSISTANT',
  SYSTEM: 'SYSTEM',
} as const;

export type MessageRole = typeof MessageRoles[keyof typeof MessageRoles];

// ============================================================
// كيانات النطاق (Domain Entities)
// ============================================================

/**
 * مستأجر (شركة/مؤسسة).
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان المستأجر.
 */
export interface Tenant {
  /** معرف المستأجر (UUID) */
  id: TenantId;
  /** اسم المستأجر (فريد) */
  name: string;
  /** النطاق (domain) للمستأجر (فريد) */
  domain: string;
  /** البريد الإلكتروني للمالك/المسؤول */
  adminEmail: string;
  /** اسم المالك/المسؤول */
  adminName: string;
  /** خطة المستأجر */
  plan: TenantPlan;
  /** إعدادات المستأجر (JSON) */
  settings: TenantSettings;
  /** حالة المستأجر */
  status: TenantStatus;
  /** معرف رقم هاتف WhatsApp (للربط) */
  whatsappPhoneNumberId: string | null;
  /** معرف المستخدم المنشئ */
  createdBy: UserId;
  /** تاريخ الإنشاء */
  createdAt: Timestamp;
  /** تاريخ آخر تحديث */
  updatedAt: Timestamp;
  /** تاريخ الحذف (للحذف الناعم) */
  deletedAt: Timestamp | null;
}

/**
 * مستخدم (موظف/عميل داخلي).
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان المستخدم.
 */
export interface User {
  /** معرف المستخدم (UUID) */
  id: UserId;
  /** البريد الإلكتروني (فريد داخل المستأجر) */
  email: string;
  /** كلمة المرور المشفرة (bcrypt) */
  passwordHash: string;
  /** الاسم الكامل */
  fullName: string;
  /** رقم الهاتف (اختياري) */
  phoneNumber: string | null;
  /** دور المستخدم في النظام */
  role: UserRole;
  /** حالة المستخدم */
  status: UserStatus;
  /** معرف المستأجر */
  tenantId: TenantId;
  /** تاريخ آخر تسجيل دخول */
  lastLoginAt: Timestamp | null;
  /** تاريخ الإنشاء */
  createdAt: Timestamp;
  /** تاريخ آخر تحديث */
  updatedAt: Timestamp;
  /** تاريخ الحذف (للحذف الناعم) */
  deletedAt: Timestamp | null;
}

/**
 * قاعدة المعرفة (Knowledge Base).
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان قاعدة المعرفة.
 */
export interface KnowledgeBase {
  /** معرف قاعدة المعرفة (UUID) */
  id: ID;
  /** اسم قاعدة المعرفة (فريد داخل المستأجر) */
  name: string;
  /** وصف قاعدة المعرفة */
  description: string | null;
  /** ما إذا كانت القاعدة نشطة */
  isActive: boolean;
  /** العلامات/الوسوم (Tags) */
  tags: string[];
  /** معرف المستأجر */
  tenantId: TenantId;
  /** معرف المستخدم المنشئ */
  createdBy: UserId;
  /** تاريخ الإنشاء */
  createdAt: Timestamp;
  /** تاريخ آخر تحديث */
  updatedAt: Timestamp;
  /** تاريخ الحذف (للحذف الناعم) */
  deletedAt: Timestamp | null;
  /** عدد المستندات في القاعدة (مشتق) */
  documentCount?: number;
}

/**
 * مستند (ملف مرفوع).
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان المستند.
 */
export interface Document {
  /** معرف المستند (UUID) */
  id: ID;
  /** اسم الملف الأصلي */
  fileName: string;
  /** حجم الملف بالبايت */
  fileSize: number;
  /** نوع MIME للملف */
  mimeType: string;
  /** مسار التخزين (S3 أو محلي) */
  storagePath: string;
  /** وصف المستند */
  description: string | null;
  /** العلامات/الوسوم (Tags) */
  tags: string[];
  /** حالة المستند */
  status: DocumentStatus;
  /** رسالة الخطأ (إذا فشلت المعالجة) */
  errorMessage: string | null;
  /** معرف قاعدة المعرفة */
  knowledgeBaseId: ID;
  /** معرف المستأجر */
  tenantId: TenantId;
  /** معرف المستخدم الرافع */
  uploadedBy: UserId;
  /** تاريخ الإنشاء */
  createdAt: Timestamp;
  /** تاريخ آخر تحديث */
  updatedAt: Timestamp;
  /** تاريخ الحذف (للحذف الناعم) */
  deletedAt: Timestamp | null;
  /** وقت اكتمال المعالجة */
  processedAt: Timestamp | null;
  /** عدد المقاطع (Chunks) */
  chunkCount: number | null;
  /** عدد المتجهات (Vectors) */
  vectorCount: number | null;
}

/**
 * مقطع مستند (مع متجه التضمين).
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان مقطع المستند.
 */
export interface DocumentChunk {
  /** معرف المقطع (UUID) */
  id: ID;
  /** نص المقطع */
  content: string;
  /** متجه التضمين (pgvector) */
  vector: number[] | null;
  /** ترتيب المقطع في المستند */
  chunkIndex: number;
  /** بيانات وصفية إضافية */
  metadata: Record<string, any> | null;
  /** معرف المستند */
  documentId: ID;
  /** معرف قاعدة المعرفة */
  knowledgeBaseId: ID;
  /** معرف المستأجر */
  tenantId: TenantId;
  /** تاريخ الإنشاء */
  createdAt: Timestamp;
}

/**
 * محادثة (Conversation).
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان المحادثة.
 */
export interface Conversation {
  /** معرف المحادثة (UUID) */
  id: ID;
  /** رقم هاتف العميل (من WhatsApp) */
  phoneNumberId: string;
  /** اسم العميل */
  customerName: string | null;
  /** حالة المحادثة */
  status: ConversationStatus;
  /** معرف المستأجر */
  tenantId: TenantId;
  /** معرف قاعدة المعرفة الافتراضية */
  knowledgeBaseId: ID | null;
  /** معرف المستخدم المنشئ */
  createdBy: UserId;
  /** تاريخ الإنشاء */
  createdAt: Timestamp;
  /** تاريخ آخر تحديث */
  updatedAt: Timestamp;
  /** تاريخ الإغلاق */
  closedAt: Timestamp | null;
  /** تاريخ الحذف (للحذف الناعم) */
  deletedAt: Timestamp | null;
  /** عدد الرسائل (مشتق) */
  messageCount: number;
}

/**
 * رسالة (Message).
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان الرسالة.
 */
export interface Message {
  /** معرف الرسالة (UUID) */
  id: ID;
  /** نص الرسالة */
  content: string;
  /** دور المرسل (مستخدم، مساعد، نظام) */
  role: MessageRole;
  /** بيانات وصفية (citations, suggestedQuestions, contextChunks, tokensUsed, error) */
  metadata: Record<string, any> | null;
  /** معرف المحادثة */
  conversationId: ID;
  /** معرف المستأجر */
  tenantId: TenantId;
  /** معرف المستخدم المرسل */
  sentBy: UserId;
  /** تاريخ الإنشاء */
  createdAt: Timestamp;
  /** تاريخ الحذف (للحذف الناعم) */
  deletedAt: Timestamp | null;
  /** معرف خارجي (مثل معرف رسالة WhatsApp) */
  externalId: string | null;
}

/**
 * قالب المطالبة (Prompt Template) — مُصدر ومُرقم.
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان قالب المطالبة.
 */
export interface PromptTemplate {
  /** معرف القالب (UUID) */
  id: ID;
  /** إصدار القالب (Semantic Versioning) */
  version: string;
  /** معرف فريد للقالب (مثل 'embed-v1') */
  identifier: string;
  /** محتوى المطالبة */
  content: string;
  /** وصف المطالبة */
  description: string | null;
  /** ما إذا كان القالب نشطاً */
  isActive: boolean;
  /** معرف المستخدم المنشئ */
  createdBy: UserId;
  /** تاريخ الإنشاء */
  createdAt: Timestamp;
  /** تاريخ آخر تحديث */
  updatedAt: Timestamp;
  /** النموذج المُوصى به */
  model: string | null;
  /** الحد الأقصى للرموز */
  maxTokens: number | null;
}

/**
 * سجل التدقيق (Audit Log) — §7.
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان سجل التدقيق.
 */
export interface AuditLog {
  /** معرف السجل (UUID) */
  id: ID;
  /** نوع الحدث (مثل 'auth.login', 'document.upload') */
  eventType: string;
  /** نوع المورد (مثل 'User', 'Document') */
  resourceType: string | null;
  /** معرف المورد المتأثر */
  resourceId: ID | null;
  /** معرف المستأجر */
  tenantId: TenantId | null;
  /** معرف المستخدم (الفاعل) */
  userId: UserId | null;
  /** عنوان IP */
  ipAddress: string | null;
  /** وكيل المستخدم (User Agent) */
  userAgent: string | null;
  /** البيانات الإضافية (JSON) */
  payload: Record<string, any> | null;
  /** الطابع الزمني للحدث */
  timestamp: Timestamp;
  /** معرّف الارتباط (من middleware) */
  correlationId: ID | null;
}

/**
 * مقياس (Metric) — لتخزين مقاييس RED ومقاييس الذكاء الاصطناعي.
 * [مُتحقَّق منطقياً بتتبع كامل] — كيان المقياس.
 */
export interface Metric {
  /** معرف المقياس (UUID) */
  id: ID;
  /** اسم المقياس (مثل 'ai.requests', 'http.requests') */
  name: string;
  /** القيمة (عدد، مدة، إلخ) */
  value: number;
  /** العلامات (Tags) — بيانات إضافية */
  tags: Record<string, any> | null;
  /** معرف المستأجر */
  tenantId: TenantId | null;
  /** الطابع الزمني للمقياس */
  timestamp: Timestamp;
}

// ============================================================
// إعدادات المستأجر (Tenant Settings)
// ============================================================

/**
 * إعدادات المستأجر (قابلة للتخصيص).
 * [مُتحقَّق منطقياً بتتبع كامل] — إعدادات المستأجر.
 */
export interface TenantSettings {
  /** إعدادات الذكاء الاصطناعي */
  ai: {
    /** الحد الأقصى للرموز لكل طلب */
    maxTokensPerRequest: number;
    /** النماذج المسموح بها */
    allowedModels: string[];
    /** الحد الأقصى لعدد طلبات AI في الشهر */
    monthlyAILimit: number;
  };
  /** إعدادات التخزين */
  storage: {
    /** الحد الأقصى للمساحة التخزينية (بالبايت) */
    maxStorageBytes: number;
  };
  /** إعدادات المستندات */
  documents: {
    /** الحد الأقصى لعدد المستندات لكل قاعدة معرفة */
    maxDocumentsPerKB: number;
    /** الحد الأقصى لحجم الملف (بالبايت) */
    maxFileSizeBytes: number;
  };
  /** إعدادات المحادثة */
  chat: {
    /** الحد الأقصى لعدد المحادثات النشطة */
    maxActiveConversations: number;
    /** الاحتفاظ برسائل المحادثة (بالأيام) */
    messageRetentionDays: number;
  };
  /** إعدادات المستخدمين */
  users: {
    /** الحد الأقصى لعدد المستخدمين */
    maxUsers: number;
    /** الأدوار المسموح بها */
    allowedRoles: UserRole[];
  };
  /** إعدادات WhatsApp */
  whatsapp: {
    /** معرف رقم الهاتف (phone_number_id) */
    phoneNumberId?: string;
    /** ما إذا كان WhatsApp مفعلاً */
    enabled: boolean;
  };
}

// ============================================================
// دوال مساعدة للتحقق من الأنواع (Type Guards)
// ============================================================

/**
 * التحقق من صحة دور المستخدم.
 * [مُتحقَّق منطقياً بتتبع كامل] — دالة مساعدة للتحقق من النوع.
 */
export function isValidUserRole(role: string): role is UserRole {
  return Object.values(UserRoles).includes(role as UserRole);
}

/**
 * التحقق من صحة خطة المستأجر.
 */
export function isValidTenantPlan(plan: string): plan is TenantPlan {
  return Object.values(TenantPlans).includes(plan as TenantPlan);
}

/**
 * التحقق من صحة حالة المستأجر.
 */
export function isValidTenantStatus(status: string): status is TenantStatus {
  return Object.values(TenantStatuses).includes(status as TenantStatus);
}

/**
 * التحقق من صحة حالة المستخدم.
 */
export function isValidUserStatus(status: string): status is UserStatus {
  return Object.values(UserStatuses).includes(status as UserStatus);
}

/**
 * التحقق من صحة حالة المستند.
 */
export function isValidDocumentStatus(status: string): status is DocumentStatus {
  return Object.values(DocumentStatuses).includes(status as DocumentStatus);
}

/**
 * التحقق من صحة حالة المحادثة.
 */
export function isValidConversationStatus(status: string): status is ConversationStatus {
  return Object.values(ConversationStatuses).includes(status as ConversationStatus);
}

/**
 * التحقق من صحة دور الرسالة.
 */
export function isValidMessageRole(role: string): role is MessageRole {
  return Object.values(MessageRoles).includes(role as MessageRole);
}

// ============================================================
// تصدير الكائنات والدوال
// ============================================================

export default {
  // الثوابت
  UserRoles,
  TenantPlans,
  TenantStatuses,
  UserStatuses,
  DocumentStatuses,
  ConversationStatuses,
  MessageRoles,
  // دوال التحقق
  isValidUserRole,
  isValidTenantPlan,
  isValidTenantStatus,
  isValidUserStatus,
  isValidDocumentStatus,
  isValidConversationStatus,
  isValidMessageRole,
};
