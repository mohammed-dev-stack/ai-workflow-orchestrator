// ============================================================
// frontend/src/stores/auth.store.ts
// ============================================================
// مخزن المصادقة (Zustand) مع دعم persist.
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi } from '../services/auth.api';
import type { User, LoginCredentials, RegisterData, AuthResponse, UpdateProfileData } from '../types/api.types';

// ============================================================
// 1. تعريف الأنواع
// ============================================================

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
}

export interface AuthActions {
  login: (credentials: LoginCredentials) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  register: (data: RegisterData) => Promise<AuthResponse>;
  updateProfile: (data: Partial<User>) => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refreshAccessToken: () => Promise<AuthResponse | null>;
  validateToken: () => Promise<boolean>;
  setState: (state: Partial<AuthState>) => void;
  clearError: () => void;
  reset: () => void;
}

export type AuthStore = AuthState & AuthActions;

// ============================================================
// 2. الحالة الافتراضية
// ============================================================

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  accessToken: null,
  refreshToken: null,
  expiresIn: null,
};

// ============================================================
// 3. إنشاء المخزن
// ============================================================

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // ============================================================
      // تسجيل الدخول
      // ============================================================
      login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
  set({ isLoading: true, error: null });
  try {
    const response = await authApi.login(credentials); // ← يحصل على AuthResponse المهيكل
    set({
      user: response.user,
      isAuthenticated: true,
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresIn: response.expiresIn,
      isLoading: false,
      error: null,
    });
    return response;
  } catch (error) {
    // معالجة الخطأ
  }
},

      // ============================================================
      // تسجيل الخروج
      // ============================================================
      logout: async (): Promise<void> => {
        set({ isLoading: true });
        try {
          const { refreshToken } = get();
          if (refreshToken) {
            await authApi.logout(refreshToken);
          }
        } catch {
          // تجاهل أخطاء تسجيل الخروج
        } finally {
          set({ ...initialState, isLoading: false });
          // ✅ مسح التخزين المؤقت بالكامل
          useAuthStore.persist.clearStorage();
        }
      },

      // ============================================================
      // تسجيل مستخدم جديد
      // ============================================================
      register: async (data: RegisterData): Promise<AuthResponse> => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.register(data);
          set({
            user: response.user,
            isAuthenticated: true,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresIn: response.expiresIn,
            isLoading: false,
            error: null,
          });
          return response;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'فشل التسجيل';
          set({ error: msg, isLoading: false });
          throw error;
        }
      },

      // ============================================================
      // تحديث الملف الشخصي
      // ============================================================
      updateProfile: async (data: Partial<User>): Promise<User> => {
        const { user } = get();
        if (!user) throw new Error('يجب تسجيل الدخول أولاً');
        set({ isLoading: true, error: null });

        try {
          const cleanedData: Partial<UpdateProfileData> = {};
          if (data.fullName !== undefined) cleanedData.fullName = data.fullName;
          if (data.email !== undefined) cleanedData.email = data.email;
          if (data.phoneNumber !== undefined) {
            cleanedData.phoneNumber = data.phoneNumber === null ? undefined : data.phoneNumber;
          }
          const updated = await authApi.updateProfile(user.id, cleanedData);
          set({ user: updated, isLoading: false });
          return updated;
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'فشل تحديث الملف الشخصي';
          set({ error: msg, isLoading: false });
          throw error;
        }
      },

      // ============================================================
      // تغيير كلمة المرور
      // ============================================================
      changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
        const { user } = get();
        if (!user) throw new Error('يجب تسجيل الدخول أولاً');
        set({ isLoading: true, error: null });

        try {
          await authApi.changePassword(user.id, currentPassword, newPassword);
          set({ isLoading: false });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'فشل تغيير كلمة المرور';
          set({ error: msg, isLoading: false });
          throw error;
        }
      },

      // ============================================================
      // تجديد توكن الوصول
      // ============================================================
      refreshAccessToken: async (): Promise<AuthResponse | null> => {
        const { refreshToken } = get();
        if (!refreshToken) {
          set({ isAuthenticated: false });
          return null;
        }

        set({ isLoading: true });
        try {
          const response = await authApi.refreshToken(refreshToken);
          set({
            user: response.user,
            isAuthenticated: true,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresIn: response.expiresIn,
            isLoading: false,
            error: null,
          });
          return response;
        } catch (error) {
          set({ ...initialState, isLoading: false });
          useAuthStore.persist.clearStorage();
          return null;
        }
      },

      // ============================================================
      // التحقق من صحة التوكن
      // ============================================================
      validateToken: async (): Promise<boolean> => {
        const { accessToken, refreshAccessToken } = get();
        if (!accessToken) return false;

        try {
          const isValid = await authApi.validateToken(accessToken);
          if (!isValid) {
            const refreshed = await refreshAccessToken();
            return !!refreshed;
          }
          return true;
        } catch {
          return false;
        }
      },

      // ============================================================
      // مسح الخطأ
      // ============================================================
      clearError: () => set({ error: null }),

      // ============================================================
      // تعيين حالة جزئية
      // ============================================================
      setState: (newState: Partial<AuthState>) => set(newState),

      // ============================================================
      // إعادة تعيين الحالة (تسجيل الخروج القسري)
      // ============================================================
      reset: () => {
        set({ ...initialState });
        useAuthStore.persist.clearStorage();
      },
    }),
    {
      name: 'auth-storage',
      // ✅ نحدد الحقول التي سيتم تخزينها في localStorage
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        expiresIn: state.expiresIn,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);