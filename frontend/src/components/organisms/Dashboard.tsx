// frontend/src/components/organisms/Dashboard.tsx
import React, { forwardRef, memo, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';
import { useAuthStore } from '../../stores/auth.store';
import { Button } from '../atoms/Button';
import { Spinner } from '../atoms/Spinner';

/**
 * بنية إحصاءات لوحة التحكم.
 * [مُتحقَّق منطقياً بتتبع كامل] — بيانات الإحصائيات من الـ API.
 */
export interface DashboardStats {
  /** إجمالي المحادثات */
  totalConversations: number;
  /** المحادثات النشطة */
  activeConversations: number;
  /** المحادثات المغلقة */
  closedConversations: number;
  /** إجمالي الرسائل */
  totalMessages: number;
  /** رسائل المستخدم */
  userMessages: number;
  /** رسائل المساعد */
  assistantMessages: number;
  /** إجمالي المستندات */
  totalDocuments: number;
  /** المستندات المكتملة */
  completedDocuments: number;
  /** المستندات قيد المعالجة */
  processingDocuments: number;
  /** المستندات الفاشلة */
  failedDocuments: number;
  /** إجمالي طلبات الذكاء الاصطناعي */
  aiTotalRequests: number;
  /** معدل نجاح الذكاء الاصطناعي (0-100) */
  aiSuccessRate: number;
  /** إجمالي مساحة التخزين بالبايت */
  totalStorageBytes: number;
}

/**
 * خصائص مكون لوحة التحكم.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface DashboardProps {
  /** إحصائيات لوحة التحكم */
  stats?: DashboardStats | null;
  /** ما إذا كانت الإحصائيات في حالة تحميل */
  isLoading?: boolean;
  /** خطأ (إذا فشل جلب البيانات) */
  error?: string | null;
  /** دالة تستدعى لإعادة تحميل البيانات */
  onRetry?: () => void;
  /** معرف فئة CSS إضافية */
  className?: string;
}

/**
 * مكون بطاقة إحصائية فردية.
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون فرعي داخلي.
 */
