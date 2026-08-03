// ============================================================
// backend/prisma.config.ts
// ============================================================
// ملف إعدادات Prisma (لـ Prisma 7)
// يتم تحميله تلقائياً بواسطة Prisma CLI عند تشغيل الأوامر.
// ============================================================
import "dotenv/config"; // تحميل متغيرات البيئة من ملف .env
import { defineConfig } from "prisma/config";
export default defineConfig({
    // مسار ملف الـ schema (افتراضي، لكن نحدده صراحة)
    schema: "prisma/schema.prisma",
    // إعدادات الترحيلات
    migrations: {
        path: "prisma/migrations",
    },
    // المصدر الوحيد (SSoT) لرابط قاعدة البيانات
    datasource: {
        // يُقرأ من متغير البيئة DATABASE_URL
        url: process.env["DATABASE_URL"],
    },
});
//# sourceMappingURL=prisma.config.js.map