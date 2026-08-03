// backend/src/repositories/document.repository.ts
import { PrismaClient, Document, Prisma } from '../generated/prisma/index.js';

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

  async findById(id: string): Promise<Document | null> {
    return this.prisma.document.findUnique({
      where: { id, deletedAt: null },
    });
  }

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

  async create(data: Prisma.DocumentCreateInput): Promise<Document> {
    return this.prisma.document.create({ data });
  }

  async update(id: string, data: Prisma.DocumentUpdateInput): Promise<Document> {
    return this.prisma.document.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  async softDelete(id: string): Promise<Document> {
    return this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string): Promise<Document> {
    return this.prisma.document.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

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

  async countByKnowledgeBaseId(knowledgeBaseId: string): Promise<number> {
    return this.prisma.document.count({
      where: { knowledgeBaseId, deletedAt: null },
    });
  }

  // ✅ الدوال المطلوبة للتحليلات (مثل message.repository.ts)
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

    const result = await this.prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT
        TO_CHAR("createdAt", ${dateFormat}) as date,
        COUNT(*) as count
      FROM "documents"
      WHERE "tenantId" = ${tenantId}::UUID
        AND "createdAt" BETWEEN ${startDate} AND ${endDate}
        AND "deletedAt" IS NULL
        AND "status" != 'DELETED'
      GROUP BY date
      ORDER BY date ASC
    `;

    return result.map((r) => ({ date: r.date, count: Number(r.count) }));
  }
}
