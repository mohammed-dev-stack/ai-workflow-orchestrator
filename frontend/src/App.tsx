// ============================================================
// frontend/src/App.tsx
// ============================================================
// المكوّن الرئيسي للتطبيق — يحدد المسارات، المصادقة، والتخزين المؤقت.
// ✅ تم إضافة مسار ديناميكي للمحادثات: /chat/:conversationId
// ✅ تم إضافة مسار عرض المستندات.
// ============================================================

import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useAuthStore } from './stores/auth.store';
import { ErrorBoundary } from './components/atoms/ErrorBoundary';
import { LoadingSpinner } from './components/atoms/Spinner';
import { Toaster } from './components/atoms/Toaster';
import { SkipLink } from './components/atoms/SkipLink';
import { AppLayout } from './components/layouts/AppLayout';

// ============================================================
// 1. التحميل البطيء (Lazy Loading) للصفحات
// ============================================================

const LoginPage = lazy(() => import('./components/pages/LoginPage'));
const KnowledgeBasePage = lazy(() => import('./components/pages/KnowledgeBasePage'));
const DocumentsPage = lazy(() => import('./components/pages/DocumentsPage'));
const ChatPage = lazy(() => import('./components/pages/ChatPage'));
const AnalyticsPage = lazy(() => import('./components/pages/AnalyticsPage'));
const DashboardPage = lazy(() => import('./components/pages/DashboardPage'));

// ============================================================
// 2. تهيئة TanStack Query
// ============================================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * Math.pow(2, attemptIndex), 30000),
      refetchOnWindowFocus: false,
      refetchOnMount: true,
    },
    mutations: {
      retry: 1,
    },
  },
});

// ============================================================
// 3. مكون التوجيه المحمي (Protected Route)
// ============================================================

interface ProtectedRouteProps {
  children: React.ReactNode;
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return <LoadingSpinner size="lg" label="جاري التحقق من المصادقة..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

// ============================================================
// 4. مكون تعريف المسارات (AppRoutes)
// ============================================================

function AppRoutes() {
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('📦 تم تهيئة مسارات التطبيق');
    }
  }, []);

  return (
    <Routes>
      {/* صفحة تسجيل الدخول (عامة) */}
      <Route
        path="/login"
        element={
          <Suspense fallback={<LoadingSpinner size="md" label="جاري تحميل صفحة تسجيل الدخول..." />}>
            <LoginPage />
          </Suspense>
        }
      />

      {/* المسارات المحمية */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={
            <Suspense fallback={<LoadingSpinner size="md" label="جاري تحميل لوحة التحكم..." />}>
              <DashboardPage />
            </Suspense>
          }
        />

        {/* قواعد المعرفة */}
        <Route
          path="knowledge-bases"
          element={
            <Suspense fallback={<LoadingSpinner size="md" label="جاري تحميل قواعد المعرفة..." />}>
              <KnowledgeBasePage />
            </Suspense>
          }
        />

        {/* ✅ مسار عرض المستندات */}
        <Route
          path="knowledge-bases/:id/documents"
          element={
            <Suspense fallback={<LoadingSpinner size="md" label="جاري تحميل المستندات..." />}>
              <DocumentsPage />
            </Suspense>
          }
        />

        {/* ✅ مسار المحادثات – مع دعم المعرف (conversationId) */}
        <Route
          path="chat"
          element={
            <Suspense fallback={<LoadingSpinner size="md" label="جاري تحميل المحادثة..." />}>
              <ChatPage />
            </Suspense>
          }
        />
        {/* ✅ مسار ديناميكي للمحادثة المحددة */}
        <Route
          path="chat/:conversationId"
          element={
            <Suspense fallback={<LoadingSpinner size="md" label="جاري تحميل المحادثة..." />}>
              <ChatPage />
            </Suspense>
          }
        />

        {/* التحليلات */}
        <Route
          path="analytics"
          element={
            <Suspense fallback={<LoadingSpinner size="md" label="جاري تحميل التحليلات..." />}>
              <AnalyticsPage />
            </Suspense>
          }
        />

        {/* أي مسار غير معروف → إعادة توجيه إلى الصفحة الرئيسية */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

// ============================================================
// 5. المكوّن الرئيسي للتطبيق (App)
// ============================================================

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SkipLink targetId="main-content" label="تخطي إلى المحتوى الرئيسي" />

          <Suspense fallback={<LoadingSpinner size="lg" label="جاري تحميل التطبيق..." />}>
            <AppRoutes />
          </Suspense>

          {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}

          <Toaster position="top-left" />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}