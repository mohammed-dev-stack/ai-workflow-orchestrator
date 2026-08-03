// ============================================================
// backend/prisma.config.ts
// ============================================================
// تم إصلاح تكوين الـ seed ليتوافق مع Prisma 7.
// ============================================================

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // ✅ استخدام tsx لتشغيل ملف TypeScript
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});