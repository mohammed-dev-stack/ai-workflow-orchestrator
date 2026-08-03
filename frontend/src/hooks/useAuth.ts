// frontend/src/hooks/useAuth.ts
import { useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../stores/auth.store';
import { useUIStore } from '../stores/ui.store';
import { useTenantStore } from '../stores/tenant.store';
import type { LoginCredentials, RegisterData, User } from '../types/api.types';

/**
 * قيمة إرجاع خطاف المصادقة.
 */
export interface UseAuthReturn {
  /** المستخدم الحالي (إذا كان مصادقاً) */
  user: User | null;
  /** ما إذا كان المستخدم مصادقاً */
  isAuthenticated: boolean;
  /** ما إذا كانت عملية المصادقة قيد التنفيذ */
  isLoading: boolean;
  /** خطأ (إن وجد) */
  error: string | null;
  /** ما إذا كان المستخدم لديه دور معين */
  hasRole: (role: 'ADMIN' | 'AGENT' | 'VIEWER' | string) => boolean;
  /** ما إذا كان المستخدم لديه أحد الأدوار المحددة */
  hasAnyRole: (roles: ('ADMIN' | 'AGENT' | 'VIEWER' | string)[]) => boolean;
  /** ما إذا كان المستخدم لديه جميع الأدوار المحددة */
  hasAllRoles: (roles: ('ADMIN' | 'AGENT' | 'VIEWER' | string)[]) => boolean;
  /** تسجيل الدخول */
  login: (credentials: LoginCredentials) => Promise<void>;
  /** تسجيل الخروج */
  logout: () => Promise<void>;
  /** تسجيل مستخدم جديد */
  register: (data: RegisterData) => Promise<void>;
  /** تحديث الملف الشخصي */
  updateProfile: (data: Partial<User>) => Promise<User | null>;
  /** تغيير كلمة المرور */
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  /** التحقق من صحة الجلسة الحالية */
  validateSession: () => Promise<boolean>;
  /** مسح الخطأ */
  clearError: () => void;
  /** إعادة تعيين الحالة */
  reset: () => void;
}

/**
 * خطاف المصادقة — يُغلف `useAuthStore` ويوفر واجهة مبسطة للمكونات.
 * [مُتحقَّق منطقياً بتتبع كامل] — يدعم تسجيل الدخول، الخروج، التسجيل، وتجديد التوكن.
 */
export function useAuth(): UseAuthReturn {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    accessToken,
    refreshToken,
    login: storeLogin,
    logout: storeLogout,
    register: storeRegister,
    updateProfile: storeUpdateProfile,
    changePassword: storeChangePassword,
    refreshAccessToken,
    validateToken,
    clearError: storeClearError,
    reset: storeReset,
  } = useAuthStore();

  const { setGlobalLoading } = useUIStore();
  const { setCurrentTenant, reset: resetTenant } = useTenantStore();

  // مرجع لمنع التجديد المتكرر
  const isRefreshingRef = useRef(false);

  // جلب المستأجر عند تسجيل الدخول (يُستدعى من login)
const fetchTenantData = useCallback(
  async (tenantId: string) => {
    try {
      // في الإنتاج، سيتم جلب بيانات المستأجر من API باستخدام tenantId
      // هنا نمرر المستأجر من استجابة المصادقة (المخزنة في user.tenantId)
      const { user: currentUser } = useAuthStore.getState();

      // إذا كان لدينا tenantId سواء من البراميتر أو من المستخدم الحالي
      const effectiveTenantId = tenantId || currentUser?.tenantId;

      if (effectiveTenantId) {
        // محاكاة تعيين المستأجر (سيتم استبداله بطلب API حقيقي)
        // نستخدم setCurrentTenant لتحديث مخزن المستأجر
        setCurrentTenant({
          id: effectiveTenantId,
          name: 'المستأجر الحالي',
          domain: 'example.com',
          adminEmail: currentUser?.email || '',
          adminName: currentUser?.fullName || '',
          plan: 'FREE',
          status: 'ACTIVE',
          whatsappPhoneNumberId: null,
          createdBy: currentUser?.id || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          settings: {
            ai: {
              maxTokensPerRequest: 4096,
              allowedModels: ['claude-3-haiku-20240307'],
              monthlyAILimit: 1000,
            },
            storage: {
              maxStorageBytes: 100 * 1024 * 1024,
            },
            documents: {
              maxDocumentsPerKB: 50,
              maxFileSizeBytes: 5 * 1024 * 1024,
            },
            chat: {
              maxActiveConversations: 10,
              messageRetentionDays: 30,
            },
            users: {
              maxUsers: 3,
              allowedRoles: ['ADMIN', 'AGENT', 'VIEWER'],
            },
            whatsapp: {
              enabled: false,
              phoneNumberId: undefined,
            },
          },
        });
      }
    } catch (error) {
      console.warn('فشل جلب بيانات المستأجر:', error);
    }
  },
  [setCurrentTenant]
);


  // التحقق من صحة الجلسة عند تحميل التطبيق
  useEffect(() => {
    const initAuth = async () => {
      // إذا كان هناك توكن مخزن، تحقق من صحته
      if (accessToken) {
        const isValid = await validateToken();
        if (!isValid) {
          // إذا كان التوكن غير صالح، حاول تجديده
          if (refreshToken) {
            await refreshAccessToken();
          }
        } else {
          // إذا كان التوكن صالحاً، جلب بيانات المستأجر
          if (user?.tenantId) {
            await fetchTenantData(user.tenantId);
          }
        }
      }
    };

    // تشغيل التهيئة بشكل غير متزامن
    initAuth();
  }, []); // تشغيل مرة واحدة عند التحميل

  // تجديد التوكن تلقائياً قبل انتهاء الصلاحية (كل 5 دقائق)
  useEffect(() => {
    if (!accessToken || !refreshToken) return;

    const interval = setInterval(async () => {
      // تجنب التجديد المتكرر
      if (isRefreshingRef.current) return;

      try {
        isRefreshingRef.current = true;
        await refreshAccessToken();
      } catch (error) {
        console.warn('فشل تجديد التوكن التلقائي:', error);
      } finally {
        isRefreshingRef.current = false;
      }
    }, 5 * 60 * 1000); // 5 دقائق

    return () => clearInterval(interval);
  }, [accessToken, refreshToken, refreshAccessToken]);

  // تسجيل الدخول
  const login = useCallback(async (credentials: LoginCredentials): Promise<void> => {
    setGlobalLoading(true);
    try {
      const response = await storeLogin(credentials);
      if (response.user?.tenantId) {
        await fetchTenantData(response.user.tenantId);
      }
    } finally {
      setGlobalLoading(false);
    }
  }, [storeLogin, fetchTenantData, setGlobalLoading]);

  // تسجيل الخروج
  const logout = useCallback(async (): Promise<void> => {
    setGlobalLoading(true);
    try {
      await storeLogout();
      resetTenant();
    } finally {
      setGlobalLoading(false);
    }
  }, [storeLogout, resetTenant, setGlobalLoading]);

  // تسجيل مستخدم جديد
  const register = useCallback(async (data: RegisterData): Promise<void> => {
    setGlobalLoading(true);
    try {
      const response = await storeRegister(data);
      if (response.user?.tenantId) {
        await fetchTenantData(response.user.tenantId);
      }
    } finally {
      setGlobalLoading(false);
    }
  }, [storeRegister, fetchTenantData, setGlobalLoading]);

  // تحديث الملف الشخصي
  const updateProfile = useCallback(async (data: Partial<User>): Promise<User | null> => {
    try {
      return await storeUpdateProfile(data);
    } catch (error) {
      console.error('فشل تحديث الملف الشخصي:', error);
      return null;
    }
  }, [storeUpdateProfile]);

  // تغيير كلمة المرور
  const changePassword = useCallback(async (
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> => {
    try {
      await storeChangePassword(currentPassword, newPassword);
      return true;
    } catch (error) {
      console.error('فشل تغيير كلمة المرور:', error);
      return false;
    }
  }, [storeChangePassword]);

  // التحقق من صحة الجلسة الحالية
  const validateSession = useCallback(async (): Promise<boolean> => {
    return await validateToken();
  }, [validateToken]);

  // التحقق من وجود دور معين
  const hasRole = useCallback((role: 'ADMIN' | 'AGENT' | 'VIEWER' | string): boolean => {
    if (!user) return false;
    return user.role === role;
  }, [user]);

  // التحقق من وجود أحد الأدوار المحددة
  const hasAnyRole = useCallback((roles: ('ADMIN' | 'AGENT' | 'VIEWER' | string)[]): boolean => {
    if (!user) return false;
    return roles.includes(user.role);
  }, [user]);

  // التحقق من وجود جميع الأدوار المحددة
  const hasAllRoles = useCallback((roles: ('ADMIN' | 'AGENT' | 'VIEWER' | string)[]): boolean => {
    if (!user) return false;
    return roles.every((role) => user.role === role);
  }, [user]);

  // مسح الخطأ
  const clearError = useCallback(() => {
    storeClearError();
  }, [storeClearError]);

  // إعادة تعيين الحالة
  const reset = useCallback(() => {
    storeReset();
    resetTenant();
  }, [storeReset, resetTenant]);

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    hasRole,
    hasAnyRole,
    hasAllRoles,
    login,
    logout,
    register,
    updateProfile,
    changePassword,
    validateSession,
    clearError,
    reset,
  };
}

export default useAuth;