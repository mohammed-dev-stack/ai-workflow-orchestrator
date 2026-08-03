// ============================================================
// backend/src/observability/tracer.ts
// ============================================================
// التتبع الموزع (OpenTelemetry) - إصدار ES Module خالص.
// يصدّر جميع الدوال كتصديرات مسمّاة للتوافق مع ES Modules.
// ============================================================

import { trace, Span, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { logger } from './logger.js';
import { config } from '../config/index.js';

// ============================================================
// الأنواع
// ============================================================

export interface TracerOptions {
  serviceName?: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
  enabled?: boolean;
  useConsoleExporter?: boolean;
  samplingRatio?: number;
}

// ============================================================
// المتغيرات الداخلية
// ============================================================

const TRACER_NAME = 'ai-knowledge-orchestrator-backend';

// ============================================================
// الدوال المُصدَّرة (تصدير مسمى)
// ============================================================

/**
 * تهيئة التتبع الموزع.
 */
export function initializeTracer(options?: TracerOptions): void {
  const serviceName = options?.serviceName || 'whatsapp-ai-agent';
  logger.info('تهيئة التتبع الموزع', {
    serviceName,
    serviceVersion: options?.serviceVersion || '1.0.0',
    enabled: options?.enabled !== false,
    useConsoleExporter: options?.useConsoleExporter || false,
    samplingRatio: options?.samplingRatio || 1.0,
  });
  // في الإنتاج، هنا سيتم تهيئة OpenTelemetry SDK الحقيقي
}

/**
 * إيقاف التتبع الموزع وتنظيف الموارد.
 */
export async function shutdownTracer(): Promise<void> {
  logger.info('إيقاف التتبع الموزع');
}

/**
 * الحصول على tracer النشط (لـ OpenTelemetry).
 */
export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * الحصول على الـ span النشط حالياً.
 */
export function getActiveSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * إضافة سمات (Attributes) إلى الـ span النشط.
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  } else {
    logger.debug('لا يوجد span نشط لإضافة السمات', { attributes });
  }
}

/**
 * تنفيذ دالة ضمن نطاق تتبع (span) جديد.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL }, async (span) => {
    if (attributes) {
      span.setAttributes(attributes);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'خطأ غير معروف';
      span.recordException(error instanceof Error ? error : new Error(errorMessage));
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      throw error;
    } finally {
      span.end();
    }
  });
}

// ============================================================
// الكائن الافتراضي (للتوافق مع الاستيراد الافتراضي)
// ============================================================

export default {
  initializeTracer,
  shutdownTracer,
  getTracer,
  getActiveSpan,
  setSpanAttributes,
  withSpan,
};
