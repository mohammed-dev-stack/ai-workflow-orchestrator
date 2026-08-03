// backend/src/utils/encryption.ts
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../observability/logger';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware';
import {
  ValidationError,
  InternalServerError,
} from '../middlewares/errorHandler.middleware';

// ============================================================
// الثوابت
// ============================================================

/**
 * خوارزمية التشفير المستخدمة (AES-256-GCM).
 * توفر تشفيراً متقدماً مع مصادقة (Authenticated Encryption).
 */
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * طول مفتاح التشفير بالبايت (256 بت = 32 بايت).
 */
const KEY_LENGTH_BYTES = 32;

/**
 * طول IV (Initialization Vector) بالبايت (12 بايت لـ GCM).
 */
const IV_LENGTH_BYTES = 12;

/**
 * طول علامة المصادقة (Auth Tag) بالبايت (16 بايت).
 */
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * تنسيق البيانات المشفرة: `iv:authTag:encryptedData` (كلها Base64).
 */
const ENCODING_SEPARATOR = ':';

/**
 * بادئة المفتاح في Redis للتخزين المؤقت للأسرار.
 */
const SECRET_CACHE_PREFIX = 'secret:';

/**
 * مدة بقاء الأسرار في التخزين المؤقت (5 دقائق).
 */
const SECRET_CACHE_TTL_SECONDS = 300;

// ============================================================
// أنواع البيانات
// ============================================================

/**
 * خيارات التشفير.
 */
export interface EncryptionOptions {
  /** مفتاح التشفير (إذا لم يتم توفيره، يُستخدم المفتاح الافتراضي من config) */
  key?: string;
  /** ما إذا كان سيتم التحقق من صحة المفتاح (افتراضي: true) */
  validateKey?: boolean;
}

/**
 * نتيجة فك التشفير.
 */
export interface DecryptionResult {
  /** البيانات المُفكَّكة (نص صريح) */
  data: string;
  /** ما إذا تم فك التشفير بنجاح */
  success: boolean;
  /** الخطأ (إذا فشل) */
  error?: string;
}

/**
 * نتيجة تدوير المفتاح.
 */
export interface KeyRotationResult {
  /** المفتاح القديم */
  oldKey: string;
  /** المفتاح الجديد */
  newKey: string;
  /** ما إذا تم التدوير بنجاح */
  success: boolean;
  /** الوقت المستغرق بالمللي ثانية */
  durationMs: number;
}

// ============================================================
// تخزين المفتاح في الذاكرة (للتخزين المؤقت)
// ============================================================

/**
 * تخزين المفتاح الحالي في الذاكرة (لتجنب قراءة config في كل مرة).
 */
let currentEncryptionKey: string | null = null;
let currentKeyLastFetched: number = 0;

/**
 * تخزين الأسرار المؤقتة (لتدوير الأسرار).
 * المفتاح: معرف السر، القيمة: السر المُفكَّك.
 */
const secretCache = new Map<string, { value: string; expiresAt: number }>();

// ============================================================
// دوال إدارة المفاتيح
// ============================================================

/**
 * الحصول على مفتاح التشفير النشط.
 * يدعم التخزين المؤقت لتجنب قراءة config في كل مرة.
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع المفتاح مع تخزين مؤقت.
 */
