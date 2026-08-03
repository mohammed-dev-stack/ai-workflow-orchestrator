// ============================================================
// backend/src/utils/idempotency.ts
// ============================================================
// أدوات التكافؤ (Idempotency) باستخدام Redis.
// ✅ تم إصلاح مشكلة require('crypto') باستخدام import.
// ============================================================

import { randomUUID } from 'crypto';
import crypto from 'crypto'; // ✅ استيراد crypto كـ ES Module
import { redis } from '../db/index.js';
import { config } from '../config/index.js';
import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import {
  ValidationError,
  ConflictError,
  InternalServerError,
} from '../middlewares/errorHandler.middleware.js';

// ============================================================
// أنواع البيانات
// ============================================================

export interface IdempotencyCheckResult {
  isValid: boolean;
  existingResult?: any;
  key: string;
  isExpired: boolean;
}

export interface IdempotencyStoreOptions {
  ttlSeconds?: number;
  overrideIfExists?: boolean;
}

// ============================================================
// القيم الافتراضية
// ============================================================

const DEFAULT_TTL_SECONDS = config.idempotency.ttlSeconds || 86400; // 24 ساعة
const IDEMPOTENCY_KEY_PREFIX = 'idempotency:';

// ============================================================
// دوال توليد المفاتيح
// ============================================================

export function generateIdempotencyKey(): string {
  return randomUUID();
}

export function generateIdempotencyKeyFromInput(
  operation: string,
  ...inputs: (string | number | boolean | null | undefined)[]
): string {
  const normalizedInputs = inputs
    .map((i) => (i === null || i === undefined ? 'null' : String(i)))
    .join(':');
  // ✅ استخدام crypto المستورد (بدلاً من require)
  const hash = crypto
    .createHash('sha256')
    .update(`${operation}:${normalizedInputs}`)
    .digest('hex')
    .substring(0, 32);
  return `${operation}-${hash}`;
}

function buildRedisKey(idempotencyKey: string): string {
  if (!idempotencyKey || idempotencyKey.length > 255) {
    throw new ValidationError('مفتاح التكافؤ غير صالح (طويل جداً أو فارغ)');
  }
  if (!/^[a-zA-Z0-9\-_:]+$/.test(idempotencyKey)) {
    throw new ValidationError('مفتاح التكافؤ يحتوي على رموز غير مسموح بها');
  }
  return `${IDEMPOTENCY_KEY_PREFIX}${idempotencyKey}`;
}

// ============================================================
// دوال التحقق والتخزين
// ============================================================

