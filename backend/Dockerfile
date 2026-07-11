# ==========================================
#  المرحلة 1: البناء (Builder)
# ==========================================
FROM node:20-alpine AS builder

# تعيين مجلد العمل داخل الحاوية
WORKDIR /app

# نسخ ملفات الحزم لتثبيت الاعتماديات
COPY package*.json ./

# تثبيت جميع الاعتماديات (بما فيها devDependencies)
RUN npm install

# نسخ كامل الكود المصدري
COPY . .

# بناء المشروع (تشغيل TypeScript Compiler)
RUN npm run build

# ==========================================
#  المرحلة 2: التشغيل (Production)
# ==========================================
FROM node:20-alpine

# تعيين مجلد العمل
WORKDIR /app

# نسخ ملفات الحزم مرة أخرى (لتثبيت الاعتماديات الأساسية فقط)
COPY package*.json ./

# تثبيت فقط الاعتماديات الأساسية (بدون devDependencies)
RUN npm install --omit=dev

# نسخ ملفات البناء من المرحلة السابقة
COPY --from=builder /app/dist ./dist

# إظهار المنفذ الذي سيستخدمه التطبيق
EXPOSE 5000

# تشغيل التطبيق
CMD ["node", "dist/app.js"]