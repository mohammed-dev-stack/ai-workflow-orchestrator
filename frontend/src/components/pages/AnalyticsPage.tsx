// ============================================================
// frontend/src/components/pages/AnalyticsPage.tsx
// ============================================================
// صفحة التحليلات مع معالجة محسنة للأخطاء وعرض رسائل مفهومة.
// ✅ تم إضافة عرض تفاصيل الخطأ للمطور (عند الحاجة).
// ✅ تم إضافة خيار لعرض تفاصيل إضافية عبر toggle.
// ============================================================

import React, { forwardRef, memo, useState, useCallback, useEffect, useMemo } from 'react';
import clsx from 'clsx';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { arSA } from 'date-fns/locale';
import { useAnalytics } from '../../hooks/useAnalytics';
import { useAuthStore } from '../../stores/auth.store';
import { Button } from '../atoms/Button';
import { Spinner } from '../atoms/Spinner';
export type TimeRange = '7d' | '30d' | '90d' | 'custom';

export interface AnalyticsPageProps {
  className?: string;
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return value.toString();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(1)} ${sizes[i]}`;
}

const StatCard = memo(({
  title,
  value,
  change,
  icon,
  color = 'blue',
  isLoading = false,
}: {
  title: string;
  value: number | string;
  change?: number;
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

  const changeColor = change !== undefined ? (change >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400') : '';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm transition-all duration-200 hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{title}</p>
          {isLoading ? (
            <Spinner size="sm" variant="primary" className="mt-1" />
          ) : (
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
              {typeof value === 'number' ? formatNumber(value) : value}
            </p>
          )}
          {change !== undefined && !isLoading && (
            <p className={clsx('text-xs font-medium mt-1', changeColor)}>
              {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%
            </p>
          )}
        </div>
        <div className={clsx('p-2 rounded-lg flex-shrink-0', colorClasses[color])}>{icon}</div>
      </div>
    </div>
  );
});

StatCard.displayName = 'StatCard';

export const AnalyticsPage = memo(
  forwardRef<HTMLDivElement, AnalyticsPageProps>(({ className }, ref) => {
    const { user } = useAuthStore();

    const [timeRange, setTimeRange] = useState<TimeRange>('30d');
    const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
    const [customEndDate, setCustomEndDate] = useState<Date | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const [showErrorDetails, setShowErrorDetails] = useState(false);

    const { startDate, endDate } = useMemo(() => {
      const now = new Date();
      const end = endOfDay(now);

      switch (timeRange) {
        case '7d':
          return { startDate: startOfDay(subDays(now, 7)), endDate: end };
        case '30d':
          return { startDate: startOfDay(subDays(now, 30)), endDate: end };
        case '90d':
          return { startDate: startOfDay(subDays(now, 90)), endDate: end };
        case 'custom':
          return {
            startDate: customStartDate ? startOfDay(customStartDate) : startOfDay(subDays(now, 30)),
            endDate: customEndDate ? endOfDay(customEndDate) : end,
          };
        default:
          return { startDate: startOfDay(subDays(now, 30)), endDate: end };
      }
    }, [timeRange, customStartDate, customEndDate]);

    const {
      dashboardMetrics,
      conversationTrends,
      aiPerformance,
      documentStatusDistribution,
      messageRoleDistribution,
      storageUsage,
      isLoading,
      error,
      errorDetails,
      refreshAll,
      clearError,
      retryCount: hookRetryCount,
    } = useAnalytics({
      startDate,
      endDate,
      autoFetch: true,
      retryAttempts: 3,
    });

    useEffect(() => {
      refreshAll();
    }, [startDate, endDate, refreshAll]);

    const handleTimeRangeChange = useCallback((range: TimeRange) => {
      setTimeRange(range);
      if (range !== 'custom') {
        setCustomStartDate(null);
        setCustomEndDate(null);
      }
      setRetryCount(0);
    }, []);

    const handleRefresh = useCallback(() => {
      setRetryCount((prev) => prev + 1);
      refreshAll();
      clearError();
    }, [refreshAll, clearError]);

    const handleRetry = useCallback(() => {
      setRetryCount((prev) => prev + 1);
      refreshAll();
      clearError();
    }, [refreshAll, clearError]);

    const dateRangeLabel = useMemo(() => {
      if (timeRange === 'custom' && customStartDate && customEndDate) {
        return `${format(customStartDate, 'dd MMM yyyy', { locale: arSA })} - ${format(customEndDate, 'dd MMM yyyy', { locale: arSA })}`;
      }
      return `${format(startDate, 'dd MMM yyyy', { locale: arSA })} - ${format(endDate, 'dd MMM yyyy', { locale: arSA })}`;
    }, [timeRange, customStartDate, customEndDate, startDate, endDate]);

    // حالة التحميل الأولي
    if (isLoading && !dashboardMetrics && retryCount < 3) {
      return (
        <div
          ref={ref}
          className="flex items-center justify-center min-h-[400px] w-full"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex flex-col items-center gap-4">
            <Spinner size="lg" variant="primary" />
            <p className="text-gray-500 dark:text-gray-400">جاري تحميل التحليلات...</p>
            {retryCount > 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                محاولة {retryCount + 1} من 3
              </p>
            )}
          </div>
        </div>
      );
    }

    // حالة الخطأ مع عرض تفاصيل
    if ((error && !dashboardMetrics) || retryCount >= 3) {
      const isDatabaseError = error?.includes('جدول المستندات') || error?.includes('relation "Document"');

      return (
        <div
          ref={ref}
          className={clsx(
            'flex flex-col items-center justify-center min-h-[400px] w-full p-8',
            'bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800'
          )}
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
        >
          <svg
            className="w-12 h-12 text-red-500 dark:text-red-400 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>

          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
            فشل تحميل التحليلات
          </h3>

          <p className="text-sm text-red-600 dark:text-red-300 mb-2 text-center max-w-md">
            {error}
          </p>

          {errorDetails && (
            <div className="mt-2 text-center">
              <button
                onClick={() => setShowErrorDetails(!showErrorDetails)}
                className="text-xs text-red-500 dark:text-red-400 underline hover:text-red-700 dark:hover:text-red-300"
              >
                {showErrorDetails ? 'إخفاء التفاصيل الفنية' : 'عرض التفاصيل الفنية'}
              </button>
              {showErrorDetails && (
                <pre className="mt-2 text-xs text-left bg-red-100 dark:bg-red-900/30 p-3 rounded-lg overflow-auto max-w-full max-h-40 font-mono text-red-700 dark:text-red-300">
                  {errorDetails}
                </pre>
              )}
            </div>
          )}

          {isDatabaseError && (
            <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2 text-center max-w-md">
              💡 يبدو أن هناك مشكلة في قاعدة البيانات. قد تحتاج إلى تشغيل ترحيلات Prisma أو التحقق من هيكل قاعدة البيانات.
            </p>
          )}

          <div className="flex gap-3 mt-4 flex-wrap justify-center">
            <Button variant="primary" onClick={handleRetry}>
              إعادة المحاولة
            </Button>
            <Button variant="ghost" onClick={() => { setRetryCount(0); clearError(); }}>
              إعادة تعيين
            </Button>
          </div>
        </div>
      );
    }

    if (!dashboardMetrics) {
      return (
        <div
          ref={ref}
          className={clsx(
            'flex flex-col items-center justify-center min-h-[400px] w-full p-8',
            'bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700'
          )}
        >
          <svg className="w-16 h-16 text-gray-400 dark:text-gray-500 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-500 dark:text-gray-400">لا توجد بيانات للتحليلات</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            قد لا توجد بيانات كافية في هذه الفترة الزمنية
          </p>
          <Button variant="primary" size="sm" onClick={handleRefresh} className="mt-4">
            تحديث البيانات
          </Button>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={clsx('flex flex-col gap-6', className)}
        role="main"
        aria-label="صفحة التحليلات"
      >
        {/* رأس الصفحة — نفس المحتوى السابق */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">التحليلات</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{dateRangeLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {(['7d', '30d', '90d'] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => handleTimeRangeChange(range)}
                  className={clsx(
                    'px-3 py-1.5 text-sm transition-colors duration-200',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset',
                    timeRange === range
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  )}
                  aria-label={`عرض بيانات آخر ${range === '7d' ? '7 أيام' : range === '30d' ? '30 يوماً' : '90 يوماً'}`}
                >
                  {range === '7d' ? 'أسبوع' : range === '30d' ? 'شهر' : '3 أشهر'}
                </button>
              ))}
              <button
                onClick={() => handleTimeRangeChange('custom')}
                className={clsx(
                  'px-3 py-1.5 text-sm transition-colors duration-200',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset',
                  timeRange === 'custom'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                )}
                aria-label="نطاق زمني مخصص"
              >
                مخصص
              </button>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              isLoading={isLoading}
              aria-label="تحديث البيانات"
            >
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.418 0V4h-.582m-8.418 5v5m0 0H6m5.582 0h5.418" />
              </svg>
              تحديث
            </Button>
          </div>
        </div>

        {/* باقي المحتوى — كما هو */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <StatCard
            title="المحادثات"
            value={dashboardMetrics.totalConversations}
            change={dashboardMetrics.trends?.conversationsChange}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            }
            color="blue"
            isLoading={isLoading}
          />
          <StatCard
            title="الرسائل"
            value={dashboardMetrics.totalMessages}
            change={dashboardMetrics.trends?.messagesChange}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            }
            color="green"
            isLoading={isLoading}
          />
          <StatCard
            title="المستندات"
            value={dashboardMetrics.totalDocuments}
            change={dashboardMetrics.trends?.documentsChange}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            color="purple"
            isLoading={isLoading}
          />
          <StatCard
            title="طلبات الذكاء الاصطناعي"
            value={dashboardMetrics.aiTotalRequests}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            }
            color="yellow"
            isLoading={isLoading}
          />
        </div>

        {/* باقي الأقسام */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">أداء الذكاء الاصطناعي</h2>
            {aiPerformance ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500 dark:text-gray-400">معدل النجاح</span>
                  <span className="text-lg font-semibold text-green-600 dark:text-green-400">{aiPerformance.successRate}%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500 dark:text-gray-400">متوسط زمن الاستجابة</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{aiPerformance.averageResponseTimeMs} ms</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500 dark:text-gray-400">متوسط الرموز لكل طلب</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{aiPerformance.averageTokensPerRequest}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500 dark:text-gray-400">إجمالي الرموز المستخدمة</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatNumber(aiPerformance.totalTokensUsed)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">لا توجد بيانات</p>
            )}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">حالة المستندات</h2>
            {documentStatusDistribution && documentStatusDistribution.length > 0 ? (
              <div className="space-y-2">
                {documentStatusDistribution.map((item) => (
                  <div key={item.status} className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {item.status === 'COMPLETED' ? 'مكتمل' :
                       item.status === 'PROCESSING' ? 'قيد المعالجة' :
                       item.status === 'FAILED' ? 'فاشل' :
                       item.status === 'PENDING' ? 'قيد الانتظار' :
                       item.status === 'DELETED' ? 'محذوف' : item.status}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">لا توجد بيانات</p>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">توزيع الرسائل</h2>
          {messageRoleDistribution && messageRoleDistribution.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {messageRoleDistribution.map((item) => (
                <div key={item.role} className="text-center p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                  <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">{item.count}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {item.role === 'USER' ? 'مستخدم' :
                     item.role === 'ASSISTANT' ? 'مساعد' :
                     item.role === 'SYSTEM' ? 'نظام' : item.role}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">لا توجد بيانات</p>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">استخدام التخزين</h2>
          {storageUsage !== null ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-gray-500 dark:text-gray-400">المساحة المستخدمة</span>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{formatBytes(storageUsage)}</span>
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((storageUsage / (1024 * 1024 * 1024)) * 100, 100)}%` }}
                    role="progressbar"
                    aria-valuenow={Math.min((storageUsage / (1024 * 1024 * 1024)) * 100, 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {(storageUsage / (1024 * 1024 * 1024)).toFixed(2)} GB من 10 GB (تقديري)
                </p>
              </div>
              <div className="flex-shrink-0">
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatBytes(storageUsage)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">لا توجد بيانات</p>
          )}
        </div></div>
    );
  })
);

AnalyticsPage.displayName = 'AnalyticsPage';

export default AnalyticsPage;
