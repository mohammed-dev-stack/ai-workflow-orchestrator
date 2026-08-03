// frontend/src/utils/errorParser.ts
// ✅ حذف استيراد AxiosError نهائياً

export type ErrorType =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'server'
  | 'unknown';

export interface ParsedError {
  type: ErrorType;
  message: string;
  technicalMessage?: string;
  statusCode?: number;
  details?: Record<string, any>;
  originalError?: unknown;
}

const ERROR_MESSAGES: Record<string, string> = {
  'Network Error': 'حدث خطأ في الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت.',
  'timeout of': 'انتهت مهلة الاتصال بالخادم. يرجى المحاولة مرة أخرى.',
  'ECONNABORTED': 'تم إلغاء الاتصال بالخادم.',
  'ECONNREFUSED': 'الخادم غير متاح حالياً. يرجى المحاولة لاحقاً.',
  'UNAUTHORIZED': 'جلسة غير صالحة. يرجى تسجيل الدخول مرة أخرى.',
  'TOKEN_EXPIRED': 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.',
  'INVALID_TOKEN': 'توكن غير صالح. يرجى تسجيل الدخول مرة أخرى.',
  'INVALID_CREDENTIALS': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'FORBIDDEN': 'ليس لديك الصلاحية للوصول إلى هذا المورد.',
  'NOT_FOUND': 'المورد المطلوب غير موجود.',
  'VALIDATION_ERROR': 'البيانات المدخلة غير صالحة. يرجى مراجعة الحقول.',
  'INVALID_INPUT': 'البيانات المدخلة غير صالحة.',
  'CONFLICT': 'تضارب في البيانات. قد يكون هناك سجل مكرر.',
  'INTERNAL_SERVER_ERROR': 'حدث خطأ داخلي في الخادم. يرجى المحاولة مرة أخرى لاحقاً.',
  'SERVER_ERROR': 'حدث خطأ في الخادم.',
  'SERVICE_UNAVAILABLE': 'الخدمة غير متاحة حالياً. يرجى المحاولة لاحقاً.',
  'AI_SERVICE_ERROR': 'خدمة الذكاء الاصطناعي غير متاحة حالياً. يرجى المحاولة مرة أخرى.',
  'AI_RATE_LIMIT': 'تم تجاوز حد طلبات الذكاء الاصطناعي. يرجى الانتظار قبل المحاولة مرة أخرى.',
  'AI_TIMEOUT': 'انتهت مهلة استدعاء الذكاء الاصطناعي.',
  'FILE_TOO_LARGE': 'حجم الملف يتجاوز الحد المسموح به.',
  'FILE_TYPE_NOT_ALLOWED': 'نوع الملف غير مسموح به.',
  'UPLOAD_FAILED': 'فشل رفع الملف. يرجى المحاولة مرة أخرى.',
  'RATE_LIMIT_EXCEEDED': 'تم تجاوز حد الطلبات. يرجى الانتظار قبل المحاولة مرة أخرى.',
  'BAD_REQUEST': 'الطلب غير صحيح. يرجى التحقق من البيانات المدخلة.',
  'METHOD_NOT_ALLOWED': 'الطريقة غير مسموح بها.',
};

function determineErrorType(
  statusCode?: number,
  errorCode?: string,
  message?: string
): ErrorType {
  if (statusCode === undefined && (message?.includes('Network Error') || message?.includes('timeout') || message?.includes('ECONNABORTED'))) {
    return 'network';
  }
  if (statusCode === 401) return 'unauthorized';
  if (errorCode === 'UNAUTHORIZED' || errorCode === 'TOKEN_EXPIRED' || errorCode === 'INVALID_TOKEN') return 'unauthorized';
  if (statusCode === 403) return 'forbidden';
  if (errorCode === 'FORBIDDEN') return 'forbidden';
  if (statusCode === 404) return 'not_found';
  if (errorCode === 'NOT_FOUND') return 'not_found';
  if (statusCode === 400 && errorCode === 'VALIDATION_ERROR') return 'validation';
  if (errorCode === 'VALIDATION_ERROR' || errorCode === 'INVALID_INPUT') return 'validation';
  if (statusCode === 409) return 'conflict';
  if (errorCode === 'CONFLICT') return 'conflict';
  if (statusCode && statusCode >= 500) return 'server';
  if (errorCode === 'INTERNAL_SERVER_ERROR' || errorCode === 'SERVER_ERROR') return 'server';
  if (message?.includes('timeout') || message?.includes('timed out')) return 'timeout';
  return 'unknown';
}

