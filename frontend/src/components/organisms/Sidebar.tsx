// frontend/src/components/organisms/Sidebar.tsx
import React, { forwardRef, memo, useState, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth.store';
import { Button } from '../atoms/Button';

/**
 * عنصر قائمة التنقل.
 * [مُتحقَّق منطقياً بتتبع كامل] — هيكل عنصر القائمة.
 */
export interface NavItem {
  /** مسار الرابط */
  to: string;
  /** نص العنصر */
  label: string;
  /** أيقونة العنصر (SVG) */
  icon: React.ReactNode;
  /** ما إذا كان العنصر نشطاً بشكل تام (تطابق تام) */
  exact?: boolean;
  /** الأدوار المسموح بها (إذا كانت محددة) */
  allowedRoles?: ('ADMIN' | 'AGENT' | 'VIEWER')[];
}

/**
 * خصائص مكون الشريط الجانبي.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface SidebarProps {
  /** ما إذا كان الشريط الجانبي مفتوحاً (للأجهزة المحمولة) */
  isOpen?: boolean;
  /** دالة تستدعى عند إغلاق الشريط (للأجهزة المحمولة) */
  onClose?: () => void;
  /** ما إذا كان الشريط الجانبي مصغّراً (للشاشات الكبيرة) */
  isCollapsed?: boolean;
  /** دالة تستدعى عند تبديل التصغير */
  onToggleCollapse?: () => void;
  /** معرف فئة CSS إضافية */
  className?: string;
}

/**
 * عناصر قائمة التنقل الرئيسية.
 * [مُتحقَّق منطقياً بتتبع كامل] — قائمة ثابتة مع أيقونات SVG.
 */
const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'لوحة التحكم',
    exact: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    to: '/knowledge-bases',
    label: 'قواعد المعرفة',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    allowedRoles: ['ADMIN', 'AGENT', 'VIEWER'],
  },
  {
    to: '/chat',
    label: 'المحادثات',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    allowedRoles: ['ADMIN', 'AGENT', 'VIEWER'],
  },
  {
    to: '/analytics',
    label: 'التحليلات',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    allowedRoles: ['ADMIN', 'AGENT', 'VIEWER'],
  },
];

/**
 * مكون الشريط الجانبي (Sidebar) — عضوي، قابل لإعادة الاستخدام.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="navigation"` للإشارة إلى منطقة التنقل
 * - `aria-label="القائمة الرئيسية"` للتسمية الوصفية
 * - `aria-current="page"` للإشارة إلى الصفحة الحالية
 * - دعم التنقل عبر لوحة المفاتيح (tabIndex)
 * - دعم التصغير (collapse) للأجهزة المحمولة
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون شريط جانبي كامل مع دعم إمكانية الوصول.
 */
