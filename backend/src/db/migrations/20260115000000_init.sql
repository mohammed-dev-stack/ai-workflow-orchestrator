-- ============================================================
-- الترحيل الأولي لقاعدة البيانات
-- التاريخ: 2026-01-15
-- الوصف: إنشاء جميع الجداول والأنواع والفهارس والقيود
-- التوافق: PostgreSQL 14+ مع ملحق pgvector
-- ============================================================

-- 1. تمكين ملحق pgvector (للبحث عن المتجهات)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. إنشاء الأنواع المخصصة (ENUMs)
-- ============================================================

-- دور المستخدم في النظام (RBAC)
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT', 'VIEWER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- خطة المستأجر (التسعير)
DO $$ BEGIN
    CREATE TYPE "TenantPlan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- حالة المستأجر
DO $$ BEGIN
    CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- حالة المستخدم
DO $$ BEGIN
    CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- حالة المستند
DO $$ BEGIN
    CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DELETED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- حالة المحادثة
DO $$ BEGIN
    CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'CLOSED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- دور المرسل في الرسالة
DO $$ BEGIN
    CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;


-- 3. إنشاء الجداول
-- ============================================================

-- جدول المستأجرين (Tenant)
CREATE TABLE IF NOT EXISTS "Tenant" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "domain" VARCHAR(100) NOT NULL,
    "adminEmail" VARCHAR(255) NOT NULL,
    "adminName" VARCHAR(100) NOT NULL,
    "plan" "TenantPlan" NOT NULL DEFAULT 'FREE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "whatsappPhoneNumberId" VARCHAR(50),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3)
);

-- جدول المستخدمين (User)
CREATE TABLE IF NOT EXISTS "User" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" VARCHAR(100) NOT NULL,
    "phoneNumber" VARCHAR(20),
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "tenantId" UUID NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE
);

-- جدول توكنات التحديث (RefreshToken)
CREATE TABLE IF NOT EXISTS "RefreshToken" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL UNIQUE,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

-- جدول قواعد المعرفة (KnowledgeBase)
CREATE TABLE IF NOT EXISTS "KnowledgeBase" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "tags" TEXT[] NOT NULL DEFAULT '{}',
    "tenantId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "KnowledgeBase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "KnowledgeBase_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT
);

-- جدول المستندات (Document)
CREATE TABLE IF NOT EXISTS "Document" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "fileName" VARCHAR(255) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "storagePath" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT '{}',
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "knowledgeBaseId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "uploadedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "chunkCount" INTEGER,
    "vectorCount" INTEGER,
    CONSTRAINT "Document_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE,
    CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "Document_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT
);

-- جدول مقاطع المستندات مع المتجهات (DocumentChunk) — يستخدم pgvector
CREATE TABLE IF NOT EXISTS "DocumentChunk" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "content" TEXT NOT NULL,
    "vector" vector(1024),
    "chunkIndex" INTEGER NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "documentId" UUID NOT NULL,
    "knowledgeBaseId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE,
    CONSTRAINT "DocumentChunk_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE,
    CONSTRAINT "DocumentChunk_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE
);

-- جدول المحادثات (Conversation)
CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "phoneNumberId" VARCHAR(50) NOT NULL,
    "customerName" VARCHAR(100),
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "tenantId" UUID NOT NULL,
    "knowledgeBaseId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "Conversation_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE SET NULL,
    CONSTRAINT "Conversation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT
);

-- جدول الرسائل (Message)
CREATE TABLE IF NOT EXISTS "Message" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "content" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL DEFAULT 'USER',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "conversationId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sentBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "externalId" VARCHAR(255),
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE,
    CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE,
    CONSTRAINT "Message_sentBy_fkey" FOREIGN KEY ("sentBy") REFERENCES "User"("id") ON DELETE RESTRICT
);

-- جدول قوالب المطالبات (PromptTemplate)
CREATE TABLE IF NOT EXISTS "PromptTemplate" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "version" VARCHAR(20) NOT NULL,
    "identifier" VARCHAR(50) NOT NULL UNIQUE,
    "content" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" VARCHAR(50),
    "maxTokens" INTEGER,
    CONSTRAINT "PromptTemplate_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT
);

-- جدول سجل التدقيق (AuditLog)
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "eventType" VARCHAR(100) NOT NULL,
    "resourceType" VARCHAR(50),
    "resourceId" UUID,
    "tenantId" UUID,
    "userId" UUID,
    "ipAddress" VARCHAR(45),
    "userAgent" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" UUID,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL,
    CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL
);

-- جدول المقاييس (Metric)
CREATE TABLE IF NOT EXISTS "Metric" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '{}',
    "tenantId" UUID,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Metric_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL
);


-- 4. إنشاء القيود الفريدة (Unique Constraints)
-- ============================================================

