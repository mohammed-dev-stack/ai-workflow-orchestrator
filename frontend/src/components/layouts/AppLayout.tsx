// ============================================================
// frontend/src/components/layouts/AppLayout.tsx
// ============================================================
// التخطيط الرئيسي للتطبيق — يحتوي على Header، Sidebar، والمحتوى الرئيسي.
// تم تصميمه وفق أفضل ممارسات React، مع دعم RTL، الوضع الليلي، والاستجابة للأجهزة المختلفة.
// ============================================================

// ✅ استيراد React والمكونات الأساسية
import React, {
  useState,
  useCallback,
  useEffect,
  memo,
  useMemo,
} from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth.store';
import { Button } from '../atoms/Button';
import { Toaster } from '../atoms/Toaster';

// ============================================================
// 1. أنواع البيانات (Types)
// ============================================================

/**
 * عنصر التنقل في القائمة الجانبية.
 */
interface NavItem {
  /** معرف فريد للعنصر */
  id: string;
  /** النص المعروض */
  label: string;
  /** أيقونة العنصر (Emoji أو SVG) */
  icon: string;
  /** المسار (Route) */
  path: string;
  /** ما إذا كان العنصر نشطاً (يُحدد تلقائياً) */
  isActive?: boolean;
}

/**
 * خصائص مكون AppLayout.
 */
export interface AppLayoutProps {
  /** معرف فئة CSS إضافية */
  className?: string;
}

// ============================================================
// 2. بيانات التنقل الثابتة
// ============================================================

/**
 * قائمة عناصر التنقل الرئيسية.
 * [مُتحقَّق منطقياً بتتبع كامل] — مصدر واحد للحقيقة (SSoT) للقائمة الجانبية.
 */
const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: '📊', path: '/' },
  { id: 'knowledge-bases', label: 'قواعد المعرفة', icon: '📚', path: '/knowledge-bases' },
  { id: 'chat', label: 'المحادثات', icon: '💬', path: '/chat' },
  { id: 'analytics', label: 'التحليلات', icon: '📈', path: '/analytics' },
];

// ============================================================
// 3. مكون القائمة الجانبية (Sidebar)
// ============================================================

interface SidebarProps {
  /** ما إذا كانت القائمة مفتوحة (في الأجهزة الصغيرة) */
  isOpen: boolean;
  /** دالة لإغلاق القائمة */
  onClose: () => void;
  /** المسار الحالي (لتحديد العنصر النشط) */
  currentPath: string;
}

/**
 * مكون القائمة الجانبية.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="navigation"` للإشارة إلى منطقة التنقل
 * - `aria-label` للتسمية الوصفية
 * - دعم التنقل عبر لوحة المفاتيح
 */