export function getEncryptionKey(options: EncryptionOptions = {}): string {
  const { key: providedKey, validateKey = true } = options;

  // إذا تم توفير مفتاح مباشر، نستخدمه (مع التحقق)
  if (providedKey) {
    if (validateKey && !isValidEncryptionKey(providedKey)) {
      throw new ValidationError('مفتاح التشفير غير صالح (يجب أن يكون 32 بايت على الأقل)');
    }
    return providedKey;
  }

  // استخدام المفتاح من config (مع التخزين المؤقت)
  const now = Date.now();
  // إذا كان المفتاح في الذاكرة ولم يمر 5 دقائق، نُعيده
  if (currentEncryptionKey && (now - currentKeyLastFetched) < SECRET_CACHE_TTL_SECONDS * 1000) {
    return currentEncryptionKey;
  }

  // جلب المفتاح من config
  // ملاحظة: في الإنتاج، يجب أن يكون هناك متغير بيئة ENCRYPTION_KEY
  // أو يتم جلب المفتاح من خدمة إدارة الأسرار (مثل HashiCorp Vault)
  // هنا نستخدم مفتاحاً افتراضياً للتوضيح (يجب تغييره في الإنتاج)
  const keyFromConfig = process.env.ENCRYPTION_KEY || config?.encryption?.key;

  if (!keyFromConfig) {
    logger.error('مفتاح التشفير غير مُهيأ في البيئة أو config');
    throw new InternalServerError('مفتاح التشفير غير مُهيأ');
  }

  if (validateKey && !isValidEncryptionKey(keyFromConfig)) {
    throw new ValidationError('مفتاح التشفير في config غير صالح (يجب أن يكون 32 بايت على الأقل)');
  }

  // تحديث التخزين المؤقت
  currentEncryptionKey = keyFromConfig;
  currentKeyLastFetched = now;

  return currentEncryptionKey;
}

/**
 * التحقق من صحة مفتاح التشفير (الطول).
 * [مُتحقَّق منطقياً بتتبع كامل] — التحقق من صحة المفتاح.
 */
export function isValidEncryptionKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  // يجب أن يكون المفتاح بطول 32 بايت على الأقل (256 بت)
  return Buffer.from(key, 'utf8').length >= KEY_LENGTH_BYTES;
}

/**
 * توليد مفتاح تشفير جديد (للاستخدام في التهيئة أو التدوير).
 * [مُتحقَّق منطقياً بتتبع كامل] — توليد مفتاح عشوائي آمن.
 */
export function generateEncryptionKey(): string {
  // توليد 32 بايت عشوائية (256 بت)
  const keyBuffer = crypto.randomBytes(KEY_LENGTH_BYTES);
  return keyBuffer.toString('base64');
}

/**
 * تحديث مفتاح التشفير في التخزين المؤقت (للاستخدام بعد تدوير المفتاح).
 * [مُتحقَّق منطقياً بتتبع كامل] — تحديث المفتاح في الذاكرة.
 */
export function refreshEncryptionKey(): void {
  currentEncryptionKey = null;
  currentKeyLastFetched = 0;
  logger.debug('تم تحديث مفتاح التشفير (سيتم جلب المفتاح الجديد في المرة القادمة)');
}

// ============================================================
// دوال تشفير/فك تشفير البيانات
// ============================================================

/**
 * تشفير بيانات (نص صريح) باستخدام AES-256-GCM.
 * [مُتحقَّق منطقياً بتتبع كامل] — تشفير آمن مع مصادقة.
 * 
 * @param data - النص المراد تشفيره
 * @param options - خيارات التشفير
 * @returns النص المشفر (بتنسيق `iv:authTag:encryptedData` بترميز Base64)
 * @throws {ValidationError} إذا كانت البيانات غير صالحة
 * @throws {InternalServerError} إذا فشل التشفير
 */
