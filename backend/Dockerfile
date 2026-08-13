# ============================================================
# backend/Dockerfile
# ============================================================
# صورة إنتاجية متعددة المراحل (Multi-stage) لتطبيق Backend.
# ✅ يستخدم Node.js 20 Alpine (خفيف وآمن).
# ✅ يعتمد على Prisma مع PostgreSQL و pgvector.
# ✅ يحتوي على Healthcheck للتحقق من جاهزية الخادم.
# ✅ يحسن التخزين المؤقت (Caching) لطبقات Docker.
# ============================================================

# ============================================================
# المرحلة 1: البناء (Builder)
# ============================================================
FROM node:20-alpine AS builder

# تعيين دليل العمل
WORKDIR /app

# 1. نسخ ملفات الاعتماديات (لتخزينها في الكاش)
COPY package*.json ./
COPY prisma ./prisma/

# 2. تثبيت جميع الاعتماديات (بما فيها devDependencies للبناء)
RUN npm ci --include=dev

# 3. نسخ باقي الكود المصدري
COPY . .

# 4. توليد عميل Prisma
RUN npx prisma generate

# 5. بناء المشروع (تحويل TypeScript → JavaScript)
RUN npm run build

# ============================================================
# المرحلة 2: الإنتاج (Production)
# ============================================================
FROM node:20-alpine AS production

# تثبيت أدوات النظام الأساسية (لـ Healthcheck)
RUN apk add --no-cache curl

# تعيين دليل العمل
WORKDIR /app

# 1. نسخ ملفات الاعتماديات فقط (للتثبيت المنتج)
COPY package*.json ./

# 2. تثبيت اعتماديات الإنتاج فقط (بدون devDependencies)
RUN npm ci --omit=dev

# 3. نسخ ملفات Prisma (للـ migrate و generate)
COPY prisma ./prisma

# 4. نسخ مخرجات البناء من مرحلة Builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated

# 5. توليد عميل Prisma في بيئة الإنتاج
RUN npx prisma generate

# 6. إنشاء مجلد للسجلات (اختياري)
RUN mkdir -p logs && chown -R node:node /app

# 7. التبديل إلى المستخدم node (غير الجذر) للأمان
USER node

# 8. فتح منفذ الخادم
EXPOSE 3000

# 9. تعريف فحص الصحة (Healthcheck)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# 10. تشغيل الخادم
CMD ["node", "dist/index.js"]