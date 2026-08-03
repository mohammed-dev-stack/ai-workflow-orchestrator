// ============================================================
// backend/src/models/prisma/client.ts
// ============================================================
// عميل Prisma المُهيأ مع المحول (Adapter) المطلوب في Prisma 7.
// المصدر الوحيد (SSoT) للوصول إلى قاعدة البيانات في التطبيق.
// تم إصلاح مشكلة النوع في خيار `log` باستخدام `as const`.
// ============================================================

// ✅ استيراد PrismaClient والأنواع من المسار المُولَّد
import { PrismaClient, Prisma } from '../../generated/prisma/index.js';
// ✅ استيراد المحول (adapter) لـ PostgreSQL
import { PrismaPg } from '@prisma/adapter-pg';
// ✅ استيراد تجمع الاتصالات من pg
import { Pool } from 'pg';
import { config } from '../../config/index.js';
import { logger } from '../../observability/logger.js';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware.js';

// ============================================================
// 1. خيارات تهيئة عميل Prisma
// ============================================================

export interface PrismaClientOptions {
  /** ما إذا كان سيتم تمكين التسجيل التفصيلي (افتراضي: false في الإنتاج) */
  verboseLogging?: boolean;

  /** مهلة الاتصال بالمللي ثانية (افتراضي: من config.database.poolTimeout) */
  connectionTimeoutMs?: number;

  /** الحد الأقصى لعدد الاتصالات في التجمع (افتراضي: 10) */
  maxPoolConnections?: number;

  /** مدة بقاء الاتصال الخامل قبل إغلاقه بالمللي ثانية (افتراضي: 30000) */
  idleTimeoutMs?: number;
}

/**
 * القيم الافتراضية لخيارات Prisma.
 */
const DEFAULT_OPTIONS: Required<PrismaClientOptions> = {
  verboseLogging: config.env.isDevelopment,
  connectionTimeoutMs: config.database?.poolTimeout || 10000,
  maxPoolConnections: 10,
  idleTimeoutMs: 30000,
};

// ============================================================
// 2. عميل Prisma (Singleton) مع محول Prisma 7
// ============================================================

class PrismaClientSingleton {
  private static instance: PrismaClient | null = null;

  /**
   * الحصول على نسخة عميل Prisma (Singleton).
   * يُنشئ العميل إذا لم يكن موجوداً مسبقاً.
   */
  static getInstance(options: PrismaClientOptions = {}): PrismaClient {
    if (!this.instance) {
      this.instance = this.createClient(options);
      this.instance.$connect()
        .then(() => {
          logger.info('✅ تم الاتصال بقاعدة البيانات بنجاح', {
            databaseUrl: config.database.url.replace(/:[^:@]*@/, ':****@'),
          });
        })
        .catch((error) => {
          logger.error('❌ فشل الاتصال بقاعدة البيانات', {
            error: error instanceof Error ? error.message : 'unknown',
          });
        });
    }
    return this.instance;
  }

  /**
   * إنشاء عميل Prisma جديد مع الخيارات والوسائط.
   * ✅ يستخدم PrismaPg adapter المطلوب في Prisma 7.
   * ✅ تم إصلاح مشكلة النوع في `log` باستخدام `as const`.
   */
  private static createClient(options: PrismaClientOptions): PrismaClient {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // 1️⃣ إنشاء تجمع اتصالات PostgreSQL
    const pool = new Pool({
      connectionString: config.database.url,
      max: opts.maxPoolConnections,
      idleTimeoutMillis: opts.idleTimeoutMs,
      connectionTimeoutMillis: opts.connectionTimeoutMs,
    });

    // 2️⃣ إنشاء المحول (adapter) المطلوب في Prisma 7
    const adapter = new PrismaPg(pool);

    // 3️⃣ بناء خيارات Prisma مع التأكد من صحة الأنواع
    const prismaOptions: Prisma.PrismaClientOptions = {
      adapter,
      log: opts.verboseLogging
        ? ([
            { level: 'query' as const, emit: 'stdout' as const },
            { level: 'info' as const, emit: 'stdout' as const },
            { level: 'warn' as const, emit: 'stdout' as const },
            { level: 'error' as const, emit: 'stdout' as const },
          ] as const)
        : ([
            { level: 'error' as const, emit: 'stdout' as const },
            { level: 'warn' as const, emit: 'stdout' as const },
          ] as const),
      transactionOptions: {
        timeout: opts.connectionTimeoutMs,
        isolationLevel: 'ReadCommitted' as const,
      },
      // ✅ تم إزالة datasources و $use (غير مدعومة في Prisma 7)
    };

    // 4️⃣ إنشاء العميل
    const client = new PrismaClient(prismaOptions);

    return client;
  }

  /**
   * إعادة تعيين العميل (للاستخدام في الاختبارات).
   */
  static resetInstance(): void {
    if (this.instance) {
      this.instance.$disconnect().catch((error) => {
        logger.warn('⚠️ فشل قطع الاتصال بقاعدة البيانات أثناء إعادة التعيين', {
          error: error instanceof Error ? error.message : 'unknown',
        });
      });
      this.instance = null;
    }
  }

  /**
   * التحقق من صحة الاتصال بقاعدة البيانات (فشل سريع).
   */
  static async validateConnection(): Promise<boolean> {
    const client = this.getInstance();
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    try {
      await client.$queryRaw`SELECT 1 as connected`;
      logger.debug('✅ تم التحقق من اتصال قاعدة البيانات', { correlationId });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown error';
      logger.error('❌ فشل التحقق من اتصال قاعدة البيانات', {
        correlationId,
        error: errorMessage,
      });
      throw new Error(`فشل الاتصال بقاعدة البيانات: ${errorMessage}`);
    }
  }

  /**
   * قطع الاتصال بقاعدة البيانات (للاستخدام عند إيقاف التطبيق).
   */
  static async disconnect(): Promise<void> {
    if (this.instance) {
      await this.instance.$disconnect();
      logger.info('✅ تم قطع الاتصال بقاعدة البيانات');
      this.instance = null;
    }
  }
}

// ============================================================
// 3. تصدير عميل Prisma (Singleton)
// ============================================================

/**
 * المصدر الوحيد (SSoT) للوصول إلى قاعدة البيانات.
 */
export const prisma = PrismaClientSingleton.getInstance();

/**
 * تصدير فئة PrismaClientSingleton للاستخدام في الاختبارات والإدارة.
 */
export { PrismaClientSingleton };

/**
 * تصدير دوال مساعدة للتحقق من صحة الاتصال.
 */
export const validateDatabaseConnection = PrismaClientSingleton.validateConnection;
export const disconnectDatabase = PrismaClientSingleton.disconnect;
export const resetPrismaClient = PrismaClientSingleton.resetInstance;

// ============================================================
// 4. تصدير الأنواع والـ enums
// ============================================================

/**
 * تصدير جميع الأنواع من Prisma للاستخدام في التطبيق.
 * يتم استيرادها من المسار المُولَّد لضمان التوافق.
 */
export type { Prisma };

/**
 * تصدير الـ enums من Prisma.
 * تم إزالة UserStatus لأنه غير موجود في schema.prisma.
 */
export {
  UserRole,
  TenantPlan,
  TenantStatus,
  // UserStatus, ❌ غير موجود في schema.prisma
  DocumentStatus,
  ConversationStatus,
  MessageRole,
} from '../../generated/prisma/index.js';

/**
 * تصدير افتراضي للعميل.
 */
export default prisma;
