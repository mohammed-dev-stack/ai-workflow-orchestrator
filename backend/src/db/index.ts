// ============================================================
// backend/src/db/index.ts
// ============================================================
// المصدر الوحيد (SSoT) للوصول إلى قاعدة البيانات و Redis.
// يحتوي على عميل Prisma، عميل Redis، وجميع المستودعات.
// تم إصلاح أخطاء الاستيراد، config.redis، التصديرات المكررة، والأنواع.
// ✅ تم إصلاح مشكلة `tags` و `metadata` في KnowledgeBaseRepository.create.
// ✅ تم إصلاح مشكلة `mimeType` → `fileType` و `storagePath` → `fileUrl` في DocumentRepository.create.
// ✅ تم إضافة دوال الحذف النهائي (Hard Delete) في KnowledgeBaseRepository.
// ============================================================

import Redis from 'ioredis';
// ✅ استيراد PrismaClient من المسار المُولَّد (وليس @prisma/client)
import { PrismaClient, Prisma } from '../generated/prisma/index.js';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';

// استيراد عميل Prisma من client.ts (لإعادة استخدام الاتصال)
import {
  prisma as prismaClient,
  validateDatabaseConnection,
  disconnectDatabase,
} from '../models/prisma/client.js';

// ============================================================
// 1. تصدير عميل Prisma (من client.ts)
// ============================================================

export const prisma = prismaClient;
export { validateDatabaseConnection, disconnectDatabase };

// ============================================================
// 2. عميل Redis (لتخزين مؤقت وقوائم انتظار BullMQ)
// ============================================================

export interface RedisClientOptions {
  connectionTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

// ✅ استخدام config.redis.retry.delayMs بدلاً من config.redis.retryDelay
const DEFAULT_REDIS_OPTIONS: Required<RedisClientOptions> = {
  connectionTimeoutMs: (config.redis?.retry?.delayMs ?? 1000) * 5,
  maxRetries: 10,
  retryDelayMs: config.redis?.retry?.delayMs ?? 1000,
};

class RedisClientSingleton {
  private static instance: Redis | null = null;

  static getInstance(options: RedisClientOptions = {}): Redis {
    if (!this.instance) {
      this.instance = this.createClient(options);
    }
    return this.instance;
  }

  private static createClient(options: RedisClientOptions): Redis {
    const opts = { ...DEFAULT_REDIS_OPTIONS, ...options };

    const client = new Redis(config.redis.url, {
      connectTimeout: opts.connectionTimeoutMs,
      retryStrategy: (times: number) => {
        if (times > opts.maxRetries) {
          logger.error('تجاوز الحد الأقصى لمحاولات إعادة الاتصال بـ Redis', {
            maxRetries: opts.maxRetries,
            attempts: times,
          });
          return null;
        }
        const delay = Math.min(opts.retryDelayMs * Math.pow(2, times - 1), 30000);
        const jitter = delay * 0.1 * Math.random();
        const finalDelay = Math.floor(delay + jitter);
        logger.debug('إعادة محاولة الاتصال بـ Redis', {
          attempt: times,
          delayMs: finalDelay,
          maxRetries: opts.maxRetries,
        });
        return finalDelay;
      },
      lazyConnect: false,
      showFriendlyErrorStack: config.env.isDevelopment,
      enableAutoPipelining: true,
    });

    client.on('connect', () => {
      logger.info('تم الاتصال بـ Redis بنجاح', {
        url: config.redis.url.replace(/:[^:@]*@/, ':****@'),
      });
    });

    client.on('error', (error) => {
      logger.error('خطأ في اتصال Redis', {
        error: error instanceof Error ? error.message : 'unknown',
        url: config.redis.url.replace(/:[^:@]*@/, ':****@'),
      });
    });

    client.on('close', () => {
      logger.warn('تم إغلاق اتصال Redis');
    });

    client.on('reconnecting', (delay: number) => {
      logger.debug('إعادة الاتصال بـ Redis', { delayMs: delay });
    });

    return client;
  }

