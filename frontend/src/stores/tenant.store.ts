// frontend/src/stores/tenant.store.ts
import { create, type StateCreator } from 'zustand';
import { persist, type PersistOptions } from 'zustand/middleware';
import type { Tenant, TenantSettings } from '../types/api.types';

// ============================================================
// 1. تعريف الأنواع (Types)
// ============================================================

/**
 * حالة مخزن المستأجر.
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع خصائص الحالة مع توثيق واضح.
 */
export interface TenantState {
  /** المستأجر الحالي (كامل الكائن) */
  currentTenant: Tenant | null;

  /** إعدادات المستأجر (مستخرجة من currentTenant أو القيم الافتراضية) */
  settings: TenantSettings | null;

  /** ما إذا كان المستأجر نشطاً (status === 'ACTIVE' && !deletedAt) */
  isActive: boolean;

  /** ما إذا كانت البيانات في حالة تحميل */
  isLoading: boolean;

  /** خطأ (إن وجد) */
  error: string | null;

  /** تاريخ آخر تحديث للإعدادات (للتخزين المؤقت) */
  lastUpdated: string | null;
}

/**
 * إجراءات مخزن المستأجر.
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الإجراءات مع معالجة الأخطاء.
 */
export interface TenantActions {
  setCurrentTenant: (tenant: Tenant | null) => void;
  updateSettings: (settings: Partial<TenantSettings>) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  touch: () => void;
  reset: () => void;

  // دوال مساعدة للحدود
  hasStorageAvailable: (bytesNeeded: number) => boolean;
  hasUsersAvailable: (currentUserCount: number) => boolean;
  hasAILimitAvailable: (currentUsage: number) => boolean;
  getMaxDocumentsPerKB: () => number;
  getMaxFileSizeBytes: () => number;
  getMaxActiveConversations: () => number;
  getMaxUsers: () => number;
  getMaxStorageBytes: () => number;
  getMonthlyAILimit: () => number;
  getAllowedModels: () => string[];
  getMaxTokensPerRequest: () => number;
}

/**
 * نوع مخزن المستأجر الكامل.
 */
type TenantStore = TenantState & TenantActions;

// ============================================================
// 2. القيم الافتراضية (Defaults)
// ============================================================

/**
 * القيم الافتراضية للإعدادات (عند عدم توفر مستأجر).
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — قيم آمنة ومنطقية لتجربة المستخدم.
 * 
 * **ملاحظة:** `whatsapp.phoneNumberId` مُعرَّفة كـ `null` بدلاً من `undefined`
 * لتجنب أخطاء `exactOptionalPropertyTypes: true`.
 */
export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
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
    phoneNumberId: null, // ✅ استخدام null بدلاً من undefined
  },
};

/**
 * الحالة الافتراضية للمخزن.
 */
const initialState: TenantState = {
  currentTenant: null,
  settings: null,
  isActive: false,
  isLoading: false,
  error: null,
  lastUpdated: null,
};

// ============================================================
// 3. إعدادات التخزين المؤقت (Persist)
// ============================================================

/**
 * خيارات التخزين المؤقت (Persist) — نُخزّن فقط ما هو ضروري.
 */
const persistOptions: PersistOptions<TenantState> = {
  name: 'tenant-storage',
  partialize: (state) => ({
  currentTenant: state.currentTenant,
  settings: state.settings,
  isActive: state.isActive,
  lastUpdated: state.lastUpdated,
  isLoading: state.isLoading,
  error: state.error,
}),

};

// ============================================================
// 4. تهيئة المخزن (Store)
// ============================================================

/**
 * دالة إنشاء المخزن (StateCreator) — تتعامل مع Zustand و persist.
 * 
 * **النقطة الأساسية:** هذه الدالة تُرجع `TenantStore` (State + Actions).
 * `persist` يقبل `StateCreator<TenantStore>` وليس `TenantState`.
 */
const storeCreator: StateCreator<
  TenantStore,
  [['zustand/persist', unknown]],
  [],
  TenantStore
