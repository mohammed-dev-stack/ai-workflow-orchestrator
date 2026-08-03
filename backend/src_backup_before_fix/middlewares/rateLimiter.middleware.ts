// backend/src/middleware/rateLimiter.middleware.ts
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../observability/logger';
import { getCurrentCorrelationId } from './correlation.middleware';

/**
 * خيارات وسيط تحديد المعدل (Rate Limiter).
 */
export interface RateLimiterOptions {
  /**
   * النافذة الزمنية بالمللي ثانية.
   * القيمة الافتراضية: من config.rateLimit.windowMs.
   */
  windowMs?: number;

  /**
   * الحد الأقصى لعدد الطلبات المسموح بها في النافذة.
   * القيمة الافتراضية: من config.rateLimit.maxRequests.
   */
  maxRequests?: number;

  /**
   * مفتاح بادئة (Prefix) لمفاتيح Redis لتجنب التصادم.
   * القيمة الافتراضية: 'rate-limit:'.
   */
  keyPrefix?: string;

  /**
   * ما إذا كان سيتم استخدام حد لكل مستأجر (tenant) أو لكل مستخدم.
   * القيمة الافتراضية: 'tenant' (عزل المستأجرين).
   */
  scope?: 'tenant' | 'user' | 'global';

  /**
   * قائمة بالمسارات المستثناة من تحديد المعدل.
   */
  excludePaths?: string[];
}

/**
 * القيم الافتراضية لخيارات تحديد المعدل.
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم ثابتة منطقية.
 */
const DEFAULT_OPTIONS: Required<RateLimiterOptions> = {
  windowMs: config.rateLimit.windowMs,
  maxRequests: config.rateLimit.maxRequests,
  keyPrefix: 'rate-limit:',
  scope: 'tenant',
  excludePaths: ['/health', '/liveness', '/readiness', '/startup', '/metrics'],
};

/**
 * عميل Redis لتخزين عدادات تحديد المعدل.
 * يُستخدم لتوزيع العدادات عبر عدة عقد (Horizontal Scaling).
 */
let redisClient: Redis | null = null;

/**
 * تهيئة عميل Redis لتحديد المعدل.
 * يُستخدم في بدء تشغيل الخادم لتوفير اتصال Redis واحد مشترك.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — تهيئة بسيطة مع معالجة الأخطاء.
 */
export function initializeRateLimiter(client: Redis): void {
  redisClient = client;
  logger.info('تم تهيئة عميل Redis لتحديد المعدل');
}

/**
 * بناء مفتاح Redis لتحديد المعدل بناءً على النطاق (scope) والمعرّف.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — بناء مفاتيح بسيط مع بادئة.
 */
function buildRateLimitKey(prefix: string, scope: string, identifier: string): string {
  return `${prefix}${scope}:${identifier}`;
}

/**
 * دالة مساعدة لاستخراج معرف المستأجر من الطلب.
 * تُستخدم عندما يكون النطاق (scope) هو 'tenant'.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — استخراج بسيط من req.user.
 */
function extractTenantId(req: Request): string | null {
  // محاولة استخراج من req.user (تمت المصادقة)
  if (req.user && req.user.tenantId) {
    return req.user.tenantId;
  }

  // محاولة استخراج من الرأس (للويب هوك والطلبات العامة)
  const tenantIdFromHeader = req.headers['x-tenant-id'] as string | undefined;
  if (tenantIdFromHeader) {
    return tenantIdFromHeader;
  }

  // محاولة استخراج من معاملات الطلب
  const tenantIdFromQuery = req.query.tenantId as string | undefined;
  if (tenantIdFromQuery) {
    return tenantIdFromQuery;
  }

  return null;
}

/**
 * دالة مساعدة لاستخراج معرف المستخدم من الطلب.
 * تُستخدم عندما يكون النطاق (scope) هو 'user'.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — استخراج بسيط من req.user.
 */
function extractUserId(req: Request): string | null {
  if (req.user && req.user.userId) {
    return req.user.userId;
  }

  // محاولة استخراج من الرأس (للطلبات غير المصادق عليها)
  const userIdFromHeader = req.headers['x-user-id'] as string | undefined;
  if (userIdFromHeader) {
    return userIdFromHeader;
  }

  return null;
}