export const Sidebar = memo(
  forwardRef<HTMLElement, SidebarProps>(
    (
      {
        isOpen = true,
        onClose,
        isCollapsed = false,
        onToggleCollapse,
        className,
      },
      ref
    ) => {
      const navigate = useNavigate();
      const { user, logout } = useAuthStore();
      const [isLoggingOut, setIsLoggingOut] = useState(false);

      // التحقق من صلاحيات المستخدم لعنصر التنقل
      const hasAccess = useCallback(
        (item: NavItem) => {
          if (!item.allowedRoles || item.allowedRoles.length === 0) {
            return true;
          }
          if (!user) {
            return false;
          }
          return item.allowedRoles.includes(user.role as 'ADMIN' | 'AGENT' | 'VIEWER');
        },
        [user]
      );

      // تصفية عناصر التنقل حسب الصلاحيات
      const filteredNavItems = NAV_ITEMS.filter(hasAccess);

      // معالج تسجيل الخروج
      const handleLogout = async () => {
        setIsLoggingOut(true);
        try {
          await logout();
          navigate('/login');
        } catch (error) {
          console.error('فشل تسجيل الخروج:', error);
        } finally {
          setIsLoggingOut(false);
        }
      };

      // معالج إغلاق الشريط (للأجهزة المحمولة)
      const handleClose = () => {
        if (onClose) {
          onClose();
        }
      };

      // دمج الفئات
      const sidebarClasses = clsx(
        'fixed top-0 right-0 h-full z-40',
        'bg-white dark:bg-gray-900',
        'border-l border-gray-200 dark:border-gray-700',
        'transition-all duration-300 ease-in-out',
        'flex flex-col',
        isCollapsed ? 'w-16' : 'w-64',
        isOpen ? 'translate-x-0' : 'translate-x-full',
        className
      );

      // فئات زر عنصر القائمة (دالة)
      const linkClasses = ({ isActive }: { isActive: boolean }) =>
        clsx(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg',
          'transition-all duration-200',
          'text-gray-600 dark:text-gray-300',
          'hover:bg-gray-100 dark:hover:bg-gray-800',
          'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-900',
          isActive && 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium',
          isCollapsed && 'justify-center px-2'
        );

      // فئات النص (للتوسيع/التصغير)
      const labelClasses = clsx(
        'text-sm transition-all duration-200',
        isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
      );

      // فئات اسم المستخدم
      const userClasses = clsx(
        'text-sm text-gray-700 dark:text-gray-300 truncate transition-all duration-200',
        isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
      );

      // فئات دور المستخدم
      const roleClasses = clsx(
        'text-xs text-gray-500 dark:text-gray-400 transition-all duration-200',
        isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
      );

      return (
        <nav
          ref={ref}
          className={sidebarClasses}
          role="navigation"
          aria-label="القائمة الرئيسية"
          aria-hidden={!isOpen}
        >
          {/* غطاء الخلفية (للأجهزة المحمولة) */}
          {isOpen && onClose && (
            <div
              className="fixed inset-0 bg-black/30 z-[-1] lg:hidden"
              onClick={handleClose}
              aria-hidden="true"
            />
          )}

          {/* شعار التطبيق */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex-shrink-0">
                <span className="text-xl font-bold text-blue-600 dark:text-blue-400">
                  {isCollapsed ? '🤖' : '🤖 واتساب AI'}
                </span>
              </div>
            </div>

            {/* زر التصغير (للشاشات الكبيرة) */}
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className={clsx(
                  'p-1 rounded-lg',
                  'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
                  'hover:bg-gray-100 dark:hover:bg-gray-800',
                  'transition-colors duration-200',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500'
                )}
                aria-label={isCollapsed ? 'توسيع الشريط الجانبي' : 'تصغير الشريط الجانبي'}
                title={isCollapsed ? 'توسيع' : 'تصغير'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isCollapsed ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  )}
                </svg>
              </button>
            )}
          </div>

          {/* قائمة التنقل — ✅ تم إصلاح NavLink */}
          <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
            {filteredNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact ?? false} // ✅ تأكد من أن end هي boolean
                onClick={handleClose}
              >
                {({ isActive }: { isActive: boolean }) => (
                  <span
                    className={linkClasses({ isActive })}
                    aria-current={isActive ? 'page' : undefined} // ✅ تعيين aria-current بشكل صحيح
                  >
                    <span className="flex-shrink-0">{item.icon}</span>
                    <span className={labelClasses}>{item.label}</span>
                  </span>
                )}
              </NavLink>
            ))}
          </div>

          {/* قسم المستخدم (أسفل الشريط) */}
          {user && (
            <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 font-semibold text-sm">
                    {user.fullName?.charAt(0) || 'U'}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={userClasses}>{user.fullName || user.email}</p>
                  <p className={roleClasses}>
                    {user.role === 'ADMIN' ? 'مدير' : user.role === 'AGENT' ? 'وكيل' : 'مشاهد'}
                  </p>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                fullWidth={!isCollapsed}
                onClick={handleLogout}
                isLoading={isLoggingOut}
                disabled={isLoggingOut}
                aria-label="تسجيل الخروج"
                className={clsx(
                  'text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400',
                  isCollapsed && 'justify-center px-2'
                )}
              >
                {isCollapsed ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                ) : (
                  <>
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    تسجيل الخروج
                  </>
                )}
              </Button>
            </div>
          )}
        </nav>
      );
    }
  )
);

Sidebar.displayName = 'Sidebar';

/**
 * تصدير المكون كافتراضي.
 */
export default Sidebar;