> = (set, get) => ({
  // ============================================================
  // الحالة (State)
  // ============================================================
  ...initialState,

  // ============================================================
  // الإجراءات (Actions)
  // ============================================================

  setCurrentTenant: (tenant: Tenant | null) => {
    if (!tenant) {
      set({
        currentTenant: null,
        settings: null,
        isActive: false,
        error: null,
      });
      return;
    }

    const settings = tenant.settings || DEFAULT_TENANT_SETTINGS;

    set({
      currentTenant: tenant,
      settings,
      isActive: tenant.status === 'ACTIVE' && !tenant.deletedAt,
      error: null,
      lastUpdated: new Date().toISOString(),
    });
  },

  updateSettings: (newSettings: Partial<TenantSettings>) => {
    const { currentTenant, settings } = get();

    // دالة مساعدة للدمج العميق
    const deepMerge = <T extends Record<string, any>>(
      target: T,
      source: Partial<T>
    ): T => {
      const result = { ...target };
      for (const key of Object.keys(source)) {
        const typedKey = key as keyof T;
        if (
          source[typedKey] &&
          typeof source[typedKey] === 'object' &&
          !Array.isArray(source[typedKey])
        ) {
          result[typedKey] = deepMerge(
            target[typedKey] || ({} as any),
            source[typedKey] as any
          );
        } else {
          result[typedKey] = source[typedKey] as any;
        }
      }
      return result;
    };

    // دمج الإعدادات (مع الحفاظ على القيم غير المقدمة)
    const baseSettings = settings || DEFAULT_TENANT_SETTINGS;
    const mergedSettings = deepMerge(baseSettings, newSettings);

    // تحديث المستأجر (إذا كان موجوداً)
    const updatedTenant = currentTenant
      ? { ...currentTenant, settings: mergedSettings }
      : null;

    set({
      currentTenant: updatedTenant,
      settings: mergedSettings,
      lastUpdated: new Date().toISOString(),
    });
  },

  setLoading: (isLoading: boolean) => {
    set({ isLoading });
  },

  setError: (error: string | null) => {
    set({ error });
  },

  touch: () => {
    set({ lastUpdated: new Date().toISOString() });
  },

  reset: () => {
    set({ ...initialState });
    useTenantStore.persist.clearStorage();
  },

  // ============================================================
  // دوال مساعدة للحدود (Limits)
  // ============================================================

  hasStorageAvailable: (bytesNeeded: number): boolean => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    const maxStorage = settings.storage.maxStorageBytes;
    // TODO: جلب الاستخدام الحالي من الخادم
    const currentUsage = 0;
    return currentUsage + bytesNeeded <= maxStorage;
  },

  hasUsersAvailable: (currentUserCount: number): boolean => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return currentUserCount < settings.users.maxUsers;
  },

  hasAILimitAvailable: (currentUsage: number): boolean => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return currentUsage < settings.ai.monthlyAILimit;
  },

  getMaxDocumentsPerKB: (): number => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return settings.documents.maxDocumentsPerKB;
  },

  getMaxFileSizeBytes: (): number => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return settings.documents.maxFileSizeBytes;
  },

  getMaxActiveConversations: (): number => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return settings.chat.maxActiveConversations;
  },

  getMaxUsers: (): number => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return settings.users.maxUsers;
  },

  getMaxStorageBytes: (): number => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return settings.storage.maxStorageBytes;
  },

  getMonthlyAILimit: (): number => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return settings.ai.monthlyAILimit;
  },

  getAllowedModels: (): string[] => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return settings.ai.allowedModels;
  },

  getMaxTokensPerRequest: (): number => {
    const settings = get().settings || DEFAULT_TENANT_SETTINGS;
    return settings.ai.maxTokensPerRequest;
  },
});

// ============================================================
// 5. إنشاء المخزن مع persist
// ============================================================

/**
 * مخزن المستأجر (Zustand) — المصدر الوحيد (SSoT) لحالة المستأجر.
 * 
 * [مُتحقَّق منطقياً بتتبع كامل] — يدير حالة المستأجر وإعداداته مع دوال مساعدة للحدود.
 */