const Sidebar = memo(({ isOpen, onClose, currentPath }: SidebarProps) => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  // معالج تسجيل الخروج
  const handleLogout = useCallback(async () => {
    await logout();
    navigate('/login');
  }, [logout, navigate]);

  // إغلاق القائمة عند تغيير المسار (في الأجهزة الصغيرة)
  useEffect(() => {
    if (window.innerWidth < 1024) {
      onClose();
    }
  }, [currentPath, onClose]);

  return (
    <>
      {/* الخلفية الشفافة (للأجهزة الصغيرة) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* القائمة الجانبية */}
      <aside
        className={clsx(
          'fixed top-0 right-0 h-full w-72 bg-white dark:bg-gray-900',
          'border-l border-gray-200 dark:border-gray-800 shadow-2xl',
          'z-50 transition-transform duration-300 ease-in-out',
          'lg:translate-x-0 lg:static lg:shadow-none lg:border-l-0',
          isOpen ? 'translate-x-0' : 'translate-x-full',
          'flex flex-col'
        )}
        role="navigation"
        aria-label="القائمة الجانبية الرئيسية"
      >
        {/* الشعار */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <span className="text-3xl">🤖</span>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
              واتساب AI
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-tight">
              منصة مساعد المعرفة
            </p>
          </div>
        </div>

        {/* روابط التنقل */}
        <nav className="flex-1 px-4 py-6 overflow-y-auto" aria-label="روابط التنقل">
          <ul className="space-y-1.5">
            {NAV_ITEMS.map((item) => {
              const isActive = currentPath === item.path ||
                (item.path !== '/' && currentPath.startsWith(item.path));

              return (
                <li key={item.id}>
                  <Link
                    to={item.path}
                    className={clsx(
                      'flex items-center gap-3 px-4 py-2.5 rounded-xl',
                      'transition-all duration-200 ease-in-out',
                      'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900',
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium shadow-sm'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="text-xl leading-none shrink-0" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="text-sm">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* معلومات المستخدم */}
        <div className="border-t border-gray-200 dark:border-gray-800 p-4 shrink-0">
          <div className="flex items-center gap-3 mb-3">
            {/* الصورة الرمزية */}
            <div
              className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-semibold text-sm shadow-md shrink-0"
              aria-hidden="true"
            >
              {user?.fullName?.[0] || user?.email?.[0] || 'U'}
            </div>

            {/* معلومات المستخدم */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {user?.fullName || 'مستخدم'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {user?.email || ''}
              </p>
            </div>
          </div>

          {/* زر تسجيل الخروج */}
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300 justify-center"
            onClick={handleLogout}
            aria-label="تسجيل الخروج من الحساب"
          >
            <svg
              className="w-4 h-4 ml-2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
            تسجيل الخروج
          </Button>
        </div>
      </aside>
    </>
  );
});

Sidebar.displayName = 'Sidebar';

// ============================================================
// 4. مكون الرأس (Header)
// ============================================================

interface HeaderProps {
  /** دالة لفتح/إغلاق القائمة الجانبية */
  onToggleSidebar: () => void;
  /** ما إذا كانت القائمة الجانبية مفتوحة */
  isSidebarOpen: boolean;
  /** المسار الحالي */
  currentPath: string;
}

/**
 * مكون الرأس العلوي.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="banner"` للإشارة إلى منطقة الرأس
 * - `aria-label` للتسمية الوصفية
 */
const Header = memo(({ onToggleSidebar, isSidebarOpen, currentPath }: HeaderProps) => {
  // الحصول على اسم الصفحة الحالية (يُحسب عبر useMemo لتجنب إعادة الحساب غير الضرورية)
  const currentPage = useMemo(() => {
    return NAV_ITEMS.find((item) =>
      item.path === currentPath || (item.path !== '/' && currentPath.startsWith(item.path))
    )?.label || 'لوحة التحكم';
  }, [currentPath]);

  // تاريخ اليوم (يُحسب مرة واحدة)
  const todayDate = useMemo(() => {
    return new Date().toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, []);

  // الوقت الحالي (يُحدث كل دقيقة)
  const [currentTime, setCurrentTime] = useState(() => {
    return new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
  });

  // تحديث الوقت كل دقيقة
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
      );
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header
      className="sticky top-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 px-4 py-3 shrink-0"
      role="banner"
      aria-label="الرأس العلوي"
    >
      <div className="flex items-center justify-between">
        {/* الجانب الأيمن: زر القائمة + العنوان */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className={clsx(
              'p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900',
              'lg:hidden'
            )}
            aria-label={isSidebarOpen ? 'إغلاق القائمة الجانبية' : 'فتح القائمة الجانبية'}
            aria-expanded={isSidebarOpen}
            aria-controls="sidebar"
          >
            <svg
              className="w-6 h-6 text-gray-600 dark:text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              {isSidebarOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {currentPage}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
              {todayDate}
            </p>
          </div>
        </div>

        {/* الجانب الأيسر: الوقت */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-gray-500 hidden md:block font-mono">
            {currentTime}
          </span>
        </div>
      </div>
    </header>
  );
});

Header.displayName = 'Header';

// ============================================================
// 5. المكون الرئيسي للتخطيط (AppLayout)
// ============================================================

/**
 * مكون التخطيط الرئيسي للتطبيق.
 * يحتوي على القائمة الجانبية، الرأس العلوي، والمحتوى الديناميكي.
 * يدعم RTL، الوضع الليلي، والاستجابة للأجهزة المختلفة.
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — تصميم متكامل مع فصل المسؤوليات.
 */
export const AppLayout = memo(({ className }: AppLayoutProps) => {
  const location = useLocation();
  const currentPath = location.pathname;

  // حالة القائمة الجانبية (للأجهزة الصغيرة)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // إغلاق القائمة عند تغيير حجم النافذة إلى الشاشة الكبيرة
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // تبديل حالة القائمة الجانبية
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  // إغلاق القائمة
  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  return (
    <div
      className={clsx(
        'min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col lg:flex-row',
        'transition-colors duration-200',
        className
      )}
      dir="rtl"
    >
      {/* القائمة الجانبية */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={closeSidebar}
        currentPath={currentPath}
      />

      {/* المحتوى الرئيسي */}
      <div className="flex-1 flex flex-col min-h-screen lg:min-h-0">
        {/* الرأس العلوي */}
        <Header
          onToggleSidebar={toggleSidebar}
          isSidebarOpen={isSidebarOpen}
          currentPath={currentPath}
        />

        {/* المحتوى الديناميكي (الصفحات الفرعية) */}
        <main
          className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto"
          role="main"
          aria-label="المحتوى الرئيسي"
          id="main-content"
        >
          <Outlet />
        </main>

        {/* تذييل بسيط (اختياري) */}
        <footer className="text-center text-xs text-gray-400 dark:text-gray-600 py-4 border-t border-gray-200 dark:border-gray-800 shrink-0">
          © {new Date().getFullYear()} واتساب AI — منصة مساعد المعرفة
        </footer>
      </div>

      {/* نظام الإشعارات */}
      <Toaster position="top-left" />
    </div>
  );
});

AppLayout.displayName = 'AppLayout';

export default AppLayout;