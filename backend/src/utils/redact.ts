/**
 * utils/redact.ts
 * * يحتوي على دوال لتنظيف البيانات الحساسة.
 * لاحظ وجود كلمة 'export' قبل الدوال.
 */

// قائمة المفاتيح الحساسة
const SENSITIVE_KEYS = ['apiKey', 'password', 'secret', 'token', 'authorization'];

export function redact(data: any, seen = new WeakSet()): any {
  if (data === null || typeof data !== 'object') return data;
  if (data instanceof Date || data instanceof RegExp) return data;
  
  if (seen.has(data)) return '[Circular]';
  seen.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => redact(item, seen));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.includes(key)) {
      result[key] = '***REDACTED***';
    } else if (typeof value === 'string' && value.includes('://')) {
      result[key] = redactUriCredentials(value);
    } else {
      result[key] = redact(value, seen);
    }
  }
  return result;
}

export function redactUriCredentials(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.username || url.password) {
      url.username = '***';
      url.password = '***';
    }
    return url.toString();
  } catch {
    return uri;
  }
}