-- Tenant: الاسم فريد
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_name_key" UNIQUE ("name");

-- Tenant: النطاق فريد
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_domain_key" UNIQUE ("domain");

-- User: فريد لكل مستأجر وبريد إلكتروني
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_email_key" UNIQUE ("tenantId", "email");

-- KnowledgeBase: فريد لكل مستأجر واسم
ALTER TABLE "KnowledgeBase" ADD CONSTRAINT "KnowledgeBase_tenantId_name_key" UNIQUE ("tenantId", "name");

-- Document: فريد لكل مستأجر وقاعدة معرفة واسم ملف
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_knowledgeBaseId_fileName_key" UNIQUE ("tenantId", "knowledgeBaseId", "fileName");

-- Conversation: فريد لكل مستأجر ورقم هاتف (محادثة نشطة واحدة لكل رقم)
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_phoneNumberId_key" UNIQUE ("tenantId", "phoneNumberId");


-- 5. إنشاء الفهارس (Indexes)
-- ============================================================

-- فهارس Tenant
CREATE INDEX IF NOT EXISTS "Tenant_status_idx" ON "Tenant" ("status");
CREATE INDEX IF NOT EXISTS "Tenant_domain_idx" ON "Tenant" ("domain");
CREATE INDEX IF NOT EXISTS "Tenant_deletedAt_idx" ON "Tenant" ("deletedAt");

-- فهارس User
CREATE INDEX IF NOT EXISTS "User_tenantId_status_idx" ON "User" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User" ("email");
CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User" ("deletedAt");