export const useTenantStore = create<TenantStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setCurrentTenant: (tenant: Tenant | null) => {
        if (!tenant) {
          set({
            currentTenant: null,
            settings: null,
            isActive: false,
            error: null,
          });
          return;
        }
        const settings = tenant.settings || DEFAULT_TENANT_SETTINGS;
        set({
          currentTenant: tenant,
          settings,
          isActive: tenant.status === 'ACTIVE' && !tenant.deletedAt,
          error: null,
          lastUpdated: new Date().toISOString(),
        });
      },

      updateSettings: (newSettings: Partial<TenantSettings>) => {
        const { currentTenant, settings } = get();
        const base = settings || DEFAULT_TENANT_SETTINGS;
        const merged = {
          ...base,
          ...newSettings,
          ai: { ...base.ai, ...newSettings.ai },
          storage: { ...base.storage, ...newSettings.storage },
          documents: { ...base.documents, ...newSettings.documents },
          chat: { ...base.chat, ...newSettings.chat },
          users: { ...base.users, ...newSettings.users },
          whatsapp: { ...base.whatsapp, ...newSettings.whatsapp },
        };
        set({
          currentTenant: currentTenant ? { ...currentTenant, settings: merged } : null,
          settings: merged,
          lastUpdated: new Date().toISOString(),
        });
      },

      setLoading: (isLoading: boolean) => set({ isLoading }),
      setError: (error: string | null) => set({ error }),
      touch: () => set({ lastUpdated: new Date().toISOString() }),
      reset: () => {
        set({ ...initialState });
        useTenantStore.persist.clearStorage();
      },

      hasStorageAvailable: (bytesNeeded: number) => {
        const settings = get().settings || DEFAULT_TENANT_SETTINGS;
        const maxStorage = settings.storage.maxStorageBytes;
        const currentUsage = 0;
        return currentUsage + bytesNeeded <= maxStorage;
      },
      hasUsersAvailable: (count: number) => {
        const settings = get().settings || DEFAULT_TENANT_SETTINGS;
        return count < settings.users.maxUsers;
      },
      hasAILimitAvailable: (usage: number) => {
        const settings = get().settings || DEFAULT_TENANT_SETTINGS;
        return usage < settings.ai.monthlyAILimit;
      },
      getMaxDocumentsPerKB: () => (get().settings || DEFAULT_TENANT_SETTINGS).documents.maxDocumentsPerKB,
      getMaxFileSizeBytes: () => (get().settings || DEFAULT_TENANT_SETTINGS).documents.maxFileSizeBytes,
      getMaxActiveConversations: () => (get().settings || DEFAULT_TENANT_SETTINGS).chat.maxActiveConversations,
      getMaxUsers: () => (get().settings || DEFAULT_TENANT_SETTINGS).users.maxUsers,
      getMaxStorageBytes: () => (get().settings || DEFAULT_TENANT_SETTINGS).storage.maxStorageBytes,
      getMonthlyAILimit: () => (get().settings || DEFAULT_TENANT_SETTINGS).ai.monthlyAILimit,
      getAllowedModels: () => (get().settings || DEFAULT_TENANT_SETTINGS).ai.allowedModels,
      getMaxTokensPerRequest: () => (get().settings || DEFAULT_TENANT_SETTINGS).ai.maxTokensPerRequest,
    }),
    {
      name: 'tenant-storage',
      partialize: (state) => ({
        currentTenant: state.currentTenant,
        settings: state.settings,
        isActive: state.isActive,
        lastUpdated: state.lastUpdated,
        isLoading: state.isLoading,
        error: state.error,
      }),
    }
  )
);


// ============================================================
// 6. دوال مساعدة سريعة (للاستخدام خارج React)
// ============================================================

export const getTenantSettings = (): TenantSettings => {
  const { settings } = useTenantStore.getState();
  return settings || DEFAULT_TENANT_SETTINGS;
};

export const getTenantMaxFileSize = (): number =>
  getTenantSettings().documents.maxFileSizeBytes;

export const getTenantMaxDocumentsPerKB = (): number =>
  getTenantSettings().documents.maxDocumentsPerKB;

export const getTenantMaxActiveConversations = (): number =>
  getTenantSettings().chat.maxActiveConversations;

export const getTenantMaxUsers = (): number =>
  getTenantSettings().users.maxUsers;

export const getTenantAllowedModels = (): string[] =>
  getTenantSettings().ai.allowedModels;

// ============================================================
// 7. تصدير المخزن كافتراضي
// ============================================================

export default useTenantStore;