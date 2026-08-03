// ============================================================
// backend/src/utils/date.ts
// ============================================================
// دوال مساعدة للتعامل مع التواريخ — جميع الدوال آمنة النوع.
// تم إصلاح مشكلة `parseDate` بتحقق صريح من وجود عناصر المصفوفة.
// ============================================================

import { logger } from '../observability/logger.js';
import { getCurrentCorrelationId } from '../middlewares/correlation.middleware.js';
import { ValidationError } from '../middlewares/errorHandler.middleware.js';

// ============================================================
// الثوابت — SSoT لتنسيقات التواريخ
// ============================================================

export const DATE_FORMATS = {
  ISO: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
  DATE: 'YYYY-MM-DD',
  TIME: 'HH:mm:ss',
  DATETIME: 'YYYY-MM-DD HH:mm:ss',
  DATETIME_TZ: 'YYYY-MM-DD HH:mm:ssZ',
  SHORT: 'DD MMM YYYY',
  LONG: 'DD MMMM YYYY, HH:mm',
  RELATIVE: 'relative',
} as const;

export type DateFormat = typeof DATE_FORMATS[keyof typeof DATE_FORMATS];

export const TIME_UNITS = {
  MILLISECOND: 'millisecond',
  SECOND: 'second',
  MINUTE: 'minute',
  HOUR: 'hour',
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
  YEAR: 'year',
} as const;

export type TimeUnit = typeof TIME_UNITS[keyof typeof TIME_UNITS];

export const WEEK_DAYS = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
} as const;

export type WeekDay = typeof WEEK_DAYS[keyof typeof WEEK_DAYS];

// ============================================================
// دوال التحقق والتحويل الأساسية
// ============================================================

export function toDate(value: string | number | Date | null | undefined): Date {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

  if (value === null || value === undefined) {
    logger.warn('محاولة تحويل قيمة فارغة إلى Date', { correlationId });
    throw new ValidationError('القيمة المقدمة فارغة');
  }

  let date: Date;

  if (value instanceof Date) {
    date = new Date(value.getTime());
  } else if (typeof value === 'number') {
    date = new Date(value);
  } else if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (isNaN(parsed)) {
      logger.warn('محاولة تحويل سلسلة نصية غير صالحة إلى Date', {
        correlationId,
        value: value.substring(0, 100),
      });
      throw new ValidationError(`السلسلة النصية "${value}" غير صالحة كتاريخ`);
    }
    date = new Date(parsed);
  } else {
    throw new ValidationError(`النوع "${typeof value}" غير مدعوم للتحويل إلى Date`);
  }

  if (isNaN(date.getTime())) {
    logger.warn('تم إنشاء تاريخ غير صالح', {
      correlationId,
      inputType: typeof value,
      input: String(value).substring(0, 100),
    });
    throw new ValidationError('التاريخ الناتج غير صالح');
  }

  return date;
}

export function isValidDate(date: any): boolean {
  if (!date) return false;
  if (date instanceof Date) {
    return !isNaN(date.getTime());
  }
  if (typeof date === 'string' || typeof date === 'number') {
    try {
      return !isNaN(new Date(date).getTime());
    } catch {
      return false;
    }
  }
  return false;
}

// ============================================================
// دوال التنسيق
// ============================================================

export function formatDate(date: Date | string | number, format: string): string {
  const d = toDate(date);

  const replacements: Record<string, string> = {
    'YYYY': String(d.getUTCFullYear()),
    'YY': String(d.getUTCFullYear()).slice(-2),
    'MM': String(d.getUTCMonth() + 1).padStart(2, '0'),
    'M': String(d.getUTCMonth() + 1),
    'DD': String(d.getUTCDate()).padStart(2, '0'),
    'D': String(d.getUTCDate()),
    'HH': String(d.getUTCHours()).padStart(2, '0'),
    'H': String(d.getUTCHours()),
    'mm': String(d.getUTCMinutes()).padStart(2, '0'),
    'm': String(d.getUTCMinutes()),
    'ss': String(d.getUTCSeconds()).padStart(2, '0'),
    's': String(d.getUTCSeconds()),
    'SSS': String(d.getUTCMilliseconds()).padStart(3, '0'),
    'Z': d.toISOString().match(/[+-]\d{2}:\d{2}$/)?.[0] || '+00:00',
  };

  let result = format;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(key, 'g'), value);
  }

  return result;
}

