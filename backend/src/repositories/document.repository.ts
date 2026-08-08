// ============================================================
// backend/src/repositories/document.repository.ts
// ============================================================
// مستودع المستندات (Document Repository)
// يدير عمليات CRUD والتحليلات على جدول المستندات.
// تم تعديله لاستخدام tableNameMapper للحصول على اسم الجدول الفعلي
// بدلاً من كتابته بشكل ثابت، لضمان التوافق مع @@map في Prisma.
// ============================================================

import { PrismaClient, Document, Prisma } from '../generated/prisma/index.js';
import { getTableName } from '../utils/tableNameMapper.js'; // ✅ استيراد الحل المركزي

export interface FindDocumentsOptions {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  orderBy?: 'asc' | 'desc';
}

export interface FindDocumentsResult {
  items: Document[];
  total: number;
  limit: number;
  offset: number;
}

export class DocumentRepository {
  private prisma: PrismaClient;

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * جلب مستند بواسطة المعرف (مع التحقق من soft delete).
   */
  async findById(id: string): Promise<Document | null> {
    return this.prisma.document.findUnique({
      where: { id, deletedAt: null },
    });
  }

  /**
   * جلب قائمة المستندات الخاصة بقاعدة معرفة محددة مع دعم الترحيل والتصفية.
   */
  async findByKnowledgeBaseId(
    knowledgeBaseId: string,
    options: FindDocumentsOptions = {}
  ): Promise<FindDocumentsResult> {
    const { limit = 50, offset = 0, status } = options;
    const where: Prisma.DocumentWhereInput = {
      knowledgeBaseId,
      deletedAt: null,
      ...(status && { status: status as any }),
    };

    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  /**
   * جلب قائمة المستندات الخاصة بمستأجر معين مع دعم البحث والتصفية.
   */
  async findByTenantId(
    tenantId: string,
    options: FindDocumentsOptions = {}
  ): Promise<FindDocumentsResult> {
    const { limit = 50, offset = 0, search, status } = options;
    const where: Prisma.DocumentWhereInput = {
      tenantId,
      deletedAt: null,
      ...(search && {
        OR: [
          { fileName: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(status && { status: status as any }),
    };

    const [items, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { items, total, limit, offset };
  }

  /**
   * جلب مستند بواسطة اسم الملف (للتأكد من عدم التكرار).
   */
  async findByFileName(
    tenantId: string,
    knowledgeBaseId: string,
    fileName: string
  ): Promise<Document | null> {
    return this.prisma.document.findFirst({
      where: {
        tenantId,
        knowledgeBaseId,
        fileName,
        deletedAt: null,
      },
    });
  }

  /**
   * إنشاء مستند جديد.
   */
  async create(data: Prisma.DocumentCreateInput): Promise<Document> {
    return this.prisma.document.create({ data });
  }

  /**
   * تحديث مستند موجود.
   */
  async update(id: string, data: Prisma.DocumentUpdateInput): Promise<Document> {
    return this.prisma.document.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  /**
   * حذف مستند (حذف ناعم – soft delete).
   */
  async softDelete(id: string): Promise<Document> {
    return this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * استعادة مستند محذوف ناعماً.
   */
  async restore(id: string): Promise<Document> {
    return this.prisma.document.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  /**
   * تحديث حالة المستند (مثل PENDING → PROCESSING → COMPLETED).
   */
  async updateStatus(
    id: string,
    status: string,
    errorMessage?: string
  ): Promise<Document> {
    return this.prisma.document.update({
      where: { id },
      data: {
        status: status as any,
        ...(errorMessage && { errorMessage }),
        ...(status === 'COMPLETED' && { processedAt: new Date() }),
      },
    });
  }

  /**
   * حساب عدد المستندات في قاعدة معرفة محددة.
   */
  async countByKnowledgeBaseId(knowledgeBaseId: string): Promise<number> {
    return this.prisma.document.count({
      where: { knowledgeBaseId, deletedAt: null },
    });
  }

  // ============================================================
  // دوال التحليلات (Analytics) — تم إصلاحها باستخدام tableNameMapper
  // ============================================================

  /**
   * حساب عدد المستندات لمستأجر في نطاق زمني محدد.
   */
  async countByTenantIdAndDateRange(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    status?: string
  ): Promise<number> {
    const where: Prisma.DocumentWhereInput = {
      tenantId,
      createdAt: { gte: startDate, lte: endDate },
      deletedAt: null,
      ...(status && { status: status as any }),
    };
    return this.prisma.document.count({ where });
  }

  /**
   * ✅ تم إصلاح هذه الدالة: كانت تستخدم "documents" بشكل ثابت.
   * الآن تستخرج اسم الجدول الفعلي (الذي قد يكون مختلفاً لو تغير الـ @@map مستقبلاً)
   * باستخدام getTableName('Document').
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

    // ✅ استخراج اسم الجدول الفعلي من الخريطة المركزية
    const tableName = getTableName('Document');

    const result = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT
        TO_CHAR("createdAt", ${dateFormat}) as date,
        COUNT(*) as count
      FROM "${Prisma.raw(tableName)}"
      WHERE "tenantId" = ${tenantId}::text
        AND "createdAt" BETWEEN ${startDate} AND ${endDate}
        AND "deletedAt" IS NULL
        AND "status" != 'DELETED'
      GROUP BY date
      ORDER BY date ASC
    `;

    return result.map((r) => ({ date: r.date, count: Number(r.count) }));
  }
}