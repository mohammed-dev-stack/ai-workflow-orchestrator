// frontend/src/hooks/useTenant.ts
import { useMemo, useCallback } from 'react';
import { useTenantStore } from '../stores/tenant.store';
import type { TenantSettings } from '../types/api.types';

/**
 * قيمة إرجاع خطاف المستأجر.
 */
export interface UseTenantReturn {
  /** المستأجر الحالي */
  tenant: ReturnType<typeof useTenantStore.getState>['currentTenant'];
  /** إعدادات المستأجر الحالية */
  settings: TenantSettings | null;
  /** ما إذا كان المستأجر نشطاً */
  isActive: boolean;
  /** ما إذا كانت البيانات في حالة تحميل */
  isLoading: boolean;
  /** خطأ (إن وجد) */
  error: string | null;
  /** تعيين المستأجر الحالي */
  setTenant: (tenant: ReturnType<typeof useTenantStore.getState>['currentTenant']) => void;
  /** تحديث إعدادات المستأجر */
  updateSettings: (settings: Partial<TenantSettings>) => void;
  /** التحقق من وجود حد تخزين متاح */
  hasStorageAvailable: (bytesNeeded: number) => boolean;
  /** التحقق من وجود حد مستخدمين متاح */
  hasUsersAvailable: (currentUserCount: number) => boolean;
  /** التحقق من وجود حد طلبات AI متاح */
  hasAILimitAvailable: (currentUsage: number) => boolean;
  /** الحصول على الحد الأقصى لعدد المستندات لكل قاعدة معرفة */
  getMaxDocumentsPerKB: () => number;
  /** الحصول على الحد الأقصى لحجم الملف */
  getMaxFileSizeBytes: () => number;
  /** الحصول على الحد الأقصى للمحادثات النشطة */
  getMaxActiveConversations: () => number;
  /** إعادة تعيين حالة المستأجر */
  reset: () => void;
}

/**
 * القيم الافتراضية للإعدادات (عند عدم توفر مستأجر).
 */
const DEFAULT_SETTINGS: TenantSettings = {
  ai: {
    maxTokensPerRequest: 4096,
    allowedModels: ['claude-3-haiku-20240307'],
    monthlyAILimit: 1000,
  },
  storage: {
    maxStorageBytes: 100 * 1024 * 1024, // 100 MB
  },
  documents: {
    maxDocumentsPerKB: 50,
    maxFileSizeBytes: 5 * 1024 * 1024, // 5 MB
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
};

/**
 * خطاف المستأجر — يُغلف `useTenantStore` ويوفر واجهة مبسطة للمكونات.
 * [مُتحقَّق منطقياً بتتبع كامل] — يوفر الوصول إلى المستأجر وإعداداته مع دوال مساعدة للحدود.
 */
export function useTenant(): UseTenantReturn {
  const {
    currentTenant,
    settings,
    isActive,
    isLoading,
    error,
    setCurrentTenant,
    updateSettings: storeUpdateSettings,
    setLoading,
    setError,
    reset: storeReset,
    hasStorageAvailable: storeHasStorageAvailable,
    hasUsersAvailable: storeHasUsersAvailable,
    hasAILimitAvailable: storeHasAILimitAvailable,
    getMaxDocumentsPerKB: storeGetMaxDocumentsPerKB,
    getMaxFileSizeBytes: storeGetMaxFileSizeBytes,
    getMaxActiveConversations: storeGetMaxActiveConversations,
  } = useTenantStore();

  // دمج الإعدادات مع القيم الافتراضية (لتجنب القيم الخالية)
  const mergedSettings = useMemo(() => {
    return settings || DEFAULT_SETTINGS;
  }, [settings]);

  // تعيين المستأجر الحالي (تغليف بسيط)
  const setTenant = useCallback((tenant: typeof currentTenant) => {
    setCurrentTenant(tenant);
  }, [setCurrentTenant]);

  // تحديث إعدادات المستأجر
  const updateSettings = useCallback((newSettings: Partial<TenantSettings>) => {
    storeUpdateSettings(newSettings);
  }, [storeUpdateSettings]);

  // دوال مساعدة للحدود (تغليف بسيط مع استخدام الإعدادات المدمجة)
  const hasStorageAvailable = useCallback((bytesNeeded: number): boolean => {
    return storeHasStorageAvailable(bytesNeeded);
  }, [storeHasStorageAvailable]);

  const hasUsersAvailable = useCallback((currentUserCount: number): boolean => {
    return storeHasUsersAvailable(currentUserCount);
  }, [storeHasUsersAvailable]);

  const hasAILimitAvailable = useCallback((currentUsage: number): boolean => {
    return storeHasAILimitAvailable(currentUsage);
  }, [storeHasAILimitAvailable]);

  const getMaxDocumentsPerKB = useCallback((): number => {
    return storeGetMaxDocumentsPerKB();
  }, [storeGetMaxDocumentsPerKB]);

  const getMaxFileSizeBytes = useCallback((): number => {
    return storeGetMaxFileSizeBytes();
  }, [storeGetMaxFileSizeBytes]);

  const getMaxActiveConversations = useCallback((): number => {
    return storeGetMaxActiveConversations();
  }, [storeGetMaxActiveConversations]);

  // إعادة تعيين الحالة
  const reset = useCallback(() => {
    storeReset();
  }, [storeReset]);

  return {
    tenant: currentTenant,
    settings: mergedSettings,
    isActive,
    isLoading,
    error,
    setTenant,
    updateSettings,
    hasStorageAvailable,
    hasUsersAvailable,
    hasAILimitAvailable,
    getMaxDocumentsPerKB,
    getMaxFileSizeBytes,
    getMaxActiveConversations,
    reset,
  };
}

export default useTenant;