// ============================================================
// backend/src/observability/metrics.ts
// ============================================================
// مقاييس التطبيق (RED metrics) — عدادات، مقاييس، رسوم بيانية.
// تم إصلاح أخطاء الأنواع المتعلقة بـ setSpanAttributes و name.
// ============================================================

import { config } from '../config/index.js';
import { logger } from './logger.js';
import { setSpanAttributes } from './tracer.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';

// ============================================================
// أنواع المقاييس
// ============================================================

export interface Counter {
  name: string;
  value: number;
  tags?: Record<string, string>;
}

export interface Gauge {
  name: string;
  value: number;
  tags?: Record<string, string>;
}

export interface Histogram {
  name: string;
  value: number;
  tags?: Record<string, string>;
  buckets?: number[];
}

// ============================================================
// تخزين المقاييس في الذاكرة
// ============================================================

const counterStore: Map<string, Counter> = new Map();
const gaugeStore: Map<string, Gauge> = new Map();
const histogramStore: Map<string, number[]> = new Map();

// ============================================================
// دالة مساعدة لاستخراج الاسم من المفتاح
// ============================================================

function extractNameFromKey(key: string): string {
  const colonIndex = key.indexOf(':');
  if (colonIndex === -1) {
    logger.warn('مفتاح مقياس غير صحيح (لا يحتوي على ":")', { key });
    return key; // ارجع المفتاح كاملًا كحل آمن
  }
  return key.substring(0, colonIndex);
}

/**
 * دالة مساعدة لتحويل القيم إلى Record<string, string | number | boolean>
 * مع إزالة القيم undefined
 */
function toSpanAttributes(obj: Record<string, number | undefined>): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

// ============================================================
// دوال تسجيل المقاييس
// ============================================================

export function incrementCounter(
  name: string,
  increment: number = 1,
  tags: Record<string, string> = {}
): void {
  const key = `${name}:${JSON.stringify(tags)}`;
  const existing = counterStore.get(key);
  if (existing) {
    existing.value += increment;
  } else {
    counterStore.set(key, { name, value: increment, tags });
  }

  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  logger.debug('مقياس: زيادة عداد', {
    correlationId,
    metricName: name,
    increment,
    tags,
    newValue: counterStore.get(key)?.value,
  });

  // ✅ إزالة القيم undefined قبل تمريرها إلى setSpanAttributes
  const currentValue = counterStore.get(key)?.value;
  if (currentValue !== undefined) {
    setSpanAttributes(toSpanAttributes({
      [`metric.${name}`]: currentValue,
    }));
  }
}

export function setGauge(
  name: string,
  value: number,
  tags: Record<string, string> = {}
): void {
  const key = `${name}:${JSON.stringify(tags)}`;
  gaugeStore.set(key, { name, value, tags });

  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  logger.debug('مقياس: تعيين قيمة', {
    correlationId,
    metricName: name,
    value,
    tags,
  });

  setSpanAttributes(toSpanAttributes({
    [`metric.${name}`]: value,
  }));
}

export function recordHistogram(
  name: string,
  value: number,
  tags: Record<string, string> = {}
): void {
  const key = `${name}:${JSON.stringify(tags)}`;
  const existing = histogramStore.get(key);
  if (existing) {
    existing.push(value);
  } else {
    histogramStore.set(key, [value]);
  }

  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';
  logger.debug('مقياس: تسجيل رسم بياني', {
    correlationId,
    metricName: name,
    value,
    tags,
    count: histogramStore.get(key)?.length || 0,
  });

  setSpanAttributes(toSpanAttributes({
    [`metric.${name}_last`]: value,
  }));
}

// ============================================================
// دوال مساعدة للمقاييس الشائعة (RED)
// ============================================================

export function recordHTTPMetric(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  tenantId?: string
): void {
  const tags = {
    method,
    path,
    status: String(statusCode),
    tenant: tenantId || 'unknown',
  };

  incrementCounter('http.requests', 1, tags);

  if (statusCode >= 400) {
    incrementCounter('http.errors', 1, {
      ...tags,
      error_type: statusCode >= 500 ? 'server' : 'client',
    });
  }

  recordHistogram('http.duration', durationMs, tags);
}

export function recordExternalCallMetric(
  service: string,
  success: boolean,
  durationMs: number,
  tenantId?: string
): void {
  const tags = {
    service,
    status: success ? 'success' : 'failure',
    tenant: tenantId || 'unknown',
  };

  incrementCounter('external.requests', 1, tags);

  if (!success) {
    incrementCounter('external.errors', 1, tags);
  }

  recordHistogram('external.duration', durationMs, tags);
}

