// ============================================================
// backend/src/utils/tableNameMapper.ts
// ============================================================
// المصدر الوحيد (SSoT) لتعيين أسماء الموديلات إلى أسماء الجداول الفعلية.
// يحل مشكلة عدم تطابق حالة الأحرف بين @@map في Prisma و PostgreSQL.
// تم إنشاؤه وفق قانون الفصل بين الطبقات (Repository Layer فقط يستخدمه).
// ============================================================

import { Prisma } from '../generated/prisma/index.js';

/**
 * خطأ مخصص يحدث عندما لا يتم العثور على موديل في خريطة DMMF.
 * يُستخدم لفشل سريع وواضح أثناء التهيئة.
 */
export class TableMappingError extends Error {
  constructor(modelName: string) {
    super(`TableMappingError: لا يوجد جدول مطابق للموديل "${modelName}". تأكد من أن الموديل موجود في schema.prisma وتم توليد العميل.`);
    this.name = 'TableMappingError';
    Object.setPrototypeOf(this, TableMappingError.prototype);
  }
}

/**
 * خريطة ثابتة تُبنى مرة واحدة عند أول استيراد للملف.
 * تستخرج أسماء الجداول الفعلية من (Prisma.dmmf) التي يتم تمريرها عبر `@@map`.
 * إذا لم يُعرّف `@@map`، تستخدم اسم الموديل كاسم افتراضي للجدول.
 *
 * ملاحظة: استخدام (Prisma as any).dmmf هو الحل الوحيد الموثوق لاستخراج
 * أسماء الجداول في Prisma، وهو مستقر منذ Prisma 4.x وحتى 7.x.
 */
const TABLE_NAME_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    (Prisma as any).dmmf.datamodel.models.map((model: any) => [
      model.name,
      model.dbName ?? model.name,
    ])
  )
);

/**
 * التحقق من صحة الخريطة عند بدء التشغيل.
 * يتأكد من أن عدد الموديلات في الخريطة يساوي عدد الموديلات في الـ DMMF.
 * في حال الاختلاف، يُلقي خطأً واضحاً يمنع تشغيل التطبيق (فشل سريع).
 */
const expectedModelCount = (Prisma as any).dmmf.datamodel.models.length;
const actualModelCount = Object.keys(TABLE_NAME_MAP).length;

if (expectedModelCount !== actualModelCount) {
  throw new Error(
    `TableMappingError: تعارض في عدد الموديلات. المتوقع: ${expectedModelCount}, المستخرج: ${actualModelCount}. ` +
    `تأكد من توليد عميل Prisma (npx prisma generate) وأن جميع الموديلات تحتوي على حقول صالحة.`
  );
}

/**
 * دالة مساعدة آمنة نوعياً (Type-Safe) للحصول على اسم الجدول الفعلي.
 * تستخدم Generics لتقييد المُدخل بأسماء الموديلات الموجودة فعلاً.
 *
 * @template T - اسم الموديل (مثل 'Document', 'Message', 'DocumentChunk').
 * @param modelName - اسم الموديل كما هو مُعرّف في schema.prisma.
 * @returns اسم الجدول الفعلي في قاعدة البيانات (مُطبق عليه @@map).
 * @throws {TableMappingError} إذا لم يتم العثور على الموديل.
 *
 * @example
 * // يرجِع 'documents' (لأن @@map("documents"))
 * getTableName('Document');
 *
 * // يرجِع 'messages' (لأن @@map("messages"))
 * getTableName('Message');
 */
export function getTableName<T extends keyof typeof TABLE_NAME_MAP>(
  modelName: T
): string {
  const tableName = TABLE_NAME_MAP[modelName];
  if (!tableName) {
    throw new TableMappingError(String(modelName));
  }
  return tableName;
}

/**
 * (اختياري) دالة مساعدة للتحقق من وجود موديل قبل الاستخدام.
 */
export function hasTableName(modelName: string): modelName is keyof typeof TABLE_NAME_MAP {
  return modelName in TABLE_NAME_MAP;
}

/**
 * تصدير الخريطة نفسها للاستخدام في التصحيح أو السجلات (للقراءة فقط).
 */
export const tableNameMap = TABLE_NAME_MAP;