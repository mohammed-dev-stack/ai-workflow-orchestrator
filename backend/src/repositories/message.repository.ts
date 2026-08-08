// ============================================================
// backend/src/repositories/message.repository.ts
// ============================================================
// مستودع الرسائل (Message Repository)
// يدير عمليات CRUD والتحليلات على جدول الرسائل.
// ✅ تم إصلاح العطل الحقيقي هنا: كان يستخدم "Message" (بحرف M كبير)
// بينما الـ @@map في schema.prisma هو "messages" (بحرف m صغير).
// الآن يستخدم tableNameMapper للحصول على الاسم الصحيح ديناميكياً.
// ============================================================

import { PrismaClient, Message, Prisma } from '../generated/prisma/index.js';
import { getTableName } from '../utils/tableNameMapper.js'; // ✅ استيراد الحل المركز

export interface FindMessagesOptions {
  /** عدد العناصر في الصفحة (افتراضي: 50) */
  limit?: number;
  /** الإزاحة (للتقسيم إلى صفحات) */
  offset?: number;
  /** ترتيب النتائج (افتراضي: 'asc' حسب createdAt) */
  orderBy?: 'asc' | 'desc';
}

/**
 * نتيجة جلب قائمة الرسائل.
 */
export interface FindMessagesResult {
  items: Message[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * مستودع الرسائل (Message Repository).
 * يوفر واجهة بيانات خالصة للوصول إلى جدول `Message` في قاعدة البيانات.
 * يستخدم Prisma Client للتفاعل مع PostgreSQL.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع دوال CRUD الأساسية مع دعم الترحيل والحذف الناعم.
 */
export class MessageRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * جلب رسالة بواسطة المعرف (مع التحقق من soft delete).
   */
  async findById(id: string): Promise<Message | null> {
    return this.prisma.message.findUnique({
      where: { id, deletedAt: null },
    });
  }

  /**
   * جلب رسالة بواسطة المعرف الخارجي (مثل معرف رسالة WhatsApp).
   */
  async findByExternalId(externalId: string): Promise<Message | null> {
    return this.prisma.message.findFirst({
      where: { externalId, deletedAt: null },
    });
  }

  /**
   * جلب قائمة رسائل محادثة مع الترحيل.
   */
  async findByConversationId(
    conversationId: string,
    options: FindMessagesOptions = {}
  ): Promise<FindMessagesResult> {
    const { limit = 50, offset = 0, orderBy = 'asc' } = options;

    const where: Prisma.MessageWhereInput = {
      conversationId,
      deletedAt: null,
    };

    const [items, total] = await Promise.all([
      this.prisma.message.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: orderBy },
      }),
      this.prisma.message.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  /**
   * جلب آخر رسالة في محادثة (للسياق).
   */
  async findLastByConversationId(conversationId: string): Promise<Message | null> {
    return this.prisma.message.findFirst({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * إنشاء رسالة جديدة.
   */
  async create(data: Prisma.MessageCreateInput): Promise<Message> {
    return this.prisma.message.create({ data });
  }

  /**
   * تحديث رسالة موجودة.
   */
  async update(id: string, data: Prisma.MessageUpdateInput): Promise<Message> {
    return this.prisma.message.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  /**
   * حذف رسالة (حذف ناعم — soft delete).
   */
  async softDelete(id: string): Promise<Message> {
    return this.prisma.message.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * حذف جميع رسائل محادثة (حذف ناعم).
   */
  async softDeleteByConversationId(conversationId: string): Promise<{ count: number }> {
    const result = await this.prisma.message.updateMany({
      where: { conversationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { count: result.count };
  }

  /**
   * حذف رسالة (حذف فعلي — للصيانة فقط، يُستخدم بحذر).
   */
  async delete(id: string): Promise<Message> {
    return this.prisma.message.delete({
      where: { id },
    });
  }

  /**
   * حذف جميع رسائل محادثة (حذف فعلي — للصيانة فقط).
   */
  async deleteByConversationId(conversationId: string): Promise<{ count: number }> {
    const result = await this.prisma.message.deleteMany({
      where: { conversationId },
    });
    return { count: result.count };
  }

  /**
   * حساب عدد الرسائل في محادثة.
   */
  async countByConversationId(conversationId: string): Promise<number> {
    return this.prisma.message.count({
      where: { conversationId, deletedAt: null },
    });
  }

  // ============================================================
  // دوال التحليلات (Analytics) — تم إصلاحها بالكامل
  // ============================================================

  /**
   * حساب عدد الرسائل لمستأجر في نطاق زمني (للتحليلات).
   */
  async countByTenantIdAndDateRange(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    role?: string
  ): Promise<number> {
    const where: Prisma.MessageWhereInput = {
      tenantId,
      createdAt: { gte: startDate, lte: endDate },
      deletedAt: null,
    };
    if (role) {
      where.role = role as any;
    }
    return this.prisma.message.count({ where });
  }

  /**
   * ✅ تم إصلاح هذه الدالة بالكامل.
   * كانت تستخدم FROM "Message" (بحرف M كبير) مما يسبب خطأ
   * relation "Message" does not exist.
   * الآن تستخدم getTableName('Message') الذي يعيد 'messages' (بحرف m صغير).
   */
  async countByDateRangeGrouped(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    groupBy: 'day' | 'week' | 'month'
  ): Promise<{ date: string; count: number }[]> {
    let dateFormat: string;
    switch (groupBy) {
      case 'day':
        dateFormat = 'YYYY-MM-DD';
        break;
      case 'week':
        dateFormat = 'IYYY-"W"IW';
        break;
      case 'month':
        dateFormat = 'YYYY-MM';
        break;
      default:
        dateFormat = 'YYYY-MM-DD';
    }

    // ✅ استخراج اسم الجدول الفعلي ('messages' وليس 'Message')
    const tableName = getTableName('Message');

    const result = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT
        TO_CHAR("createdAt", ${dateFormat}) as date,
        COUNT(*) as count
      FROM "${Prisma.raw(tableName)}"
      WHERE "tenantId" = ${tenantId}::text
        AND "createdAt" BETWEEN ${startDate} AND ${endDate}
        AND "deletedAt" IS NULL
      GROUP BY date
      ORDER BY date ASC
    `;

    return result.map((r) => ({ date: r.date, count: Number(r.count) }));
  }

  /**
   * ✅ تم إصلاح هذه الدالة أيضاً (نفس المشكلة).
   * كانت تستخدم FROM "Message" بشكل ثابت.
   */
  async countByRoleAndDateRange(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{ role: string; count: number }[]> {
    // ✅ استخراج اسم الجدول الفعلي ('messages')
    const tableName = getTableName('Message');

    const result = await this.prisma.$queryRaw<{ role: string; count: bigint }[]>`
      SELECT
        role,
        COUNT(*) as count
      FROM "${Prisma.raw(tableName)}"
      WHERE "tenantId" = ${tenantId}::text
        AND "createdAt" BETWEEN ${startDate} AND ${endDate}
        AND "deletedAt" IS NULL
      GROUP BY role
    `;
    return result.map((r) => ({ role: r.role, count: Number(r.count) }));
  }
}