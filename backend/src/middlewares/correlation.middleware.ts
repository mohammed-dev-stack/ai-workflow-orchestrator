// ============================================================
// backend/src/middlewares/correlation.middleware.ts
// ============================================================
// وسيط معرّف الارتباط (Correlation ID) باستخدام AsyncLocalStorage.
// تم إصلاح خطأ استدعاء res.end عن طريق إزالة التعديل غير الضروري.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'crypto';

/**
 * سياق الارتباط المخزن في AsyncLocalStorage.
 */
export interface CorrelationContext {
  correlationId: string;
  startTimestamp: string;
  path: string;
  method: string;
  traceId?: string;
  spanId?: string;
}

/**
 * AsyncLocalStorage لتخزين سياق الارتباط عبر سلسلة الاستدعاءات.
 */
export const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

/**
 * الحصول على معرّف الارتباط من السياق الحالي.
 */
export function getCurrentCorrelationId(): string | undefined {
  const store = correlationStorage.getStore();
  return store?.correlationId;
}

/**
 * الحصول على سياق الارتباط الكامل من السياق الحالي.
 */
export function getCurrentCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

/**
 * توليد معرّف ارتباط جديد (UUID v4).
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * وسيط معرّف الارتباط.
 * يقوم باستخراج أو توليد معرّف ارتباط، وتخزينه في AsyncLocalStorage،
 * وإضافته إلى رأس الاستجابة.
 */
export function correlationMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // 1. استخراج معرّف الارتباط من الرأس (إن وجد)
  let correlationId = req.headers['x-correlation-id'] as string | undefined;

  // 2. إذا لم يكن موجوداً، توليد واحد جديد
  if (!correlationId) {
    correlationId = randomUUID();
  }

  // 3. بناء سياق الارتباط
  const context: CorrelationContext = {
    correlationId,
    startTimestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
  };

  // 4. إضافة معرّف الارتباط إلى رأس الاستجابة
  res.setHeader('x-correlation-id', correlationId);

  // 5. تنفيذ الطلب ضمن سياق AsyncLocalStorage
  correlationStorage.run(context, () => {
    // ✅ تم إزالة إعادة تعريف res.end لأنه كان غير ضروري ويسبب أخطاء TypeScript.
    // إذا أردت تسجيل وقت الانتهاء، يمكنك استخدام:
    // res.on('finish', () => { ... });
    next();
  });
}

/**
 * دالة مساعدة لتنفيذ دالة ضمن سياق ارتباط محدد (للمهام غير المتزامنة).
 */
export function runWithCorrelationContext<T>(
  correlationId: string,
  fn: () => T
): T {
  const context: CorrelationContext = {
    correlationId,
    startTimestamp: new Date().toISOString(),
    path: 'async-job',
    method: 'JOB',
  };
  return correlationStorage.run(context, fn);
}