  static resetInstance(): void {
    if (this.instance) {
      this.instance.quit().catch((error) => {
        logger.warn('فشل قطع اتصال Redis أثناء إعادة التعيين', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      });
      this.instance = null;
    }
  }

  static async disconnect(): Promise<void> {
    if (this.instance) {
      await this.instance.quit();
      logger.info('تم قطع الاتصال بـ Redis');
      this.instance = null;
    }
  }

  static async validateConnection(): Promise<boolean> {
    const client = this.getInstance();
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      const result = await client.ping();
      const isConnected = result === 'PONG';
      if (isConnected) {
        logger.debug('تم التحقق من اتصال Redis', { correlationId });
      } else {
        logger.warn('استجابة Redis غير متوقعة', { correlationId, result });
      }
      return isConnected;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      logger.error('فشل التحقق من اتصال Redis', {
        correlationId,
        error: errorMessage,
      });
      throw new Error(`فشل الاتصال بـ Redis: ${errorMessage}`);
    }
  }
}

export const redis = RedisClientSingleton.getInstance();
export const validateRedisConnection = RedisClientSingleton.validateConnection;
export const disconnectRedis = RedisClientSingleton.disconnect;
export const resetRedisClient = RedisClientSingleton.resetInstance;

// ============================================================
// 3. مستودعات البيانات (Repositories)
// ============================================================

/**
 * مستودع المستأجرين.
 */
export class TenantRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  async findById(id: string) {
    return this.prisma.tenant.findUnique({
      where: { id, deletedAt: null },
    });
  }

  async findByName(name: string) {
    return this.prisma.tenant.findUnique({
      where: { name, deletedAt: null },
    });
  }

  async findByDomain(domain: string) {
    return this.prisma.tenant.findUnique({
      where: { domain, deletedAt: null },
    });
  }

  async findByPhoneNumberId(phoneNumberId: string) {
    return this.prisma.tenant.findFirst({
      where: {
        whatsappPhoneNumberId: phoneNumberId,
        deletedAt: null,
      },
    });
  }