export function parseApiError(error: unknown): ParsedError {
  if (!error) return { type: 'unknown', message: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.' };

  // ✅ فحص AxiosError باستخدام الخاصية isAxiosError (بدون استيراد الأنواع)
  if (typeof error === 'object' && error !== null && 'isAxiosError' in error && (error as any).isAxiosError) {
    const axiosError = error as any;
    const responseData = axiosError.response?.data;
    const statusCode = axiosError.response?.status;
    const errorCode = responseData?.error || responseData?.code;
    const message = responseData?.message || axiosError.message;
    const type = determineErrorType(statusCode, errorCode, message);
    const userMessage = getErrorMessage(errorCode, message, type);
    return {
      type,
      message: userMessage,
      technicalMessage: message,
      statusCode,
      details: responseData?.details || responseData?.data,
      originalError: axiosError,
    };
  }

  if (error instanceof Error) {
    const message = error.message;
    let errorCode: string | undefined;
    let cleanMessage = message;
    const codeMatch = message.match(/^\[([A-Z_]+)\]\s*(.*)$/);
    if (codeMatch) { errorCode = codeMatch[1]; cleanMessage = codeMatch[2] || message; }
    const type = determineErrorType(undefined, errorCode, cleanMessage);
    const userMessage = getErrorMessage(errorCode, cleanMessage, type);
    return { type, message: userMessage, technicalMessage: cleanMessage, originalError: error };
  }

  if (typeof error === 'string') {
    const message = error;
    const type = determineErrorType(undefined, undefined, message);
    const userMessage = getErrorMessage(undefined, message, type);
    return { type, message: userMessage, technicalMessage: message, originalError: error };
  }

  if (error && typeof error === 'object') {
    const obj = error as Record<string, any>;
    const errorCode = obj.error || obj.code;
    const message = obj.message || obj.msg || JSON.stringify(obj);
    const type = determineErrorType(obj.statusCode || obj.status, errorCode, message);
    const userMessage = getErrorMessage(errorCode, message, type);
    return {
      type,
      message: userMessage,
      technicalMessage: message,
      statusCode: obj.statusCode || obj.status,
      details: obj.details || obj.data,
      originalError: error,
    };
  }

  return { type: 'unknown', message: 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.', technicalMessage: String(error), originalError: error };
}

function getErrorMessage(errorCode?: string, fallbackMessage?: string, type?: ErrorType): string {
  if (errorCode && ERROR_MESSAGES[errorCode]) return ERROR_MESSAGES[errorCode];
  if (fallbackMessage) {
    for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
      if (fallbackMessage.includes(key) || key.includes(fallbackMessage)) return value;
    }
  }
  if (type) {
    switch (type) {
      case 'network': return 'حدث خطأ في الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت.';
      case 'timeout': return 'انتهت مهلة الاتصال بالخادم. يرجى المحاولة مرة أخرى.';
      case 'unauthorized': return 'جلسة غير صالحة. يرجى تسجيل الدخول مرة أخرى.';
      case 'forbidden': return 'ليس لديك الصلاحية للوصول إلى هذا المورد.';
      case 'not_found': return 'المورد المطلوب غير موجود.';
      case 'validation': return 'البيانات المدخلة غير صالحة. يرجى مراجعة الحقول.';
      case 'conflict': return 'تضارب في البيانات. قد يكون هناك سجل مكرر.';
      case 'server': return 'حدث خطأ داخلي في الخادم. يرجى المحاولة مرة أخرى لاحقاً.';
      default: return fallbackMessage || 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';
    }
  }
  return fallbackMessage || 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';
}

export function getUserFriendlyError(error: unknown, defaultMessage?: string): string {
  const parsed = parseApiError(error);
  return parsed.message || defaultMessage || 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';
}

export function isErrorType(error: unknown, type: ErrorType): boolean {
  const parsed = parseApiError(error);
  return parsed.type === type;
}

export function isAuthError(error: unknown): boolean { return isErrorType(error, 'unauthorized'); }
export function isNetworkError(error: unknown): boolean { return isErrorType(error, 'network'); }
export function isServerError(error: unknown): boolean { return isErrorType(error, 'server'); }
export function isValidationError(error: unknown): boolean { return isErrorType(error, 'validation'); }

export default {
  parseApiError,
  getUserFriendlyError,
  isErrorType,
  isAuthError,
  isNetworkError,
  isServerError,
  isValidationError,
};