export function toISOString(date: Date | string | number): string {
  return toDate(date).toISOString();
}

export function toDateString(date: Date | string | number): string {
  return formatDate(date, DATE_FORMATS.DATE);
}

export function toTimeString(date: Date | string | number): string {
  return formatDate(date, DATE_FORMATS.TIME);
}

export function toShortDateString(date: Date | string | number): string {
  const d = toDate(date);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = monthNames[d.getUTCMonth()];
  const year = String(d.getUTCFullYear());
  return `${day} ${month} ${year}`;
}

export function toLongDateString(date: Date | string | number): string {
  const d = toDate(date);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = monthNames[d.getUTCMonth()];
  const year = String(d.getUTCFullYear());
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes}`;
}

// ============================================================
// دوال حدود الوقت (Start / End)
// ============================================================

export function startOfDay(date: Date | string | number): Date {
  const d = toDate(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function endOfDay(date: Date | string | number): Date {
  const d = toDate(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

export function startOfWeek(date: Date | string | number, weekStartsOn: WeekDay = WEEK_DAYS.MONDAY): Date {
  const d = toDate(date);
  const day = d.getUTCDay();
  const diff = (day - weekStartsOn + 7) % 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return start;
}

export function endOfWeek(date: Date | string | number, weekStartsOn: WeekDay = WEEK_DAYS.MONDAY): Date {
  const d = toDate(date);
  const start = startOfWeek(d, weekStartsOn);
  return new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate() + 6,
    23, 59, 59, 999
  ));
}

export function startOfMonth(date: Date | string | number): Date {
  const d = toDate(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function endOfMonth(date: Date | string | number): Date {
  const d = toDate(date);
  const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return new Date(Date.UTC(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth(),
    nextMonth.getUTCDate() - 1,
    23, 59, 59, 999
  ));
}

// ============================================================
// دوال العمليات الحسابية على التواريخ
// ============================================================

export function addTime(date: Date | string | number, amount: number, unit: TimeUnit): Date {
  const d = toDate(date);
  const result = new Date(d.getTime());

  switch (unit) {
    case TIME_UNITS.MILLISECOND:
      result.setUTCMilliseconds(result.getUTCMilliseconds() + amount);
      break;
    case TIME_UNITS.SECOND:
      result.setUTCSeconds(result.getUTCSeconds() + amount);
      break;
    case TIME_UNITS.MINUTE:
      result.setUTCMinutes(result.getUTCMinutes() + amount);
      break;
    case TIME_UNITS.HOUR:
      result.setUTCHours(result.getUTCHours() + amount);
      break;
    case TIME_UNITS.DAY:
      result.setUTCDate(result.getUTCDate() + amount);
      break;
    case TIME_UNITS.WEEK:
      result.setUTCDate(result.getUTCDate() + amount * 7);
      break;
    case TIME_UNITS.MONTH:
      result.setUTCMonth(result.getUTCMonth() + amount);
      break;
    case TIME_UNITS.YEAR:
      result.setUTCFullYear(result.getUTCFullYear() + amount);
      break;
    default:
      throw new ValidationError(`الوحدة الزمنية "${unit}" غير معروفة`);
  }

  return result;
}

export function addDays(date: Date | string | number, days: number): Date {
  return addTime(date, days, TIME_UNITS.DAY);
}

export function addWeeks(date: Date | string | number, weeks: number): Date {
  return addTime(date, weeks, TIME_UNITS.WEEK);
}

export function addMonths(date: Date | string | number, months: number): Date {
  return addTime(date, months, TIME_UNITS.MONTH);
}

export function diffTime(date1: Date | string | number, date2: Date | string | number, unit: TimeUnit): number {
  const d1 = toDate(date1);
  const d2 = toDate(date2);
  const diffMs = d1.getTime() - d2.getTime();

  switch (unit) {
    case TIME_UNITS.MILLISECOND:
      return diffMs;
    case TIME_UNITS.SECOND:
      return diffMs / 1000;
    case TIME_UNITS.MINUTE:
      return diffMs / (1000 * 60);
    case TIME_UNITS.HOUR:
      return diffMs / (1000 * 60 * 60);
    case TIME_UNITS.DAY:
      return diffMs / (1000 * 60 * 60 * 24);
    case TIME_UNITS.WEEK:
      return diffMs / (1000 * 60 * 60 * 24 * 7);
    case TIME_UNITS.MONTH:
      return diffMs / (1000 * 60 * 60 * 24 * 30.44);
    case TIME_UNITS.YEAR:
      return diffMs / (1000 * 60 * 60 * 24 * 365.25);
    default:
      throw new ValidationError(`الوحدة الزمنية "${unit}" غير معروفة`);
  }
}

export function diffDays(date1: Date | string | number, date2: Date | string | number): number {
  return diffTime(date1, date2, TIME_UNITS.DAY);
}

export function diffWeeks(date1: Date | string | number, date2: Date | string | number): number {
  return diffTime(date1, date2, TIME_UNITS.WEEK);
}

export function diffMonths(date1: Date | string | number, date2: Date | string | number): number {
  return diffTime(date1, date2, TIME_UNITS.MONTH);
}

// ============================================================
// دوال المقارنة والتصنيف
// ============================================================

export function isToday(date: Date | string | number): boolean {
  const d = toDate(date);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() &&
         d.getUTCMonth() === now.getUTCMonth() &&
         d.getUTCDate() === now.getUTCDate();
}

export function isYesterday(date: Date | string | number): boolean {
  const d = toDate(date);
  const yesterday = addDays(new Date(), -1);
  return d.getUTCFullYear() === yesterday.getUTCFullYear() &&
         d.getUTCMonth() === yesterday.getUTCMonth() &&
         d.getUTCDate() === yesterday.getUTCDate();
}

export function isThisWeek(date: Date | string | number, weekStartsOn: WeekDay = WEEK_DAYS.MONDAY): boolean {
  const d = toDate(date);
  const now = new Date();
  const start = startOfWeek(now, weekStartsOn);
  const end = endOfWeek(now, weekStartsOn);
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

export function isThisMonth(date: Date | string | number): boolean {
  const d = toDate(date);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear() &&
         d.getUTCMonth() === now.getUTCMonth();
}

export function isSameDay(date1: Date | string | number, date2: Date | string | number): boolean {
  const d1 = toDate(date1);
  const d2 = toDate(date2);
  return d1.getUTCFullYear() === d2.getUTCFullYear() &&
         d1.getUTCMonth() === d2.getUTCMonth() &&
         d1.getUTCDate() === d2.getUTCDate();
}

export function isSameWeek(
  date1: Date | string | number,
  date2: Date | string | number,
  weekStartsOn: WeekDay = WEEK_DAYS.MONDAY
): boolean {
  const d1 = toDate(date1);
  const d2 = toDate(date2);
  const start1 = startOfWeek(d1, weekStartsOn);
  const start2 = startOfWeek(d2, weekStartsOn);
  return start1.getTime() === start2.getTime();
}

export function isSameMonth(date1: Date | string | number, date2: Date | string | number): boolean {
  const d1 = toDate(date1);
  const d2 = toDate(date2);
  return d1.getUTCFullYear() === d2.getUTCFullYear() &&
         d1.getUTCMonth() === d2.getUTCMonth();
}

// ============================================================
// دوال الوقت النسبي (Relative Time)
// ============================================================

export function timeAgo(date: Date | string | number): string {
  const d = toDate(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();

  if (diffMs < 0) {
    return 'في المستقبل';
  }

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30.44);
  const diffYear = Math.floor(diffDay / 365.25);

  if (diffYear > 0) {
    return diffYear === 1 ? 'منذ سنة' : `منذ ${diffYear} سنوات`;
  }
  if (diffMonth > 0) {
    return diffMonth === 1 ? 'منذ شهر' : `منذ ${diffMonth} أشهر`;
  }
  if (diffWeek > 0) {
    return diffWeek === 1 ? 'منذ أسبوع' : `منذ ${diffWeek} أسابيع`;
  }
  if (diffDay > 0) {
    return diffDay === 1 ? 'منذ يوم' : `منذ ${diffDay} أيام`;
  }
  if (diffHour > 0) {
    return diffHour === 1 ? 'منذ ساعة' : `منذ ${diffHour} ساعات`;
  }
  if (diffMin > 0) {
    return diffMin === 1 ? 'منذ دقيقة' : `منذ ${diffMin} دقائق`;
  }
  if (diffSec > 10) {
    return `منذ ${diffSec} ثوانٍ`;
  }

  return 'الآن';
}

// ============================================================
// دوال تحويل UTC / Local
// ============================================================

export function toUTC(date: Date | string | number): Date {
  const d = toDate(date);
  return new Date(Date.UTC(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds()
  ));
}

export function fromUTC(date: Date | string | number): Date {
  const d = toDate(date);
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds()
  );
}

export function toUTCTimestamp(date: Date | string | number): number {
  return toDate(date).getTime();
}

export function fromUTCTimestamp(timestamp: number): Date {
  return new Date(timestamp);
}

// ============================================================
// دوال تحليل التواريخ (Parsing) — ✅ تم إصلاحها بالكامل
// ============================================================

export function parseDate(value: string): Date {
  const correlationId = getCurrentCorrelationId() || 'no-correlation-id';

  if (!value || typeof value !== 'string') {
    throw new ValidationError('القيمة المراد تحليلها يجب أن تكون سلسلة نصية غير فارغة');
  }

  // محاولة التحليل بواسطة Date.parse
  const timestamp = Date.parse(value);
  if (!isNaN(timestamp)) {
    return new Date(timestamp);
  }

  const trimmed = value.trim();

  // YYYY-MM-DD
  const dateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    // ✅ التحقق من وجود العناصر الثلاثة
    const yearStr = dateMatch[1];
    const monthStr = dateMatch[2];
    const dayStr = dateMatch[3];
    if (yearStr && monthStr && dayStr) {
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10) - 1;
      const day = parseInt(dayStr, 10);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        return new Date(Date.UTC(year, month, day));
      }
    }
  }

  // DD/MM/YYYY
  const dmYMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmYMatch) {
    const dayStr = dmYMatch[1];
    const monthStr = dmYMatch[2];
    const yearStr = dmYMatch[3];
    if (dayStr && monthStr && yearStr) {
      const day = parseInt(dayStr, 10);
      const month = parseInt(monthStr, 10) - 1;
      const year = parseInt(yearStr, 10);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(Date.UTC(year, month, day));
      }
    }
  }

  logger.warn('فشل تحليل السلسلة النصية كتاريخ', {
    correlationId,
    value: value.substring(0, 100),
  });
  throw new ValidationError(`لا يمكن تحليل "${value}" كتاريخ`);
}

// ============================================================
// تصدير الكائنات والدوال
// ============================================================

export default {
  DATE_FORMATS,
  TIME_UNITS,
  WEEK_DAYS,

  toDate,
  isValidDate,

  formatDate,
  toISOString,
  toDateString,
  toTimeString,
  toShortDateString,
  toLongDateString,

  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,

  addTime,
  addDays,
  addWeeks,
  addMonths,
  diffTime,
  diffDays,
  diffWeeks,
  diffMonths,

  isToday,
  isYesterday,
  isThisWeek,
  isThisMonth,
  isSameDay,
  isSameWeek,
  isSameMonth,

  timeAgo,

  toUTC,
  fromUTC,
  toUTCTimestamp,
  fromUTCTimestamp,

  parseDate,
};