  async findAll(options?: { limit?: number; offset?: number; search?: string }) {
    const { limit = 20, offset = 0, search } = options || {};
    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { domain: { contains: search, mode: 'insensitive' } },
        { adminEmail: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return { items, total };
  }

  async create(data: any) {
    return this.prisma.tenant.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.tenant.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  async softDelete(id: string) {
    return this.prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string) {
    return this.prisma.tenant.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.tenant.update({
      where: { id, deletedAt: null },
      data: { status: status as any },
    });
  }

  async countActive() {
    return this.prisma.tenant.count({
      where: { status: 'ACTIVE', deletedAt: null },
    });
  }

  async getTotalStorageUsage(id: string) {
    const result = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM("fileSize"), 0) as total
      FROM "documents"
      WHERE "tenantId" = ${id}::text AND "deletedAt" IS NULL
    `;
    return Number(result[0]?.total || 0);
  }

  async getAIServiceUsage(id: string, startDate: Date, endDate: Date) {
    const result = await this.prisma.$queryRaw<{ requests: bigint; tokens: bigint }[]>`
      SELECT
        COUNT(*) as requests,
        COALESCE(SUM(("metadata"->>'tokensUsed')::INTEGER), 0) as tokens
      FROM "Message"
      WHERE "tenantId" = ${id}::text
        AND "role" = 'ASSISTANT'
        AND "createdAt" BETWEEN ${startDate} AND ${endDate}
        AND "deletedAt" IS NULL
    `;
    return {
      requests: Number(result[0]?.requests || 0),
      tokens: Number(result[0]?.tokens || 0),
    };
  }
}

/**
 * مستودع المستخدمين.
 */
export class UserRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: { tenant: true },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
      include: { tenant: true },
    });
  }

  async findByTenantIdAndEmail(tenantId: string, email: string) {
    return this.prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email: email.toLowerCase(),
        },
        deletedAt: null,
      },
      include: { tenant: true },
    });
  }

  async create(data: any) {
    return this.prisma.user.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.user.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  async updateLastLogin(id: string, loginAt: Date) {
    return this.prisma.user.update({
      where: { id, deletedAt: null },
      data: { lastLoginAt: loginAt },
    });
  }

  async softDelete(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async findByRefreshToken(refreshToken: string) {
    return this.prisma.refreshToken.findFirst({
      where: { token: refreshToken, revokedAt: null },
      include: { user: true },
    });
  }

  async saveRefreshToken(userId: string, token: string, expiresAt: Date) {
    return this.prisma.refreshToken.create({
      data: { token, userId, expiresAt },
    });
  }

  async deleteRefreshToken(userId: string, token: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, token },
      data: { revokedAt: new Date() },
    });
  }

  async deleteAllRefreshTokens(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

/**
 * مستودع قواعد المعرفة.
 * ✅ تم إضافة دوال الحذف النهائي (hardDelete) وحذف المستندات المرتبطة.
 */
export class KnowledgeBaseRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  async findById(id: string) {
    return this.prisma.knowledgeBase.findUnique({
      where: { id, deletedAt: null },
      include: {
        tenant: { select: { id: true, name: true } },
      },
    });
  }

  async findByTenantId(tenantId: string, options?: { limit?: number; offset?: number; search?: string }) {
    const { limit = 20, offset = 0, search } = options || {};
    const where: any = { tenantId, deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.knowledgeBase.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.knowledgeBase.count({ where }),
    ]);

    return { items, total };
  }

  async findByName(tenantId: string, name: string) {
    return this.prisma.knowledgeBase.findUnique({
      where: {
        tenantId_name: { tenantId, name },
        deletedAt: null,
      },
    });
  }

  /**
   * إنشاء قاعدة معرفة جديدة.
   * ✅ إزالة جميع الحقول غير المعروفة (tags, metadata, createdBy, etc.)
   * والاحتفاظ فقط بالحقول المسموح بها في schema.
   */
  async create(data: any) {
    // نسخ البيانات لتجنب تعديل الكائن الأصلي
    const createData = { ...data };

    // ✅ قائمة الحقول المسموح بها في نموذج KnowledgeBase
    const allowedFields = [
      'id', 'name', 'description', 'tenantId', 'isActive',
      'createdAt', 'updatedAt', 'deletedAt'
    ];

    // حذف أي حقلي غير مسموح بها
    Object.keys(createData).forEach((key) => {
      if (!allowedFields.includes(key)) {
        logger.debug(`حذف حقل غير معروف أثناء إنشاء قاعدة المعرفة: ${key}`);
        delete createData[key];
      }
    });

    // تأكد من أن `description` ليس undefined (Prisma قد يرفض undefined)
    if (createData.description === undefined) {
      createData.description = null;
    }

    return this.prisma.knowledgeBase.create({ data: createData });
  }

  async update(id: string, data: any) {
    return this.prisma.knowledgeBase.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  async softDelete(id: string) {
    return this.prisma.knowledgeBase.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string) {
    return this.prisma.knowledgeBase.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  /**
   * ✅ حذف نهائي (Hard Delete) لقاعدة المعرفة.
   * ⚠️ تحذير: هذا الإجراء لا يمكن التراجع عنه.
   */
  async hardDelete(id: string) {
    return this.prisma.knowledgeBase.delete({
      where: { id },
    });
  }

  /**
   * ✅ حذف مستند نهائياً (Hard Delete).
   * ⚠️ تحذير: هذا الإجراء لا يمكن التراجع عنه.
   */
  async deleteDocument(id: string) {
    return this.prisma.document.delete({
      where: { id },
    });
  }

  /**
   * ✅ حذف مقاطع المستند نهائياً (Hard Delete).
   * ⚠️ تحذير: هذا الإجراء لا يمكن التراجع عنه.
   */
  async deleteDocumentChunks(documentId: string) {
    return this.prisma.documentChunk.deleteMany({
      where: { documentId },
    });
  }

  async countDocuments(knowledgeBaseId: string) {
    return this.prisma.document.count({
      where: { knowledgeBaseId, deletedAt: null },
    });
  }

  async findDocuments(knowledgeBaseId: string, options?: { limit?: number; offset?: number }) {
    const { limit = 20, offset = 0 } = options || {};
    const where = { knowledgeBaseId, deletedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { items, total };
  }
}

/**
 * مستودع المستندات.
 * ✅ تم إصلاح: تحويل `mimeType` → `fileType` و `storagePath` → `fileUrl`.
 * ✅ تم إصلاح: تصفية الحقول غير المعروفة قبل تمريرها إلى Prisma.
 */
export class DocumentRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  async findById(id: string) {
    return this.prisma.document.findUnique({
      where: { id, deletedAt: null },
      include: {
        knowledgeBase: { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true } },
      },
    });
  }

  async findByKnowledgeBaseId(knowledgeBaseId: string, options?: { limit?: number; offset?: number; status?: string }) {
    const { limit = 20, offset = 0, status } = options || {};
    const where: any = { knowledgeBaseId, deletedAt: null };
    if (status) where.status = status as any;

    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { items, total };
  }

  async findByTenantId(tenantId: string, options?: { limit?: number; offset?: number; search?: string }) {
    const { limit = 20, offset = 0, search } = options || {};
    const where: any = { tenantId, deletedAt: null };

    if (search) {
      where.OR = [
        { fileName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: { knowledgeBase: { select: { name: true } } },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { items, total };
  }

  async findByFileName(tenantId: string, knowledgeBaseId: string, fileName: string) {
    return this.prisma.document.findUnique({
      where: {
        tenantId_knowledgeBaseId_fileName: { tenantId, knowledgeBaseId, fileName },
        deletedAt: null,
      },
    });
  }

  /**
   * إنشاء مستند جديد.
   * ✅ تحويل mimeType → fileType
   * ✅ تحويل storagePath → fileUrl
   * ✅ حذف أي حقول غير معروفة.
   */
  async create(data: any) {
    // نسخ البيانات لتجنب تعديل الكائن الأصلي
    const createData = { ...data };

    // ✅ تحويل mimeType إلى fileType إن وجد
    if (createData.mimeType) {
      createData.fileType = createData.mimeType;
      delete createData.mimeType;
    }

    // ✅ تحويل storagePath إلى fileUrl إن وجد
    if (createData.storagePath) {
      createData.fileUrl = createData.storagePath;
      delete createData.storagePath;
    }

    // ✅ إزالة أي حقول غير معروفة (للأمان)
    const allowedFields = [
      'id', 'tenantId', 'knowledgeBaseId', 'fileName', 'fileType',
      'fileSize', 'fileUrl', 'description', 'status', 'errorMessage',
      'metadata', 'createdAt', 'updatedAt', 'deletedAt'
    ];
    Object.keys(createData).forEach((key) => {
      if (!allowedFields.includes(key)) {
        logger.warn(`تم إزالة حقل غير معروف أثناء إنشاء المستند: ${key}`);
        delete createData[key];
      }
    });

    return this.prisma.document.create({ data: createData });
  }

  async update(id: string, data: any) {
    return this.prisma.document.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  async softDelete(id: string) {
    return this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string) {
    return this.prisma.document.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async updateStatus(id: string, status: string, errorMessage?: string) {
    return this.prisma.document.update({
      where: { id, deletedAt: null },
      data: { status: status as any, errorMessage },
    });
  }

  async countByKnowledgeBaseId(knowledgeBaseId: string) {
    return this.prisma.document.count({
      where: { knowledgeBaseId, deletedAt: null },
    });
  }

  async countByStatusAndDateRange(tenantId: string, startDate: Date, endDate: Date) {
    const result = await this.prisma.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT "status", COUNT(*) as count
      FROM "documents"
      WHERE "tenantId" = ${tenantId}::text
        AND "createdAt" BETWEEN ${startDate} AND ${endDate}
        AND "deletedAt" IS NULL
      GROUP BY "status"
    `;
    return result.map((r) => ({ status: r.status, count: Number(r.count) }));
  }

  async getTotalStorageSize(tenantId: string) {
    const result = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM("fileSize"), 0) as total
      FROM "documents"
      WHERE "tenantId" = ${tenantId}::text AND "deletedAt" IS NULL
    `;
    return Number(result[0]?.total || 0);
  }
}

/**
 * مستودع مقاطع المستندات (للتضمينات) مع دعم pgvector.
 */
export class DocumentChunkRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  async create(data: any) {
    return this.prisma.documentChunk.create({ data });
  }

  async bulkCreate(data: any[]) {
    return this.prisma.documentChunk.createMany({ data });
  }

  async findByDocumentId(documentId: string) {
    return this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
    });
  }

  async deleteByDocumentId(documentId: string) {
    return this.prisma.documentChunk.deleteMany({
      where: { documentId },
    });
  }

  async countByDocumentId(documentId: string) {
    return this.prisma.documentChunk.count({
      where: { documentId },
    });
  }

  async findSimilarVectors(vector: number[], limit: number, knowledgeBaseId: string, threshold: number = 0.7) {
    const vectorStr = `[${vector.join(',')}]`;

    const result = await this.prisma.$queryRaw<{
      id: string;
      content: string;
      similarity: number;
      metadata: any;
      documentId: string;
      chunkIndex: number;
    }[]>`
      SELECT
        id,
        content,
        (1 - (vector <=> ${vectorStr}::vector)) as similarity,
        metadata,
        "documentId",
        "chunkIndex"
      FROM "DocumentChunk"
      WHERE "knowledgeBaseId" = ${knowledgeBaseId}::text
        AND vector IS NOT NULL
        AND (1 - (vector <=> ${vectorStr}::vector)) >= ${threshold}
      ORDER BY vector <=> ${vectorStr}::vector
      LIMIT ${limit}
    `;

    return result;
  }
}

/**
 * مستودع المحادثات.
 * ✅ تم إصلاح: تحويل customerName إلى title تلقائياً.
 * ✅ تم إصلاح: إزالة knowledgeBaseId لأنه غير موجود في الـ schema.
 */
export class ConversationRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  async findById(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id, deletedAt: null },
      include: { tenant: { select: { id: true, name: true } } },
    });
  }

  async findByTenantIdAndPhone(tenantId: string, phoneNumberId: string) {
    return this.prisma.conversation.findUnique({
      where: {
        tenantId_phoneNumberId: { tenantId, phoneNumberId },
        deletedAt: null,
      },
    });
  }

  async findByTenantId(tenantId: string, options?: { limit?: number; offset?: number }) {
    const { limit = 20, offset = 0 } = options || {};
    const where = { tenantId, deletedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * إنشاء محادثة جديدة.
   * ✅ تحويل customerName إلى title تلقائياً.
   * ✅ إزالة knowledgeBaseId (غير موجود في schema) وتخزينه في metadata.
   */
  async create(data: any) {
    // نسخ البيانات لتجنب تعديل الكائن الأصلي
    const createData = { ...data };

    // ✅ تحويل customerName إلى title إذا كان موجوداً
    if (createData.customerName) {
      createData.title = createData.customerName;
      delete createData.customerName;
    }

    // ✅ إزالة knowledgeBaseId وتخزينه في metadata
    if (createData.knowledgeBaseId) {
      createData.metadata = {
        ...(createData.metadata || {}),
        knowledgeBaseId: createData.knowledgeBaseId,
      };
      delete createData.knowledgeBaseId;
    }

    // ✅ إزالة أي حقول غير معروفة للحفاظ على أمان البيانات
    const allowedFields = [
      'id', 'tenantId', 'userId', 'phoneNumberId', 'externalId',
      'title', 'status', 'lastMessageAt', 'createdAt', 'updatedAt',
      'deletedAt', 'metadata'
    ];
    Object.keys(createData).forEach((key) => {
      if (!allowedFields.includes(key)) {
        logger.warn(`تم إزالة حقل غير معروف أثناء إنشاء المحادثة: ${key}`);
        delete createData[key];
      }
    });

    return this.prisma.conversation.create({ data: createData });
  }

  async update(id: string, data: any) {
    return this.prisma.conversation.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  async softDelete(id: string) {
    return this.prisma.conversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async countByTenantIdAndDateRange(tenantId: string, startDate: Date, endDate: Date, status?: string) {
    const where: any = {
      tenantId,
      createdAt: { gte: startDate, lte: endDate },
      deletedAt: null,
    };
    if (status) where.status = status as any;
    return this.prisma.conversation.count({ where });
  }

  async countByDateRangeGrouped(tenantId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month') {
    let dateFormat: string;
    switch (groupBy) {
      case 'day': dateFormat = 'YYYY-MM-DD'; break;
      case 'week': dateFormat = 'IYYY-"W"IW'; break;
      case 'month': dateFormat = 'YYYY-MM'; break;
      default: dateFormat = 'YYYY-MM-DD';
    }

    const result = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT
        TO_CHAR("createdAt", ${dateFormat}) as date,
        COUNT(*) as count
      FROM "Conversation"
      WHERE "tenantId" = ${tenantId}::text
        AND "createdAt" BETWEEN ${startDate} AND ${endDate}
        AND "deletedAt" IS NULL
      GROUP BY date
      ORDER BY date ASC
    `;

    return result.map((r) => ({ date: r.date, count: Number(r.count) }));
  }
}