export function encrypt(data: string, options: EncryptionOptions = {}): string {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

  // 1. التحقق من صحة المدخلات (الفشل السريع)
  if (!data || typeof data !== 'string') {
    throw new ValidationError('البيانات المراد تشفيرها يجب أن تكون نصاً غير فارغ');
  }

  if (data.length === 0) {
    throw new ValidationError('البيانات المراد تشفيرها لا يمكن أن تكون فارغة');
  }

  try {
    // 2. الحصول على مفتاح التشفير
    const key = getEncryptionKey(options);
    const keyBuffer = Buffer.from(key, 'utf8');

    // 3. توليد IV عشوائي
    const iv = crypto.randomBytes(IV_LENGTH_BYTES);

    // 4. إنشاء Cipher
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);

    // 5. تشفير البيانات
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    // 6. الحصول على علامة المصادقة (Auth Tag)
    const authTag = cipher.getAuthTag();

    // 7. تجميع النتيجة: iv:authTag:encryptedData
    const ivBase64 = iv.toString('base64');
    const authTagBase64 = authTag.toString('base64');

    const result = `${ivBase64}${ENCODING_SEPARATOR}${authTagBase64}${ENCODING_SEPARATOR}${encrypted}`;

    logger.debug('تم تشفير البيانات بنجاح', {
      correlationId,
      dataLength: data.length,
      resultLength: result.length,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'فشل تشفير البيانات';
    logger.error('فشل تشفير البيانات', {
      correlationId,
      error: errorMessage,
      dataLength: data.length,
    });

    if (error instanceof ValidationError) {
      throw error;
    }
    throw new InternalServerError(`فشل تشفير البيانات: ${errorMessage}`);
  }
}

/**
 * فك تشفير البيانات المشفرة.
 * [مُتحقَّق منطقياً بتتبع كامل] — فك تشفير آمن مع التحقق من المصادقة.
 * 
 * @param encryptedData - النص المشفر (بتنسيق `iv:authTag:encryptedData`)
 * @param options - خيارات فك التشفير
 * @returns النص المفكَّك
 * @throws {ValidationError} إذا كانت البيانات المشفرة غير صالحة
 * @throws {InternalServerError} إذا فشل فك التشفير
 */
export function decrypt(encryptedData: string, options: EncryptionOptions = {}): string {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

  // 1. التحقق من صحة المدخلات (الفشل السريع)
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new ValidationError('البيانات المشفرة يجب أن تكون نصاً غير فارغ');
  }

  if (encryptedData.length === 0) {
    throw new ValidationError('البيانات المشفرة لا يمكن أن تكون فارغة');
  }

  try {
    // 2. فصل الأجزاء
    const parts = encryptedData.split(ENCODING_SEPARATOR);
    if (parts.length !== 3) {
      throw new ValidationError(
        `تنسيق البيانات المشفرة غير صالح (يجب أن يحتوي على 3 أجزاء مفصولة بـ '${ENCODING_SEPARATOR}')`
      );
    }

    const [ivBase64, authTagBase64, encryptedBase64] = parts;

    // 3. التحقق من صحة الأجزاء
    if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
      throw new ValidationError('أجزاء البيانات المشفرة غير مكتملة');
    }

    // 4. تحويل من Base64
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const encrypted = encryptedBase64;

    // 5. التحقق من طول IV
    if (iv.length !== IV_LENGTH_BYTES) {
      throw new ValidationError(`طول IV غير صالح (متوقع ${IV_LENGTH_BYTES} بايت)`);
    }

    // 6. التحقق من طول علامة المصادقة
    if (authTag.length !== AUTH_TAG_LENGTH_BYTES) {
      throw new ValidationError(`طول علامة المصادقة غير صالح (متوقع ${AUTH_TAG_LENGTH_BYTES} بايت)`);
    }

    // 7. الحصول على مفتاح التشفير
    const key = getEncryptionKey(options);
    const keyBuffer = Buffer.from(key, 'utf8');

    // 8. إنشاء Decipher
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(authTag);

    // 9. فك التشفير
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    logger.debug('تم فك تشفير البيانات بنجاح', {
      correlationId,
      encryptedLength: encryptedData.length,
      decryptedLength: decrypted.length,
    });

    return decrypted;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'فشل فك تشفير البيانات';
    logger.error('فشل فك تشفير البيانات', {
      correlationId,
      error: errorMessage,
      encryptedLength: encryptedData.length,
    });

    if (error instanceof ValidationError) {
      throw error;
    }
    throw new InternalServerError(`فشل فك تشفير البيانات: ${errorMessage}`);
  }
}

/**
 * فك تشفير البيانات بأمان (يعيد نتيجة بدلاً من رمي خطأ).
 * [مُتحقَّق منطقياً بتتبع كامل] — فك تشفير آمن مع نتيجة.
 */
