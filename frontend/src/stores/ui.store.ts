// frontend/src/stores/ui.store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';

interface ModalState {
  id: string;
  isOpen: boolean;
  data?: Record<string, any> | null | undefined; // ✅ يسمح بالقيم الفارغة
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number | undefined; // ✅ يسمح بالقيم الفارغة
  dismissible?: boolean | undefined;
  createdAt: number;
}

export interface UIState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  theme: Theme;
  globalLoading: boolean;
  modals: ModalState[];
  notifications: Notification[];
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
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt'>) => string;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  setOffline: (isOffline: boolean) => void;
  setLastVisitedPath: (path: string) => void;
  reset: () => void;
}

export type UIStore = UIState & UIActions;

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

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      openSidebar: () => set({ sidebarOpen: true }),
      closeSidebar: () => set({ sidebarOpen: false }),
      toggleSidebarCollapse: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

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
        } catch {}
      },

      toggleTheme: () => {
        const { theme } = get();
        const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
        get().setTheme(nextTheme);
      },

      setGlobalLoading: (loading: boolean) => set({ globalLoading: loading }),

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

      addNotification: (notification: Omit<Notification, 'id' | 'createdAt'>): string => {
        const id = generateId();
        const newNotification: Notification = {
          ...notification,
          id,
          createdAt: Date.now(),
          duration: notification.duration ?? 3000,
          dismissible: notification.dismissible ?? true,
        };
        set((state) => ({ notifications: [newNotification, ...state.notifications] }));
        if (newNotification.duration && newNotification.duration > 0) {
          setTimeout(() => get().removeNotification(id), newNotification.duration);
        }
        return id;
      },

      removeNotification: (id: string) =>
        set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),
      clearNotifications: () => set({ notifications: [] }),

      setOffline: (isOffline: boolean) => set({ isOffline }),
      setLastVisitedPath: (path: string) => set({ lastVisitedPath: path }),

      reset: () => {
        set({ ...initialState });
        const root = document.documentElement;
        root.classList.remove('dark');
        try {
          localStorage.removeItem('ui-theme-resolved');
        } catch {}
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

export const showSuccess = (message: string, duration?: number) =>
  useUIStore.getState().addNotification({ type: 'success', message, duration: duration ?? 3000 });

export const showError = (message: string, duration?: number) =>
  useUIStore.getState().addNotification({ type: 'error', message, duration: duration ?? 3000 });

export const showWarning = (message: string, duration?: number) =>
  useUIStore.getState().addNotification({ type: 'warning', message, duration: duration ?? 3000 });

export const showInfo = (message: string, duration?: number) =>
  useUIStore.getState().addNotification({ type: 'info', message, duration: duration ?? 3000 });

export default useUIStore;