/**
 * مستودع الرسائل.
 */
export class MessageRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  async findById(id: string) {
    return this.prisma.message.findUnique({
      where: { id, deletedAt: null },
    });
  }

  async findByConversationId(conversationId: string, options?: { limit?: number; offset?: number }) {
    const { limit = 50, offset = 0 } = options || {};
    const where = { conversationId, deletedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.message.count({ where }),
    ]);

    return { items, total };
  }

  async findByExternalId(externalId: string) {
    return this.prisma.message.findFirst({
      where: { externalId, deletedAt: null },
    });
  }

  async create(data: any) {
    return this.prisma.message.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.message.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  async deleteByConversationId(conversationId: string) {
    return this.prisma.message.updateMany({
      where: { conversationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async countByTenantIdAndDateRange(tenantId: string, startDate: Date, endDate: Date, role?: string) {
    const where: any = {
      tenantId,
      createdAt: { gte: startDate, lte: endDate },
      deletedAt: null,
    };
    if (role) where.role = role as any;
    return this.prisma.message.count({ where });
  }

  async countByDateRangeGrouped(tenantId: string, startDate: Date, endDate: Date, groupBy: 'day' | 'week' | 'month') {
    let dateFormat: string;
    switch (groupBy) {
      case 'day': dateFormat = 'YYYY-MM-DD'; break;
      case 'week': dateFormat = 'IYYY-"W"IW'; break;
      case 'month': dateFormat = 'YYYY-MM'; break;
      default: dateFormat = 'YYYY-MM-DD';
    }

    const result = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT
        TO_CHAR("createdAt", ${dateFormat}) as date,
        COUNT(*) as count
      FROM "Message"
      WHERE "tenantId" = ${tenantId}::text
        AND "createdAt" BETWEEN ${startDate} AND ${endDate}
        AND "deletedAt" IS NULL
      GROUP BY date
      ORDER BY date ASC
    `;

    return result.map((r) => ({ date: r.date, count: Number(r.count) }));
  }

  async countByRoleAndDateRange(tenantId: string, startDate: Date, endDate: Date) {
    const result = await this.prisma.$queryRaw<{ role: string; count: bigint }[]>`
      SELECT
        role,
        COUNT(*) as count
      FROM "Message"
      WHERE "tenantId" = ${tenantId}::text
        AND "createdAt" BETWEEN ${startDate} AND ${endDate}
        AND "deletedAt" IS NULL
      GROUP BY role
    `;
    return result.map((r) => ({ role: r.role, count: Number(r.count) }));
  }
}

/**
 * مستودع قوالب المطالبات.
 */
export class PromptTemplateRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.prisma = prismaClient;
  }

  async findById(id: string) {
    return this.prisma.promptTemplate.findUnique({
      where: { id },
    });
  }

  async findByIdentifier(identifier: string) {
    return this.prisma.promptTemplate.findFirst({
      where: { identifier, isActive: true },
      orderBy: { version: 'desc' },
    });
  }

  async findAllActive() {
    return this.prisma.promptTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: any) {
    return this.prisma.promptTemplate.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.promptTemplate.update({
      where: { id },
      data,
    });
  }

  async softDelete(id: string) {
    return this.prisma.promptTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }
}

// ============================================================
// 4. تصدير جميع المستودعات (ككائن) – للاستخدام السهل
// ============================================================

export const repositories = {
  tenant: new TenantRepository(),
  user: new UserRepository(),
  knowledgeBase: new KnowledgeBaseRepository(),
  document: new DocumentRepository(),
  documentChunk: new DocumentChunkRepository(),
  conversation: new ConversationRepository(),
  message: new MessageRepository(),
  promptTemplate: new PromptTemplateRepository(),
};

// ============================================================
// 5. تصدير الأنواع والإضافات – مرة واحدة فقط
// ============================================================

// ✅ تصدير Prisma و enums من المسار الصحيح
export { Prisma };

// ✅ تصدير الـ enums الموجودة في الـ schema فعلياً
export {
  UserRole,
  TenantPlan,
  TenantStatus,
  DocumentStatus,
  ConversationStatus,
  MessageRole,
} from '../generated/prisma/index.js';