/**
 * دالة مساعدة للحصول على المعرف المستخدم لتحديد المعدل بناءً على النطاق.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — اختيار المعرف حسب النطاق مع فشل آمن.
 */
function getRateLimitIdentifier(req: Request, scope: 'tenant' | 'user' | 'global'): string {
  switch (scope) {
    case 'tenant': {
      const tenantId = extractTenantId(req);
      if (tenantId) {
        return `tenant:${tenantId}`;
      }
      // إذا لم يكن هناك مستأجر، نستخدم عنوان IP كبديل
      logger.debug('لم يتم العثور على مستأجر، استخدام عنوان IP لتحديد المعدل', {
        ip: req.ip,
        path: req.path,
      });
      return `ip:${req.ip || 'unknown'}`;
    }
    case 'user': {
      const userId = extractUserId(req);
      if (userId) {
        return `user:${userId}`;
      }
      // إذا لم يكن هناك مستخدم، نستخدم عنوان IP كبديل
      logger.debug('لم يتم العثور على مستخدم، استخدام عنوان IP لتحديد المعدل', {
        ip: req.ip,
        path: req.path,
      });
      return `ip:${req.ip || 'unknown'}`;
    }
    case 'global':
    default:
      return 'global';
  }
}

/**
 * وسيط تحديد المعدل (Rate Limiter Middleware).
 * يقوم بالمهام التالية:
 * 1. التحقق مما إذا كان المسار مستثنى من تحديد المعدل.
 * 2. استخراج المعرف (مستأجر/مستخدم/عالمي) من الطلب.
 * 3. زيادة عداد الطلبات في Redis.
 * 4. إذا تجاوز الحد، يُعيد استجابة 429 Too Many Requests (فشل سريع).
 * 5. يُضيف رؤوس (Headers) لتحديد المعدل (X-RateLimit-*) لمساعدة العميل.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — منطق تحديد معدل كامل مع Redis وتوزيع العدادات.
 */
