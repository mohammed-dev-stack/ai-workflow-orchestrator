// ============================================================
// backend/prisma/seed.ts
// ============================================================
// تهيئة البيانات الأولية (Seed) — باستخدام عميل Prisma من التطبيق.
// تم إصلاح خطأ تهيئة PrismaClient باستخدام الاستيراد من التطبيق مباشرةً.
// ============================================================

// ✅ تحميل متغيرات البيئة أولاً
import 'dotenv/config';

// ✅ استيراد عميل Prisma من التطبيق (مُهيأ مع adapter بالفعل)
import { prisma } from '../src/models/prisma/client.js';
import { hash } from 'bcrypt';

async function main() {
  console.log('🌱 بدء تهيئة البيانات...');

  // 1. إنشاء مستأجر (Tenant) إذا لم يكن موجوداً
  const tenant = await prisma.tenant.upsert({
    where: { name: 'Default Tenant' },
    update: {},
    create: {
      id: 'default-tenant-id',
      name: 'Default Tenant',
      adminEmail: 'admin@example.com',
      status: 'ACTIVE',
      plan: 'FREE',
    },
  });

  console.log(`✅ تم التأكد من وجود المستأجر: ${tenant.name} (${tenant.id})`);

  // 2. التحقق من وجود المستخدم بالفعل
  const existingUser = await prisma.user.findUnique({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: 'admin@example.com',
      },
    },
  });

  if (!existingUser) {
    const passwordHash = await hash('admin123', 10);
    await prisma.user.create({
      data: {
        email: 'admin@example.com',
        passwordHash,
        name: 'Admin User',
        tenantId: tenant.id,
        role: 'ADMIN',
        isActive: true,
      },
    });
    console.log('✅ تم إنشاء المستخدم التجريبي: admin@example.com / admin123');
  } else {
    console.log('ℹ️ المستخدم موجود بالفعل، تخطي الإنشاء.');
  }

  console.log('✅ اكتملت تهيئة البيانات بنجاح!');
}

main()
  .catch((error) => {
    console.error('❌ فشل تهيئة البيانات:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('🔌 تم قطع اتصال قاعدة البيانات.');
  });