export function recordAIMetric(
  model: string,
  operation: 'request' | 'response' | 'error',
  tokens?: number,
  durationMs?: number,
  tenantId?: string
): void {
  const tags = {
    model,
    operation,
    tenant: tenantId || 'unknown',
  };

  switch (operation) {
    case 'request':
      incrementCounter('ai.requests', 1, tags);
      if (tokens) {
        incrementCounter('ai.tokens', tokens, { ...tags, type: 'request' });
      }
      if (durationMs) {
        recordHistogram('ai.duration', durationMs, tags);
      }
      break;
    case 'response':
      incrementCounter('ai.responses', 1, tags);
      if (tokens) {
        incrementCounter('ai.tokens', tokens, { ...tags, type: 'response' });
      }
      if (durationMs) {
        recordHistogram('ai.duration', durationMs, tags);
      }
      break;
    case 'error':
      incrementCounter('ai.errors', 1, tags);
      break;
    default:
      logger.warn('عملية AI غير معروفة', { operation });
  }
}

export function recordQueueMetric(
  queueName: string,
  event: 'added' | 'completed' | 'failed' | 'active',
  tenantId?: string
): void {
  const tags = {
    queue: queueName,
    event,
    tenant: tenantId || 'unknown',
  };

  incrementCounter(`queue.${event}`, 1, tags);
}

// ============================================================
// دوال الحصول على المقاييس (للتشخيص)
// ============================================================

export function getCounters(): Counter[] {
  return Array.from(counterStore.values());
}

export function getGauges(): Gauge[] {
  return Array.from(gaugeStore.values());
}

export function getHistograms(): {
  name: string;
  tags: Record<string, string>;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
}[] {
  const result: {
    name: string;
    tags: Record<string, string>;
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
  }[] = [];

  for (const [key, values] of histogramStore.entries()) {
    if (values.length === 0) continue;

    // ✅ استخراج name باستخدام دالة مساعدة آمنة
    const name = extractNameFromKey(key);

    // استخراج tags
    let tags: Record<string, string> = {};
    try {
      const colonIndex = key.indexOf(':');
      if (colonIndex !== -1 && colonIndex + 1 < key.length) {
        const tagsString = key.substring(colonIndex + 1);
        tags = JSON.parse(tagsString) || {};
      }
    } catch (error) {
      logger.warn('فشل تحليل tags من مفتاح المقياس', { key, error });
    }

    const sum = values.reduce((a, b) => a + b, 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = sum / values.length;

    result.push({
      name,
      tags,
      count: values.length,
      sum,
      min,
      max,
      avg,
    });
  }

  return result;
}

export function resetMetrics(): void {
  counterStore.clear();
  gaugeStore.clear();
  histogramStore.clear();
  logger.debug('تم إعادة تعيين جميع المقاييس');
}

// ============================================================
// تصدير المقاييس إلى السجلات (للرصد الدوري)
// ============================================================

export function exportMetricsToLogs(): void {
  const counters = getCounters();
  const gauges = getGauges();
  const histograms = getHistograms();

  const correlationId = getCurrentCorrelationId() || 'metrics-export';

  logger.info('تصدير المقاييس', {
    correlationId,
    counters: counters.map((c) => ({ name: c.name, value: c.value, tags: c.tags })),
    gauges: gauges.map((g) => ({ name: g.name, value: g.value, tags: g.tags })),
    histograms: histograms.map((h) => ({
      name: h.name,
      count: h.count,
      sum: h.sum,
      min: h.min,
      max: h.max,
      avg: h.avg,
      tags: h.tags,
    })),
  });
}

export function recordMetric(
  name: string,
  type: 'counter' | 'gauge' | 'histogram',
  value: number,
  tags: Record<string, string> = {}
): void {
  switch (type) {
    case 'counter':
      incrementCounter(name, value, tags);
      break;
    case 'gauge':
      setGauge(name, value, tags);
      break;
    case 'histogram':
      recordHistogram(name, value, tags);
      break;
    default:
      logger.warn('نوع مقياس غير معروف', { name, type });
  }
}

export default {
  incrementCounter,
  setGauge,
  recordHistogram,
  recordHTTPMetric,
  recordExternalCallMetric,
  recordAIMetric,
  recordQueueMetric,
  getCounters,
  getGauges,
  getHistograms,
  resetMetrics,
  exportMetricsToLogs,
  recordMetric,
};