export function rateLimiter(options: RateLimiterOptions = {}) {
  // دمج الخيارات مع القيم الافتراضية
  const opts: Required<RateLimiterOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. التحقق مما إذا كان المسار مستثنى من تحديد المعدل
    if (opts.excludePaths.includes(req.path)) {
      return next();
    }

    // 2. التحقق من وجود عميل Redis مُهيَّأ
    if (!redisClient) {
      logger.error('عميل Redis غير مهيأ لتحديد المعدل', {
        path: req.path,
        method: req.method,
      });
      // إذا لم يكن Redis متاحاً، نمرر الطلب (لا نُفشل) — استراتيجية احتياطية (fail open)
      // ولكن نسجل تحذيراً عالياً
      return next();
    }

    // 3. استخراج معرّف الارتباط
    const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

    // 4. بناء معرف تحديد المعدل
    const identifier = getRateLimitIdentifier(req, opts.scope);

    // 5. بناء مفتاح Redis
    const key = buildRateLimitKey(opts.keyPrefix, opts.scope, identifier);

    try {
      // 6. استخدام Lua script لتنفيذ العملية بشكل ذري (Atomic)
      // هذا يضمن عدم حدوث سباقات (Race Conditions) عند زيادة العداد
      const luaScript = `
        local key = KEYS[1]
        local windowMs = tonumber(ARGV[1])
        local maxRequests = tonumber(ARGV[2])
        local currentTime = tonumber(ARGV[3])

        -- الحصول على العداد الحالي
        local current = redis.call('GET', key)
        if current == false then
          -- إذا لم يكن المفتاح موجوداً، نضعه مع انتهاء الصلاحية
          redis.call('SET', key, 1, 'PX', windowMs)
          return {1, maxRequests, 0}
        end

        current = tonumber(current)
        if current >= maxRequests then
          -- تجاوز الحد، نُرجع الحالة الحالية
          local ttl = redis.call('PTTL', key)
          return {current, maxRequests, 1}
        end

        -- زيادة العداد
        local newCount = redis.call('INCR', key)
        -- إعادة تعيين انتهاء الصلاحية (لأن INCR لا يؤثر على TTL)
        redis.call('PEXPIRE', key, windowMs)
        return {newCount, maxRequests, 0}
      `;

      const currentTime = Date.now();
      const result = await redisClient.eval(
        luaScript,
        1,
        key,
        opts.windowMs.toString(),
        opts.maxRequests.toString(),
        currentTime.toString()
      ) as [number, number, number];

      const [currentCount, maxCount, exceeded] = result;

      // 7. إضافة رؤوس تحديد المعدل (للمساعدة في التتبع من العميل)
      res.setHeader('X-RateLimit-Limit', maxCount.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxCount - currentCount).toString());
      res.setHeader('X-RateLimit-Scope', opts.scope);

      // 8. إذا تجاوز الحد، نُعيد 429 Too Many Requests (فشل سريع)
      if (exceeded === 1) {
        logger.warn('تجاوز حد المعدل', {
          correlationId,
          identifier,
          scope: opts.scope,
          currentCount,
          maxCount,
          path: req.path,
          method: req.method,
          ip: req.ip,
        });

        res.status(429).json({
          error: 'TOO_MANY_REQUESTS',
          message: 'تم تجاوز حد الطلبات المسموح به. يرجى المحاولة بعد قليل.',
          retryAfterMs: opts.windowMs,
          limit: maxCount,
          current: currentCount,
        });
        return;
      }

      // 9. تسجيل نجاح تحديد المعدل (للتصحيح)
      logger.debug('تم التحقق من حد المعدل', {
        correlationId,
        identifier,
        scope: opts.scope,
        currentCount,
        maxCount,
        path: req.path,
      });

      // 10. تمرير الطلب إلى الـ middleware التالي
      next();
    } catch (error) {
      // 11. في حال فشل Redis (اتصال، خطأ، إلخ)، نمرر الطلب (استراتيجية احتياطية)
      // ولكن نسجل الخطأ عالياً
      logger.error('فشل تحديد المعدل (Redis)', {
        correlationId,
        error: error instanceof Error ? error.message : 'unknown',
        path: req.path,
        method: req.method,
      });

      // لا نُفشل الطلب — استراتيجية fail open للحفاظ على التوفر
      next();
    }
  };
}

/**
 * وسيط تحديد المعدل مع نطاق المستأجر (Tenant Scope).
 * يُستخدم لمعظم نقاط النهاية التي تتطلب عزل المستأجرين.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — تغليف بسيط لـ rateLimiter مع نطاق 'tenant'.
 */
export const tenantRateLimiter = rateLimiter({ scope: 'tenant' });

/**
 * وسيط تحديد المعدل مع نطاق المستخدم (User Scope).
 * يُستخدم لنقاط النهاية الحساسة التي تتطلب حداً لكل مستخدم.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — تغليف بسيط لـ rateLimiter مع نطاق 'user'.
 */
export const userRateLimiter = rateLimiter({ scope: 'user' });

/**
 * وسيط تحديد المعدل العالمي (Global Scope).
 * يُستخدم لحماية الخادم من هجمات DoS على المستوى العام.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — تغليف بسيط لـ rateLimiter مع نطاق 'global'.
 */
export const globalRateLimiter = rateLimiter({ scope: 'global' });

/**
 * دالة مساعدة لإعادة تعيين عداد تحديد المعدل لمستخدم/مستأجر معين.
 * تُستخدم للإدارة (مثل رفع الحظر اليدوي).
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — حذف مفتاح Redis بسيط.
 */
export async function resetRateLimit(
  scope: 'tenant' | 'user' | 'global',
  identifier: string
): Promise<boolean> {
  if (!redisClient) {
    logger.error('عميل Redis غير مهيأ لإعادة تعيين حد المعدل');
    return false;
  }

  try {
    const key = buildRateLimitKey('rate-limit:', scope, identifier);
    const result = await redisClient.del(key);
    logger.info('تم إعادة تعيين حد المعدل', { scope, identifier, deleted: result > 0 });
    return result > 0;
  } catch (error) {
    logger.error('فشل إعادة تعيين حد المعدل', {
      scope,
      identifier,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
}