-- فهارس RefreshToken
CREATE INDEX IF NOT EXISTS "RefreshToken_token_idx" ON "RefreshToken" ("token");
CREATE INDEX IF NOT EXISTS "RefreshToken_userId_expiresAt_idx" ON "RefreshToken" ("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "RefreshToken_revokedAt_idx" ON "RefreshToken" ("revokedAt");

-- فهارس KnowledgeBase
CREATE INDEX IF NOT EXISTS "KnowledgeBase_tenantId_isActive_idx" ON "KnowledgeBase" ("tenantId", "isActive");
CREATE INDEX IF NOT EXISTS "KnowledgeBase_tenantId_createdAt_idx" ON "KnowledgeBase" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "KnowledgeBase_deletedAt_idx" ON "KnowledgeBase" ("deletedAt");

-- فهارس Document
CREATE INDEX IF NOT EXISTS "Document_tenantId_knowledgeBaseId_status_idx" ON "Document" ("tenantId", "knowledgeBaseId", "status");
CREATE INDEX IF NOT EXISTS "Document_tenantId_status_idx" ON "Document" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "Document_knowledgeBaseId_status_idx" ON "Document" ("knowledgeBaseId", "status");
CREATE INDEX IF NOT EXISTS "Document_tenantId_createdAt_idx" ON "Document" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Document_deletedAt_idx" ON "Document" ("deletedAt");

-- فهارس DocumentChunk
CREATE INDEX IF NOT EXISTS "DocumentChunk_documentId_chunkIndex_idx" ON "DocumentChunk" ("documentId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "DocumentChunk_tenantId_knowledgeBaseId_idx" ON "DocumentChunk" ("tenantId", "knowledgeBaseId");
CREATE INDEX IF NOT EXISTS "DocumentChunk_knowledgeBaseId_idx" ON "DocumentChunk" ("knowledgeBaseId");

-- فهارس pgvector للبحث السريع (IVFFlat)
-- قائمة = 100 (مناسبة للبيانات المتوسطة، يمكن تعديلها حسب حجم البيانات)
-- يتم إنشاء فهرس IVFFlat على عمود vector باستخدام مسافة جيب التمام (cosine)
CREATE INDEX IF NOT EXISTS "DocumentChunk_vector_idx" ON "DocumentChunk" 
USING ivfflat ("vector" vector_cosine_ops) WITH (lists = 100);

-- فهارس Conversation
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_status_idx" ON "Conversation" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_phoneNumberId_idx" ON "Conversation" ("tenantId", "phoneNumberId");
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_createdAt_idx" ON "Conversation" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Conversation_status_createdAt_idx" ON "Conversation" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Conversation_deletedAt_idx" ON "Conversation" ("deletedAt");

-- فهارس Message
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message" ("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_tenantId_conversationId_idx" ON "Message" ("tenantId", "conversationId");
CREATE INDEX IF NOT EXISTS "Message_externalId_idx" ON "Message" ("externalId");
CREATE INDEX IF NOT EXISTS "Message_sentBy_createdAt_idx" ON "Message" ("sentBy", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_deletedAt_idx" ON "Message" ("deletedAt");

-- فهارس PromptTemplate
CREATE INDEX IF NOT EXISTS "PromptTemplate_identifier_version_idx" ON "PromptTemplate" ("identifier", "version");
CREATE INDEX IF NOT EXISTS "PromptTemplate_isActive_idx" ON "PromptTemplate" ("isActive");
CREATE INDEX IF NOT EXISTS "PromptTemplate_createdAt_idx" ON "PromptTemplate" ("createdAt");

-- فهارس AuditLog
CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_timestamp_idx" ON "AuditLog" ("tenantId", "timestamp");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_timestamp_idx" ON "AuditLog" ("userId", "timestamp");
CREATE INDEX IF NOT EXISTS "AuditLog_eventType_timestamp_idx" ON "AuditLog" ("eventType", "timestamp");
CREATE INDEX IF NOT EXISTS "AuditLog_resourceType_resourceId_idx" ON "AuditLog" ("resourceType", "resourceId");
CREATE INDEX IF NOT EXISTS "AuditLog_correlationId_idx" ON "AuditLog" ("correlationId");
CREATE INDEX IF NOT EXISTS "AuditLog_timestamp_idx" ON "AuditLog" ("timestamp");

-- فهارس Metric
CREATE INDEX IF NOT EXISTS "Metric_name_timestamp_idx" ON "Metric" ("name", "timestamp");
CREATE INDEX IF NOT EXISTS "Metric_tenantId_name_timestamp_idx" ON "Metric" ("tenantId", "name", "timestamp");


-- 6. تحديث triggers للحفاظ على updatedAt تلقائياً
-- ============================================================

-- دالة مساعدة لتحديث updatedAt
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- تطبيق trigger على الجداول التي تحتوي على updatedAt
DROP TRIGGER IF EXISTS update_Tenant_updatedAt ON "Tenant";
CREATE TRIGGER update_Tenant_updatedAt
    BEFORE UPDATE ON "Tenant"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_User_updatedAt ON "User";
CREATE TRIGGER update_User_updatedAt
    BEFORE UPDATE ON "User"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_KnowledgeBase_updatedAt ON "KnowledgeBase";
CREATE TRIGGER update_KnowledgeBase_updatedAt
    BEFORE UPDATE ON "KnowledgeBase"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_Document_updatedAt ON "Document";
CREATE TRIGGER update_Document_updatedAt
    BEFORE UPDATE ON "Document"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_Conversation_updatedAt ON "Conversation";
CREATE TRIGGER update_Conversation_updatedAt
    BEFORE UPDATE ON "Conversation"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_PromptTemplate_updatedAt ON "PromptTemplate";
CREATE TRIGGER update_PromptTemplate_updatedAt
    BEFORE UPDATE ON "PromptTemplate"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- 7. تعليقات توضيحية (اختيارية للتوثيق)
-- ============================================================

COMMENT ON TABLE "Tenant" IS 'جدول المستأجرين (الشركات/المؤسسات) — SSoT للبيانات متعددة المستأجرين';
COMMENT ON TABLE "User" IS 'جدول المستخدمين (التسجيل والمصادقة)';
COMMENT ON TABLE "RefreshToken" IS 'جدول توكنات التحديث (Refresh Tokens) — للمصادقة';
COMMENT ON TABLE "KnowledgeBase" IS 'جدول قواعد المعرفة (Knowledge Bases)';
COMMENT ON TABLE "Document" IS 'جدول المستندات (الملفات المرفوعة)';
COMMENT ON TABLE "DocumentChunk" IS 'جدول مقاطع المستندات (مع المتجهات) — pgvector';
COMMENT ON TABLE "Conversation" IS 'جدول المحادثات (Conversations)';
COMMENT ON TABLE "Message" IS 'جدول الرسائل (Messages)';
COMMENT ON TABLE "PromptTemplate" IS 'جدول قوالب المطالبات (Prompts) — مُصدرة ومُرقمة — §6';
COMMENT ON TABLE "AuditLog" IS 'جدول سجل التدقيق (Audit Log) — §7';
COMMENT ON TABLE "Metric" IS 'جدول المقاييس (Metrics) — لتخزين مقاييس RED ومقاييس الذكاء الاصطناعي';

COMMENT ON COLUMN "DocumentChunk"."vector" IS 'متجه التضمين (pgvector) — البعد 1024';
COMMENT ON COLUMN "Conversation"."messageCount" IS 'عدد الرسائل (مشتق)';
COMMENT ON COLUMN "Message"."metadata" IS '{ citations, suggestedQuestions, contextChunks, error, tokensUsed, etc. }';
COMMENT ON COLUMN "Document"."status" IS 'حالة المستند: PENDING, PROCESSING, COMPLETED, FAILED, DELETED';
COMMENT ON COLUMN "RefreshToken"."revokedAt" IS 'وقت الإلغاء (إذا تم إلغاء التوكن)';
COMMENT ON COLUMN "AuditLog"."correlationId" IS 'معرّف الارتباط (من middleware)';