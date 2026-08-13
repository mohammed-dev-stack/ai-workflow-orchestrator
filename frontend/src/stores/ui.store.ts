// ============================================================
// frontend/src/stores/ui.store.ts
// ============================================================
// مخزن حالة الواجهة (UI Store) — يدير السمات، الإشعارات، والحوارات.
// ✅ تم توحيد نوع الإشعارات مع Toast من Toaster لتجنب تعارض الأنواع.
// ✅ تم الحفاظ على جميع الدوال المساعدة (showSuccess, showError, إلخ).
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ✅ استيراد أنواع Toaster مباشرة لتوحيد المصدر (SSoT)
import type { Toast, ToastVariant } from '../components/atoms/Toaster';

// ✅ إعادة تصدير الأنواع للاستخدام في باقي التطبيق
export type { Toast, ToastVariant };

// ============================================================
// 1. الأنواع الخاصة بالمخزن
// ============================================================

export type Theme = 'light' | 'dark' | 'system';

interface ModalState {
  id: string;
  isOpen: boolean;
  data?: Record<string, any> | null;
}

export interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  theme: Theme;
  globalLoading: boolean;
  modals: ModalState[];
  notifications: Toast[]; // ✅ أصبحت من نوع Toast
  isOffline: boolean;
  lastVisitedPath: string;
}

export interface UIActions {
  toggleSidebar: () => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebarCollapse: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setGlobalLoading: (loading: boolean) => void;
  openModal: (id: string, data?: Record<string, any>) => void;
  closeModal: (id: string) => void;
  closeAllModals: () => void;
  addNotification: (toast: Omit<Toast, 'id' | 'createdAt'>) => string;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  setOffline: (isOffline: boolean) => void;
  setLastVisitedPath: (path: string) => void;
  reset: () => void;
}

export type UIStore = UIState & UIActions;

// ============================================================
// 2. الحالة الافتراضية
// ============================================================

const initialState: UIState = {
  sidebarOpen: false,
  sidebarCollapsed: false,
  theme: 'system',
  globalLoading: false,
  modals: [],
  notifications: [],
  isOffline: false,
  lastVisitedPath: '/',
};

// ============================================================
// 3. دوال مساعدة (داخلية)
// ============================================================

const generateId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// ============================================================
// 4. إنشاء المخزن
// ============================================================

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // ============================================================
      // الشريط الجانبي (Sidebar)
      // ============================================================
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      openSidebar: () => set({ sidebarOpen: true }),
      closeSidebar: () => set({ sidebarOpen: false }),
      toggleSidebarCollapse: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      // ============================================================
      // السمة (Theme)
      // ============================================================
      setTheme: (theme: Theme) => {
        set({ theme });
        const root = document.documentElement;
        const resolvedTheme =
          theme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
            : theme;
        if (resolvedTheme === 'dark') root.classList.add('dark');
        else root.classList.remove('dark');
        try {
          localStorage.setItem('ui-theme-resolved', resolvedTheme);
        } catch {
          // تجاهل أخطاء localStorage في بيئات التصفح الخاصة
        }
      },

      toggleTheme: () => {
        const { theme } = get();
        const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
        get().setTheme(nextTheme);
      },

      // ============================================================
      // التحميل العام
      // ============================================================
      setGlobalLoading: (loading: boolean) => set({ globalLoading: loading }),

      // ============================================================
      // الحوارات (Modals)
      // ============================================================
      openModal: (id: string, data?: Record<string, any>) => {
        set((state) => ({
          modals: [
            ...state.modals.filter((m) => m.id !== id),
            { id, isOpen: true, data: data ?? null },
          ],
        }));
      },

      closeModal: (id: string) => set((state) => ({ modals: state.modals.filter((m) => m.id !== id) })),
      closeAllModals: () => set({ modals: [] }),

      // ============================================================
      // الإشعارات (Notifications) — باستخدام نوع Toast الموحد
      // ============================================================
      addNotification: (toast: Omit<Toast, 'id' | 'createdAt'>): string => {
        const id = generateId();
        const newToast: Toast = {
          ...toast,
          id,
          createdAt: Date.now(),
          duration: toast.duration ?? 3000,
          dismissible: toast.dismissible ?? true,
        };
        set((state) => ({
          notifications: [newToast, ...state.notifications],
        }));
        // الإزالة التلقائية بعد المدة المحددة
        if (newToast.duration && newToast.duration > 0) {
          setTimeout(() => {
            get().removeNotification(id);
          }, newToast.duration);
        }
        return id;
      },

      removeNotification: (id: string) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      clearNotifications: () => set({ notifications: [] }),

      // ============================================================
      // حالة الاتصال والتوجيه
      // ============================================================
      setOffline: (isOffline: boolean) => set({ isOffline }),
      setLastVisitedPath: (path: string) => set({ lastVisitedPath: path }),

      // ============================================================
      // إعادة التعيين
      // ============================================================
      reset: () => {
        set({ ...initialState });
        const root = document.documentElement;
        root.classList.remove('dark');
        try {
          localStorage.removeItem('ui-theme-resolved');
        } catch {
          // تجاهل
        }
      },
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);

// ============================================================
// 5. دوال مساعدة عامة (للاستخدام المباشر خارج React)
// ============================================================

export const showSuccess = (message: string, duration?: number): string =>
  useUIStore.getState().addNotification({
    variant: 'success',
    message,
    duration: duration ?? 3000,
    dismissible: true,
  });

export const showError = (message: string, duration?: number): string =>
  useUIStore.getState().addNotification({
    variant: 'error',
    message,
    duration: duration ?? 3000,
    dismissible: true,
  });

export const showWarning = (message: string, duration?: number): string =>
  useUIStore.getState().addNotification({
    variant: 'warning',
    message,
    duration: duration ?? 3000,
    dismissible: true,
  });

export const showInfo = (message: string, duration?: number): string =>
  useUIStore.getState().addNotification({
    variant: 'info',
    message,
    duration: duration ?? 3000,
    dismissible: true,
  });

// ============================================================
// تصدير المخزن كافتراضي
// ============================================================

export default useUIStore;