export async function checkIdempotencyKey(
  idempotencyKey: string
): Promise<IdempotencyCheckResult> {
  const correlationId = getCurrentCorrelationId() || randomUUID();

  try {
    const redisKey = buildRedisKey(idempotencyKey);
    const stored = await redis.get(redisKey);

    if (!stored) {
      return {
        isValid: true,
        key: idempotencyKey,
        isExpired: false,
      };
    }

    try {
      const data = JSON.parse(stored);
      return {
        isValid: false,
        existingResult: data.result,
        key: idempotencyKey,
        isExpired: false,
      };
    } catch (parseError) {
      logger.warn('بيانات تكافؤ غير صالحة في Redis', {
        correlationId,
        idempotencyKey,
        stored: stored.substring(0, 100),
      });
      return {
        isValid: true,
        key: idempotencyKey,
        isExpired: true,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('فشل التحقق من مفتاح التكافؤ', {
      correlationId,
      idempotencyKey,
      error: errorMessage,
    });
    if (error instanceof ValidationError) throw error;
    throw new InternalServerError('فشل التحقق من مفتاح التكافؤ، يرجى المحاولة مرة أخرى');
  }
}

/**
 * تخزين نتيجة عملية مع مفتاح التكافؤ (بعد التنفيذ الناجح).
 */
export async function storeIdempotencyResult(
  idempotencyKey: string,
  result: any,
  options: IdempotencyStoreOptions = {}
): Promise<IdempotencyCheckResult> {
  const correlationId = getCurrentCorrelationId() || randomUUID();
  const {
    ttlSeconds = DEFAULT_TTL_SECONDS,
    overrideIfExists = false,
  } = options;

  try {
    const redisKey = buildRedisKey(idempotencyKey);
    const dataToStore = JSON.stringify({
      result,
      storedAt: new Date().toISOString(),
      correlationId,
    });

    if (overrideIfExists) {
      await redis.set(redisKey, dataToStore);
      await redis.expire(redisKey, ttlSeconds);
      return {
        isValid: true,
        key: idempotencyKey,
        isExpired: false,
      };
    }

    const setResult = await redis.setnx(redisKey, dataToStore);

    if (setResult === 1) {
      await redis.expire(redisKey, ttlSeconds);
      logger.debug('تم تخزين مفتاح التكافؤ', {
        correlationId,
        idempotencyKey,
        ttlSeconds,
      });
      return {
        isValid: true,
        key: idempotencyKey,
        isExpired: false,
      };
    }

    const stored = await redis.get(redisKey);
    if (stored) {
      try {
        const data = JSON.parse(stored);
        logger.info('مفتاح تكافؤ مستخدم مسبقاً، إعادة النتيجة المخزنة', {
          correlationId,
          idempotencyKey,
          storedAt: data.storedAt,
        });
        return {
          isValid: false,
          existingResult: data.result,
          key: idempotencyKey,
          isExpired: false,
        };
      } catch (parseError) {
        logger.warn('بيانات تكافؤ غير صالحة أثناء التخزين', {
          correlationId,
          idempotencyKey,
        });
        return {
          isValid: true,
          key: idempotencyKey,
          isExpired: true,
        };
      }
    }

    return {
      isValid: true,
      key: idempotencyKey,
      isExpired: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('فشل تخزين مفتاح التكافؤ', {
      correlationId,
      idempotencyKey,
      error: errorMessage,
    });
    if (error instanceof ValidationError) throw error;
    throw new InternalServerError('فشل تخزين مفتاح التكافؤ، يرجى المحاولة مرة أخرى');
  }
}

/**
 * تنفيذ عملية مع تكافؤ (Idempotent Operation).
 */
export async function withIdempotency<T>(
  idempotencyKey: string | undefined,
  operation: () => Promise<T>,
  options: IdempotencyStoreOptions = {}
): Promise<{ result: T; isNew: boolean }> {
  const correlationId = getCurrentCorrelationId() || randomUUID();
  const key = idempotencyKey || generateIdempotencyKey();

  const checkResult = await checkIdempotencyKey(key);
  if (!checkResult.isValid && !checkResult.isExpired) {
    logger.debug('تم العثور على نتيجة مخزنة لمفتاح التكافؤ', {
      correlationId,
      idempotencyKey: key,
    });
    return {
      result: checkResult.existingResult as T,
      isNew: false,
    };
  }

  let result: T;
  try {
    result = await operation();
  } catch (error) {
    logger.warn('فشلت العملية في withIdempotency، لن يتم تخزين النتيجة', {
      correlationId,
      idempotencyKey: key,
      error: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }

  const storeResult = await storeIdempotencyResult(key, result, options);
  if (!storeResult.isValid && !storeResult.isExpired) {
    logger.info('تم اكتشاف سباق حالة في withIdempotency، إعادة النتيجة المخزنة', {
      correlationId,
      idempotencyKey: key,
    });
    return {
      result: storeResult.existingResult as T,
      isNew: false,
    };
  }

  return {
    result,
    isNew: true,
  };
}

export async function deleteIdempotencyKey(idempotencyKey: string): Promise<boolean> {
  const correlationId = getCurrentCorrelationId() || randomUUID();

  try {
    const redisKey = buildRedisKey(idempotencyKey);
    const result = await redis.del(redisKey);
    logger.debug('تم حذف مفتاح التكافؤ', {
      correlationId,
      idempotencyKey,
      deleted: result > 0,
    });
    return result > 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown';
    logger.error('فشل حذف مفتاح التكافؤ', {
      correlationId,
      idempotencyKey,
      error: errorMessage,
    });
    return false;
  }
}

export async function getIdempotencyKeyInfo(
  idempotencyKey: string
): Promise<{ exists: boolean; result?: any; storedAt?: string; ttl?: number }> {
  const correlationId = getCurrentCorrelationId() || randomUUID();

  try {
    const redisKey = buildRedisKey(idempotencyKey);
    const [stored, ttl] = await Promise.all([
      redis.get(redisKey),
      redis.ttl(redisKey),
    ]);

    if (!stored) return { exists: false };

    try {
      const data = JSON.parse(stored);
      return {
        exists: true,
        result: data.result,
        storedAt: data.storedAt,
        ttl: ttl > 0 ? ttl : undefined,
      };
    } catch (parseError) {
      return {
        exists: true,
        result: stored,
        ttl: ttl > 0 ? ttl : undefined,
      };
    }
  } catch (error) {
    logger.error('فشل الحصول على معلومات مفتاح التكافؤ', {
      correlationId,
      idempotencyKey,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { exists: false };
  }
}

export default {
  generateIdempotencyKey,
  generateIdempotencyKeyFromInput,
  checkIdempotencyKey,
  storeIdempotencyResult,
  withIdempotency,
  deleteIdempotencyKey,
  getIdempotencyKeyInfo,
};

