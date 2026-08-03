// ============================================================
// frontend/src/services/auth.api.ts
// ============================================================
// طبقة API للمصادقة – خالصة، لا تتعامل مع Zustand.
// جميع الدوال تستخرج البيانات من response.data.data || response.data
// وتعيد كائنات مهيكلة بشكل موحد.
// ============================================================

import { apiClient } from './api.client';
import type {
  LoginCredentials,
  RegisterData,
  AuthResponse,
  User,
  ChangePasswordData,
  UpdateProfileData,
} from '../types/api.types';

/**
 * نقطة النهاية الأساسية لوحدة المصادقة.
 */
const AUTH_BASE = '/api/auth';

/**
 * خدمة API للمصادقة.
 * جميع الدوال تعيد بيانات مهيكلة دون التلاعب بأي حالة محلية.
 * الفصل المعماري: طبقة API خالصة ← طبقة الحالة (Zustand) هي المسؤولة عن setState.
 */
export const authApi = {
  /**
   * تسجيل الدخول.
   * تعيد كائن AuthResponse مستخرجاً من الاستجابة.
   */
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await apiClient.post<{ data: AuthResponse }>(
      `${AUTH_BASE}/login`,
      credentials
    );
    // استخراج البيانات من الغلاف أو مباشرة
    const payload = response.data.data || response.data;
    return {
      accessToken: payload.accessToken ?? null,
      refreshToken: payload.refreshToken ?? null,
      user: payload.user ?? null,
      expiresIn: payload.expiresIn ?? null,
    };
  },

  /**
   * تسجيل مستخدم جديد.
   */
  register: async (data: RegisterData): Promise<AuthResponse> => {
    const response = await apiClient.post<{ data: AuthResponse }>(
      `${AUTH_BASE}/register`,
      data
    );
    const payload = response.data.data || response.data;
    return {
      accessToken: payload.accessToken ?? null,
      refreshToken: payload.refreshToken ?? null,
      user: payload.user ?? null,
      expiresIn: payload.expiresIn ?? null,
    };
  },

  /**
   * تسجيل الخروج.
   */
  logout: async (refreshToken: string): Promise<void> => {
    await apiClient.post(`${AUTH_BASE}/logout`, { refreshToken });
  },

  /**
   * تحديث توكن الوصول باستخدام Refresh Token.
   */
  refreshToken: async (refreshToken: string): Promise<AuthResponse> => {
    const response = await apiClient.post<{ data: AuthResponse }>(
      `${AUTH_BASE}/refresh`,
      { refreshToken }
    );
    const payload = response.data.data || response.data;
    return {
      accessToken: payload.accessToken ?? null,
      refreshToken: payload.refreshToken ?? null,
      user: payload.user ?? null,
      expiresIn: payload.expiresIn ?? null,
    };
  },

  /**
   * تحديث الملف الشخصي.
   */
  updateProfile: async (
    userId: string,
    data: UpdateProfileData
  ): Promise<User> => {
    const response = await apiClient.put<{ data: User }>(
      `${AUTH_BASE}/profile`,
      { ...data, userId }
    );
    const user = response.data.data || response.data;
    return user as User;
  },

  /**
   * تغيير كلمة المرور.
   */
  changePassword: async (
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> => {
    const data: ChangePasswordData = {
      userId,
      currentPassword,
      newPassword,
    };
    await apiClient.post(`${AUTH_BASE}/change-password`, data);
  },

  /**
   * التحقق من صحة توكن الوصول.
   */
  validateToken: async (token: string): Promise<boolean> => {
    try {
      const response = await apiClient.post<{ success: boolean }>(
        `${AUTH_BASE}/validate`,
        {},
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return response.data.success ?? false;
    } catch {
      return false;
    }
  },

  /**
   * الحصول على معلومات المستخدم الحالي.
   */
  getCurrentUser: async (): Promise<User | null> => {
    try {
      const response = await apiClient.get<{ data: User }>(
        `${AUTH_BASE}/me`
      );
      const user = response.data.data || response.data;
      return user as User | null;
    } catch {
      return null;
    }
  },

  /**
   * تسجيل الخروج من جميع الأجهزة.
   */
  logoutAll: async (): Promise<void> => {
    await apiClient.post(`${AUTH_BASE}/logout-all`);
  },
};

export default authApi;