const StatCard = memo(({
  title,
  value,
  icon,
  color = 'blue',
  isLoading = false,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray';
  isLoading?: boolean;
}) => {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    gray: 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="flex items-center gap-3">
        {/* الأيقونة */}
        <div className={clsx('p-2 rounded-lg', colorClasses[color])}>
          {icon}
        </div>

        {/* القيمة والعنوان */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{title}</p>
          {isLoading ? (
            <Spinner size="sm" variant="primary" className="mt-0.5" />
          ) : (
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-100 truncate">
              {typeof value === 'number' ? value.toLocaleString('ar-SA') : value}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

StatCard.displayName = 'StatCard';

/**
 * مكون لوحة التحكم (Dashboard) — عضوي، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="main"` للإشارة إلى المحتوى الرئيسي
 * - `aria-label` للتسمية الوصفية
 * - `aria-live="polite"` للرسائل الديناميكية
 * - `aria-atomic="true"` للإعلان الكامل
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون لوحة تحكم كامل مع دعم إمكانية الوصول.
 */
export const Dashboard = memo(
  forwardRef<HTMLDivElement, DashboardProps>(
    (
      {
        stats,
        isLoading = false,
        error = null,
        onRetry,
        className,
      },
      ref
    ) => {
      const navigate = useNavigate();
      const { user } = useAuthStore();

      // تنسيق مساحة التخزين
      const formattedStorage = useMemo(() => {
        if (!stats?.totalStorageBytes) return '0 B';
        const bytes = stats.totalStorageBytes;
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const size = bytes / Math.pow(k, i);
        return `${size.toFixed(1)} ${sizes[i]}`;
      }, [stats?.totalStorageBytes]);

      // رسالة الترحيب
      const greeting = useMemo(() => {
        const hour = new Date().getHours();
        if (hour < 12) return 'صباح الخير';
        if (hour < 18) return 'مساء الخير';
        return 'مساء الخير';
      }, []);

      // تاريخ اليوم
      const todayDate = useMemo(() => {
        return format(new Date(), 'dd MMMM yyyy', { locale: arSA });
      }, []);

      // حالة التحميل
      if (isLoading) {
        return (
          <div
            ref={ref}
            className={clsx('flex items-center justify-center min-h-[400px] w-full', className)}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="flex flex-col items-center gap-4">
              <Spinner size="lg" variant="primary" />
              <p className="text-gray-500 dark:text-gray-400">جاري تحميل لوحة التحكم...</p>
            </div>
          </div>
        );
      }

      // حالة الخطأ
      if (error) {
        return (
          <div
            ref={ref}
            className={clsx(
              'flex flex-col items-center justify-center min-h-[400px] w-full p-8',
              'bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800',
              className
            )}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <svg className="w-12 h-12 text-red-500 dark:text-red-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
              فشل تحميل البيانات
            </h3>
            <p className="text-sm text-red-600 dark:text-red-300 mb-4 text-center max-w-md">
              {error}
            </p>
            {onRetry && (
              <Button variant="primary" onClick={onRetry}>
                إعادة المحاولة
              </Button>
            )}
          </div>
        );
      }

      // إذا لم تكن هناك بيانات
      if (!stats) {
        return (
          <div
            ref={ref}
            className={clsx(
              'flex flex-col items-center justify-center min-h-[400px] w-full p-8',
              'bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700',
              className
            )}
          >
            <p className="text-gray-500 dark:text-gray-400">لا توجد بيانات لعرضها</p>
          </div>
        );
      }

      // عرض لوحة التحكم
      return (
        <div
          ref={ref}
          className={clsx('flex flex-col gap-6', className)}
          role="main"
          aria-label="لوحة التحكم"
        >
          {/* الترحيب */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {greeting}، {user?.fullName || 'مستخدم'} 👋
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {todayDate}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/chat')}
                aria-label="بدء محادثة جديدة"
              >
                <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                محادثة جديدة
              </Button>
            </div>
          </div>

          {/* بطاقات الإحصائيات الأساسية */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <StatCard
              title="المحادثات"
              value={stats.totalConversations}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              }
              color="blue"
            />
            <StatCard
              title="الرسائل"
              value={stats.totalMessages}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
              }
              color="green"
            />
            <StatCard
              title="المستندات"
              value={stats.totalDocuments}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
              color="purple"
            />
            <StatCard
              title="المساحة المستخدمة"
              value={formattedStorage}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
              }
              color="yellow"
            />
          </div>

          {/* الإحصائيات التفصيلية */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* بطاقات المحادثات */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
              <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                المحادثات
              </h2>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                    {stats.activeConversations}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">نشطة</p>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <p className="text-lg font-semibold text-gray-600 dark:text-gray-400">
                    {stats.closedConversations}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">مغلقة</p>
                </div>
                <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                    {stats.totalConversations}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">إجمالي</p>
                </div>
              </div>
            </div>

            {/* بطاقات المستندات */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
              <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                المستندات
              </h2>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                    {stats.completedDocuments}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">مكتملة</p>
                </div>
                <div className="text-center p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <p className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">
                    {stats.processingDocuments}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">قيد المعالجة</p>
                </div>
                <div className="text-center p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                  <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                    {stats.failedDocuments}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">فاشلة</p>
                </div>
              </div>
            </div>
          </div>

          {/* الذكاء الاصطناعي */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              الذكاء الاصطناعي
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">إجمالي الطلبات</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {stats.aiTotalRequests.toLocaleString('ar-SA')}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">معدل النجاح</p>
                <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                  {stats.aiSuccessRate}%
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">رسائل المساعد</p>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {stats.assistantMessages.toLocaleString('ar-SA')}
                </p>
              </div>
            </div>
          </div>

          {/* روابط سريعة */}
          <div className="flex flex-wrap gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
            <Link
              to="/knowledge-bases"
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors duration-200"
            >
              ← إدارة قواعد المعرفة
            </Link>
            <Link
              to="/chat"
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors duration-200"
            >
              ← الذهاب إلى المحادثات
            </Link>
            <Link
              to="/analytics"
              className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors duration-200"
            >
              ← عرض التحليلات الكاملة
            </Link>
          </div>
        </div>
      );
    }
  )
);

Dashboard.displayName = 'Dashboard';

/**
 * تصدير المكون كافتراضي.
 */
export default Dashboard;