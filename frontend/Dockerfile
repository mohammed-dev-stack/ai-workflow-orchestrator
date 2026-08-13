# ============================================================
# frontend/Dockerfile
# ============================================================
# صورة إنتاجية لتطبيق Frontend (React SPA) باستخدام Nginx.
# ✅ يستخدم مرحلة بناء (Builder) ثم Nginx خفيف.
# ✅ يدعم التوجيه (Routing) عبر try_files (لـ React Router).
# ✅ يحسن التخزين المؤقت باستخدام Gzip و Cache-Control.
# ============================================================

# ============================================================
# المرحلة 1: البناء (Builder)
# ============================================================
FROM node:20-alpine AS builder

# تعيين دليل العمل
WORKDIR /app

# 1. نسخ ملفات الاعتماديات
COPY package*.json ./

# 2. تثبيت الاعتماديات
RUN npm ci

# 3. نسخ باقي الكود المصدري
COPY . .

# 4. بناء التطبيق (Vite)
RUN npm run build

# ============================================================
# المرحلة 2: الإنتاج (Nginx)
# ============================================================
FROM nginx:alpine AS production

# 1. تثبيت curl لـ Healthcheck
RUN apk add --no-cache curl

# 2. نسخ ملفات البناء من المرحلة السابقة إلى مجلد Nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# 3. إنشاء ملف تكوين Nginx مخصص
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    location /assets/ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    error_page 404 /index.html; \
}' > /etc/nginx/conf.d/default.conf

# 4. فتح المنفذ 80
EXPOSE 80

# 5. تعريف فحص الصحة (Healthcheck)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:80/ || exit 1

# 6. تشغيل Nginx
CMD ["nginx", "-g", "daemon off;"]