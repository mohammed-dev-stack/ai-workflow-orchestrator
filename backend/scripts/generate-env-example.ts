// ============================================================
// backend/scripts/generate-env-example.ts
// ============================================================
// سكريبت لتوليد ملف .env.example تلقائياً من env.schema.ts
// يُشغّل عند كل بناء (prebuild) أو يدوياً عبر npm run generate-env
// ✅ تم إصلاح مشكلة __dirname في ES modules باستخدام import.meta.url
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url'; // ✅ للحصول على __dirname في ES modules
import { z } from 'zod';
import { envSchema } from '../src/config/env.schema';

// ============================================================
// الحصول على __dirname في بيئة ES module
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// دوال مساعدة متسامحة للتعامل مع أنواع Zod
// ============================================================

/**
 * استخراج المخطط الداخلي (بعد إزالة ZodOptional و ZodDefault).
 */
function getInnerSchema(schema: any): any {
  if (schema && schema._def) {
    if (schema._def.innerType) {
      return schema._def.innerType;
    }
    if (schema._def.type) {
      return schema._def.type;
    }
    if (schema._def.schema) {
      return schema._def.schema;
    }
  }
  return schema;
}

/**
 * الحصول على وصف نوع المتغير كنص.
 */
function getTypeDescription(schema: any): string {
  const inner = getInnerSchema(schema);

  if (inner instanceof z.ZodString) return 'string';
  if (inner instanceof z.ZodNumber) return 'number';
  if (inner instanceof z.ZodBoolean) return 'boolean';

  if (inner instanceof z.ZodEnum) {
    const opts = inner.options || [];
    return opts.map((o: any) => `"${String(o)}"`).join(' | ');
  }

  if (inner instanceof z.ZodUnion) {
    const opts = inner.options || [];
    const types = opts.map((s: any) => getTypeDescription(s));
    return types.join(' | ');
  }

  if (inner instanceof z.ZodLiteral) {
    return `"${String(inner.value)}"`;
  }

  if (inner && inner._def && inner._def.typeName) {
    const typeName = inner._def.typeName;
    if (typeName === 'ZodString') return 'string';
    if (typeName === 'ZodNumber') return 'number';
    if (typeName === 'ZodBoolean') return 'boolean';
    if (typeName === 'ZodEnum') {
      const opts = inner._def.values || [];
      return opts.map((o: any) => `"${String(o)}"`).join(' | ');
    }
  }

  return 'unknown';
}

/**
 * الحصول على القيمة الافتراضية من المخطط (إن وجدت).
 */
function getDefaultValue(schema: any): string | null {
  if (schema && schema._def) {
    if (typeof schema._def.defaultValue === 'function') {
      try {
        const val = schema._def.defaultValue();
        return String(val);
      } catch {
        return null;
      }
    }
    if (schema._def.defaultValue !== undefined) {
      try {
        return String(schema._def.defaultValue);
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * تحديد ما إذا كان المتغير مطلوباً أم لا.
 */
function isRequired(schema: any): boolean {
  if (schema instanceof z.ZodOptional) return false;
  if (schema instanceof z.ZodDefault) return false;

  if (schema && schema._def) {
    const typeName = schema._def.typeName;
    if (typeName === 'ZodOptional' || typeName === 'ZodDefault') return false;
  }

  if (getDefaultValue(schema) !== null) return false;

  return true;
}

// ============================================================
// توليد محتوى ملف .env.example
// ============================================================

function generateEnvExample(): string {
  const shape = envSchema.shape;
  const output: string[] = [];

  // رأس الملف
  output.push('# ============================================================');
  output.push('# .env.example — نموذج لمتغيرات البيئة');
  output.push('# ============================================================');
  output.push('# تم توليد هذا الملف تلقائياً من env.schema.ts');
  output.push('# يرجى نسخه إلى .env وتعديل القيم حسب البيئة');
  output.push('# ============================================================');
  output.push('');

  let currentSection = '';

  for (const [key, schema] of Object.entries(shape)) {
    const description = (schema as any).description || '';
    const typeDesc = getTypeDescription(schema);
    const defaultValue = getDefaultValue(schema);
    const required = isRequired(schema);

    // تحديد القسم
    let section = '';
    if (key.startsWith('NODE_ENV') || key === 'PORT' || key === 'CORS_ORIGIN') {
      section = '# 1. البيئة العامة';
    } else if (key.startsWith('DATABASE_') || key === 'DATABASE_URL') {
      section = '# 2. قاعدة البيانات (PostgreSQL + pgvector)';
    } else if (key.startsWith('REDIS_')) {
      section = '# 3. Redis (BullMQ)';
    } else if (key.startsWith('JWT_')) {
      section = '# 4. JWT (المصادقة)';
    } else if (key.startsWith('ANTHROPIC_')) {
      section = '# 5. Anthropic Claude (الذكاء الاصطناعي)';
    } else if (key.startsWith('CIRCUIT_') || key.startsWith('RETRY_')) {
      section = '# 6. قاطع الدائرة وإعادة المحاولة';
    } else if (key.startsWith('WHATSAPP_')) {
      section = '# 7. WhatsApp Cloud API';
    } else if (key.startsWith('OTEL_') || key === 'LOG_LEVEL') {
      section = '# 8. قابلية المراقبة (Observability)';
    } else if (key === 'IDEMPOTENCY_TTL') {
      section = '# 9. التكافؤ (Idempotency)';
    } else if (key.startsWith('RATE_LIMIT_')) {
      section = '# 10. حدود المعدل (Rate Limiting)';
    } else if (key === 'ENCRYPTION_KEY') {
      section = '# 11. التشفير (Encryption)';
    } else {
      section = '# متغيرات إضافية';
    }

    if (section !== currentSection) {
      if (currentSection !== '') {
        output.push('');
      }
      output.push(section);
      output.push('');
      currentSection = section;
    }

    let line = `${key}=`;

    if (defaultValue !== null) {
      line += defaultValue;
    } else if (required) {
      line += `<${typeDesc}>`;
    } else {
      line += '';
    }

    const comments: string[] = [];
    if (description) comments.push(description);
    comments.push(`النوع: ${typeDesc}`);
    if (!required) comments.push('اختياري');
    if (defaultValue !== null) comments.push(`القيمة الافتراضية: ${defaultValue}`);

    if (comments.length > 0) {
      line += `  # ${comments.join(' | ')}`;
    }

    output.push(line);
  }

  output.push('');
  output.push('# ============================================================');
  output.push('# نهاية ملف .env.example');
  output.push('# ============================================================');

  return output.join('\n');
}

// ============================================================
// كتابة الملف إلى جذر المشروع
// ============================================================

function writeEnvExample(): void {
  const content = generateEnvExample();
  const targetPath = path.resolve(__dirname, '../.env.example');

  try {
    fs.writeFileSync(targetPath, content, 'utf-8');
    console.log(`✅ تم تحديث ملف ${targetPath} بنجاح.`);
  } catch (error) {
    console.error('❌ فشل في كتابة ملف .env.example:', error);
    process.exit(1);
  }
}

// تنفيذ السكريبت
writeEnvExample();