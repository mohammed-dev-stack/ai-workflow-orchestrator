// backend/src/ai/sanitizers/prompt.sanitizer.ts
import { config } from '../../config/index.js';
import { logger } from '../../observability/logger.js';
import { getCurrentCorrelationId } from '../../middlewares/correlation.middleware.js';
import { ValidationError } from '../../middlewares/errorHandler.middleware.js';

// ============================================================
// تعريف الواجهات لضمان الأمان النوعي (Type Safety)
// ============================================================
// ملاحظة: تأكد من تحديث الـ Interface الخاص بـ config في ملف الإعدادات
// ليشمل خاصية maxPromptLength لضمان عمل هذا الكود بشكل سليم.
interface SanitizerOptions {
  detectInjection?: boolean;
  removeNonPrintable?: boolean;
  replaceDangerousChars?: boolean;
  maxLength?: number;
  logInjectionAttempts?: boolean;
}

interface TextSanitizerOptions {
  maxLength?: number;
  compressSpaces?: boolean;
}

// ============================================================
// قوائم الحظر (Blocklists)
// ============================================================
const PROMPT_INJECTION_PATTERNS = [
  /ignore previous instructions/i,
  /ignore all previous instructions/i,
  /ignore the above/i,
  /disregard previous/i,
  /forget everything before/i,
  /do not follow previous/i,
  /you are now/i,
  /from now on you are/i,
  /you are no longer/i,
  /your new role is/i,
  /act as/i,
  /pretend to be/i,
  /what are your instructions/i,
  /what is your system prompt/i,
  /what were you told/i,
  /show me your prompt/i,
  /reveal your instructions/i,
  /ignore the rules/i,
  /do not follow your guidelines/i,
  /override your instructions/i,
  /bypass your safety/i,
  /[^`]*/i, 
  /<script>/i,
  /<iframe>/i,
  /<object>/i,
  /system prompt/i,
  /system instructions/i,
  /developer mode/i,
  /jailbreak/i,
  /jail break/i,
  /hack/i,
  /bypass/i,
];

const DANGEROUS_CHARS = /[\x00-\x1F\x7F-\x9F<>{}[]|\]/g;
const REPLACE_WITH_SPACE = /[<>{}[]|\]/g;

// ============================================================
// دوال التنقية
// ============================================================

export function sanitizePrompt(
  input: string,
  options: SanitizerOptions = {}
): string {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  
  // استخدام القيمة الافتراضية من config مع توفير fallback في حال عدم تعريفه
  const defaultMax = (config.anthropic as any)?.maxPromptLength || 100000;

  const {
    detectInjection = true,
    removeNonPrintable = true,
    replaceDangerousChars = true,
    maxLength = defaultMax,
    logInjectionAttempts = true,
  } = options;

  if (typeof input !== 'string') {
    throw new ValidationError('المدخلات يجب أن تكون نصاً');
  }

  if (input.trim().length === 0) return '';

  if (detectInjection) {
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        if (logInjectionAttempts) {
          logger.warn('🚨 تم اكتشاف محاولة حقن مطالبات', {
            correlationId,
            pattern: pattern.toString(),
            inputLength: input.length,
          });
        }
        throw new ValidationError('تم اكتشاف محتوى غير مسموح به في النص');
      }
    }
  }

  let sanitized = input;
  if (removeNonPrintable) {
    sanitized = sanitized.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  }
  if (replaceDangerousChars) {
    sanitized = sanitized.replace(REPLACE_WITH_SPACE, ' ');
  }
  
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  if (sanitized.length > maxLength) {
    logger.warn('تم اقتطاع النص بسبب تجاوز الحد الأقصى للطول', {
      correlationId,
      maxLength,
    });
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized.length === 0 ? '' : sanitized;
}

export function sanitizeText(
  input: string,
  options: TextSanitizerOptions = {}
): string {
  const defaultMax = (config.anthropic as any)?.maxPromptLength || 100000;
  const { maxLength = defaultMax, compressSpaces = true } = options;

  if (typeof input !== 'string') return '';

  let sanitized = input
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .replace(REPLACE_WITH_SPACE, ' ');

  if (compressSpaces) {
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
  }

  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
}

export function containsInjectionAttempt(input: string): boolean {
  return typeof input === 'string' && PROMPT_INJECTION_PATTERNS.some(p => p.test(input));
}

export function getInjectionPatterns(): RegExp[] {
  return [...PROMPT_INJECTION_PATTERNS];
}

export function addInjectionPattern(pattern: RegExp): void {
  PROMPT_INJECTION_PATTERNS.push(pattern);
}

export default {
  sanitizePrompt,
  sanitizeText,
  containsInjectionAttempt,
  getInjectionPatterns,
  addInjectionPattern,
};