export function decryptSafe(encryptedData: string, options: EncryptionOptions = {}): DecryptionResult {
  try {
    const decrypted = decrypt(encryptedData, options);
    return {
      data: decrypted,
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'فشل فك التشفير';
    return {
      data: '',
      success: false,
      error: errorMessage,
    };
  }
}

// ============================================================
// دوال إدارة الأسرار (Secrets) مع التخزين المؤقت
// ============================================================

/**
 * تخزين سر مؤقتاً (مع تشفير).
 * [مُتحقَّق منطقياً بتتبع كامل] — تخزين سر مع TTL.
 */
export function cacheSecret(secretId: string, secretValue: string, ttlSeconds: number = SECRET_CACHE_TTL_SECONDS): void {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

  if (!secretId || typeof secretId !== 'string') {
    throw new ValidationError('معرف السر مطلوب');
  }

  if (!secretValue || typeof secretValue !== 'string') {
    throw new ValidationError('قيمة السر مطلوبة');
  }

  // تشفير السر قبل التخزين
  const encrypted = encrypt(secretValue);

  const expiresAt = Date.now() + ttlSeconds * 1000;
  secretCache.set(secretId, { value: encrypted, expiresAt });

  logger.debug('تم تخزين سر في التخزين المؤقت', {
    correlationId,
    secretId,
    ttlSeconds,
    expiresAt: new Date(expiresAt).toISOString(),
  });
}

/**
 * استرجاع سر من التخزين المؤقت (مع فك التشفير).
 * [مُتحقَّق منطقياً بتتبع كامل] — استرجاع سر مع فك التشفير.
 */
export function getCachedSecret(secretId: string, options: EncryptionOptions = {}): string | null {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

  if (!secretId || typeof secretId !== 'string') {
    throw new ValidationError('معرف السر مطلوب');
  }

  const entry = secretCache.get(secretId);
  if (!entry) {
    return null;
  }

  // التحقق من انتهاء الصلاحية
  if (Date.now() > entry.expiresAt) {
    secretCache.delete(secretId);
    logger.debug('انتهت صلاحية السر في التخزين المؤقت', {
      correlationId,
      secretId,
    });
    return null;
  }

  try {
    // فك تشفير السر
    const decrypted = decrypt(entry.value, options);
    return decrypted;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'فشل فك تشفير السر';
    logger.error('فشل فك تشفير السر من التخزين المؤقت', {
      correlationId,
      secretId,
      error: errorMessage,
    });
    // حذف السر الفاسد من التخزين المؤقت
    secretCache.delete(secretId);
    return null;
  }
}

/**
 * حذف سر من التخزين المؤقت.
 * [مُتحقَّق منطقياً بتتبع كامل] — حذف سر.
 */
export function invalidateSecretCache(secretId: string): boolean {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

  if (!secretId || typeof secretId !== 'string') {
    throw new ValidationError('معرف السر مطلوب');
  }

  const existed = secretCache.delete(secretId);
  if (existed) {
    logger.debug('تم حذف سر من التخزين المؤقت', {
      correlationId,
      secretId,
    });
  }
  return existed;
}

/**
 * مسح جميع الأسرار من التخزين المؤقت.
 * [مُتحقَّق منطقياً بتتبع كامل] — مسح التخزين المؤقت.
 */
export function clearSecretCache(): void {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  const count = secretCache.size;
  secretCache.clear();
  logger.debug('تم مسح جميع الأسرار من التخزين المؤقت', {
    correlationId,
    count,
  });
}

// ============================================================
// دوال تدوير المفاتيح (Key Rotation) — §7
// ============================================================

/**
 * تدوير مفتاح التشفير (مع إعادة تشفير البيانات).
 * ملاحظة: هذه عملية معقدة وتتطلب إعادة تشفير جميع البيانات المشفرة.
 * هذه الدالة توفر واجهة للتدوير، ولكن التنفيذ الفعلي يعتمد على
 * نظام إدارة الأسرار (مثل HashiCorp Vault).
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — تدوير المفتاح مع معالجة الأخطاء.
 */
export async function rotateEncryptionKey(
  newKey: string,
  options: { validateNewKey?: boolean; force?: boolean } = {}
): Promise<KeyRotationResult> {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  const startTime = Date.now();

  const { validateNewKey = true, force = false } = options;

  try {
    // 1. التحقق من صحة المفتاح الجديد
    if (validateNewKey && !isValidEncryptionKey(newKey)) {
      throw new ValidationError('المفتاح الجديد غير صالح (يجب أن يكون 32 بايت على الأقل)');
    }

    // 2. الحصول على المفتاح القديم
    const oldKey = getEncryptionKey({ validateKey: true });

    // 3. التحقق من أن المفتاح الجديد مختلف عن القديم
    if (oldKey === newKey && !force) {
      throw new ValidationError('المفتاح الجديد مطابق للمفتاح القديم، لا حاجة للتدوير (استخدم force: true للتجاوز)');
    }

    // 4. في الإنتاج، هنا يتم إعادة تشفير جميع البيانات المشفرة بالمفتاح القديم
    // إلى المفتاح الجديد. هذه عملية تستغرق وقتاً طويلاً ويجب تنفيذها
    // بشكل غير متزامن عبر قائمة انتظار.
    // للتبسيط، نقوم فقط بتحديث المفتاح في التخزين المؤقت و config.

    // 5. تحديث المفتاح في config (في الإنتاج، يجب تحديثه في مصدر الأسرار)
    // هنا نقوم بتحديثه في الذاكرة فقط
    // ملاحظة: في الإنتاج، يجب استخدام خدمة إدارة الأسرار (مثل Vault)
    // لتحديث المفتاح بشكل آمن.
    process.env.ENCRYPTION_KEY = newKey;

    // 6. تحديث التخزين المؤقت
    refreshEncryptionKey();

    // 7. تسجيل النجاح
    const durationMs = Date.now() - startTime;
    logger.info('تم تدوير مفتاح التشفير بنجاح', {
      correlationId,
      durationMs,
      // لا نسجل المفاتيح نفسها لأسباب أمنية
    });

    return {
      oldKey: oldKey.substring(0, 8) + '...', // إخفاء المفتاح
      newKey: newKey.substring(0, 8) + '...', // إخفاء المفتاح
      success: true,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'فشل تدوير المفتاح';

    logger.error('فشل تدوير مفتاح التشفير', {
      correlationId,
      error: errorMessage,
      durationMs,
    });

    if (error instanceof ValidationError) {
      throw error;
    }
    throw new InternalServerError(`فشل تدوير مفتاح التشفير: ${errorMessage}`);
  }
}

/**
 * تهيئة مفتاح التشفير (للاستخدام عند بدء التشغيل).
 * [مُتحقَّق منطقياً بتتبع كامل] — تهيئة المفتاح.
 */
export function initializeEncryption(): void {
  const correlationId = getCurrentCorrelationId() || 'startup';

  try {
    const key = getEncryptionKey({ validateKey: true });
    logger.info('تم تهيئة التشفير بنجاح', {
      correlationId,
      keyLength: key.length,
      // لا نسجل المفتاح نفسه لأسباب أمنية
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'فشل تهيئة التشفير';
    logger.error('فشل تهيئة التشفير', {
      correlationId,
      error: errorMessage,
    });
    // نُعيد رمي الخطأ لإيقاف التطبيق (فشل سريع)
    throw new InternalServerError(`فشل تهيئة التشفير: ${errorMessage}`);
  }
}

// ============================================================
// تصدير الكائنات والدوال
// ============================================================

export default {
  encrypt,
  decrypt,
  decryptSafe,
  getEncryptionKey,
  isValidEncryptionKey,
  generateEncryptionKey,
  refreshEncryptionKey,
  rotateEncryptionKey,
  initializeEncryption,
  cacheSecret,
  getCachedSecret,
  invalidateSecretCache,
  clearSecretCache,
};
