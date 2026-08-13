// ============================================================
// frontend/src/components/pages/DashboardPage.tsx
// ============================================================
// صفحة لوحة التحكم مع معالجة محسنة للأخطاء.
// ✅ تم إضافة عرض رسائل خطأ مفهومة وتفاصيل فنية عند الطلب.
// ============================================================

import React, { forwardRef, memo, useEffect, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useAnalytics } from '../../hooks/useAnalytics';
import { Dashboard } from '../organisms/Dashboard';
import { Button } from '../atoms/Button';
import { Spinner } from '../atoms/Spinner';

export interface DashboardPageProps {
  className?: string;
}

export const DashboardPage = memo(
  forwardRef<HTMLDivElement, DashboardPageProps>(({ className }, ref) => {
    const { startDate, endDate } = useMemo(() => {
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      now.setHours(23, 59, 59, 999);
      return { startDate: start, endDate: now };
    }, []);

    const [retryCount, setRetryCount] = useState(0);
    const [showErrorDetails, setShowErrorDetails] = useState(false);
    const MAX_RETRIES = 3;

    const {
      dashboardMetrics,
      isLoading,
      error,
      errorDetails,
      refreshAll,
      clearError,
    } = useAnalytics({
      startDate,
      endDate,
      autoFetch: true,
      retryAttempts: MAX_RETRIES,
    });

    useEffect(() => {
      return () => {
        clearError();
      };
    }, [clearError]);

    const handleRetry = useCallback(() => {
      setRetryCount((prev) => prev + 1);
      refreshAll();
      clearError();
    }, [refreshAll, clearError]);

    const handleReset = useCallback(() => {
      setRetryCount(0);
      clearError();
      refreshAll();
    }, [refreshAll, clearError]);

    if (isLoading && !dashboardMetrics && retryCount < MAX_RETRIES) {
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
            <p className="text-gray-500 dark:text-gray-400">جاري تحميل لوحة التحكم...</p>
            {retryCount > 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                محاولة {retryCount + 1} من {MAX_RETRIES}
              </p>
            )}
          </div>
        </div>
      );
    }

    if ((error && !dashboardMetrics) || retryCount >= MAX_RETRIES) {
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
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>

          <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
            فشل تحميل لوحة التحكم
          </h3>

          <p className="text-sm text-red-600 dark:text-red-300 mb-2 text-center max-w-md">
            {error || 'حدث خطأ غير متوقع أثناء تحميل البيانات.'}
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
            <Button variant="ghost" onClick={handleReset}>
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
          <p className="text-gray-500 dark:text-gray-400">لا توجد بيانات لعرضها</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            قد لا توجد بيانات كافية في هذه الفترة الزمنية
          </p>
          <Button variant="primary" size="sm" onClick={handleRetry} className="mt-4">
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
        aria-label="لوحة التحكم الرئيسية"
      >
        <Dashboard
          stats={dashboardMetrics}
          isLoading={isLoading}
          error={error}
          onRetry={handleRetry}
        /></div>
    );
  })
);

DashboardPage.displayName = 'DashboardPage';

export default DashboardPage;
