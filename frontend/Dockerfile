# مرحلة البناء
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# مرحلة التشغيل (Nginx)
FROM nginx:alpine

# نسخ ملفات البناء إلى مجلد Nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# (اختياري) نسخ ملف إعدادات Nginx مخصص إذا أردت
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]