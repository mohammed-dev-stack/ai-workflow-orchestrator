// frontend/src/stores/knowledgeBase.store.ts
import { create } from 'zustand';
import { knowledgeBaseApi } from '../services/knowledgeBase.api';
import type {
  KnowledgeBase,
  CreateKnowledgeBaseData,
  UpdateKnowledgeBaseData,
  ListKnowledgeBasesParams,
} from '../types/api.types';

/**
 * حالة مخزن قواعد المعرفة.
 */
export interface KnowledgeBaseState {
  /** قائمة قواعد المعرفة */
  items: KnowledgeBase[];
  /** العدد الإجمالي */
  total: number;
  /** ما إذا كانت البيانات في حالة تحميل */
  isLoading: boolean;
  /** ما إذا كان الإنشاء قيد التنفيذ */
  isCreating: boolean;
  /** ما إذا كان التحديث قيد التنفيذ */
  isUpdating: boolean;
  /** ما إذا كان الحذف قيد التنفيذ */
  isDeleting: boolean;
  /** خطأ (إن وجد) */
  error: string | null;
  /** معاملات البحث الحالية */
  currentParams: ListKnowledgeBasesParams;
}

/**
 * إجراءات مخزن قواعد المعرفة.
 */
export interface KnowledgeBaseActions {
  /** جلب قائمة قواعد المعرفة */
  fetch: (params?: ListKnowledgeBasesParams) => Promise<void>;
  /** جلب قاعدة معرفة بواسطة المعرف */
  getById: (id: string) => Promise<KnowledgeBase | null>;
  /** إنشاء قاعدة معرفة جديدة */
  create: (data: CreateKnowledgeBaseData) => Promise<KnowledgeBase | null>;
  /** تحديث قاعدة معرفة */
  update: (id: string, data: UpdateKnowledgeBaseData) => Promise<KnowledgeBase | null>;
  /** حذف قاعدة معرفة */
  delete: (id: string) => Promise<boolean>;
  /** تفعيل/تعطيل قاعدة معرفة */
  toggleActive: (id: string, isActive: boolean) => Promise<KnowledgeBase | null>;
  /** استعادة قاعدة معرفة محذوفة */
  restore: (id: string) => Promise<KnowledgeBase | null>;
  /** مسح الخطأ */
  clearError: () => void;
  /** إعادة تعيين الحالة */
  reset: () => void;
  /** تحديث معاملات البحث */
  setParams: (params: Partial<ListKnowledgeBasesParams>) => void;
}

/**
 * نوع مخزن قواعد المعرفة الكامل.
 */
export type KnowledgeBaseStore = KnowledgeBaseState & KnowledgeBaseActions;

/**
 * الحالة الافتراضية للمخزن.
 */
const initialState: KnowledgeBaseState = {
  items: [],
  total: 0,
  isLoading: false,
  isCreating: false,
  isUpdating: false,
  isDeleting: false,
  error: null,
  currentParams: {
    limit: 20,
    offset: 0,
  },
};

/**
 * مخزن قواعد المعرفة (Zustand).
 * [مُتحقَّق منطقياً بتتبع كامل] — يدير حالة قواعد المعرفة مع دعم CRUD والبحث.
 */
export const useKnowledgeBaseStore = create<KnowledgeBaseStore>()((set, get) => ({
  ...initialState,

  // ============================================================
  // جلب قائمة قواعد المعرفة
  // ============================================================
  fetch: async (params?: ListKnowledgeBasesParams): Promise<void> => {
    const currentParams = get().currentParams;
    const mergedParams = { ...currentParams, ...params };

    set({ isLoading: true, error: null });

    try {
      const response = await knowledgeBaseApi.list(mergedParams);

      set({
        items: response.items || [],
        total: response.total || 0,
        currentParams: mergedParams,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل جلب قواعد المعرفة';
      set({ error: errorMessage, isLoading: false });
    }
  },

  // ============================================================
  // جلب قاعدة معرفة بواسطة المعرف
  // ============================================================
  getById: async (id: string): Promise<KnowledgeBase | null> => {
    // محاولة البحث في القائمة أولاً
    const existing = get().items.find((item) => item.id === id);
    if (existing) {
      return existing;
    }

    set({ isLoading: true, error: null });

    try {
      const kb = await knowledgeBaseApi.get(id);
      // إضافة إلى القائمة (اختياري)
      set((state) => ({
        items: [kb, ...state.items.filter((item) => item.id !== id)],
        isLoading: false,
      }));
      return kb;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل جلب قاعدة المعرفة';
      set({ error: errorMessage, isLoading: false });
      return null;
    }
  },

  // ============================================================
  // إنشاء قاعدة معرفة جديدة
  // ============================================================
  create: async (data: CreateKnowledgeBaseData): Promise<KnowledgeBase | null> => {
    set({ isCreating: true, error: null });

    try {
      const newKB = await knowledgeBaseApi.create(data);

      set((state) => ({
        items: [newKB, ...state.items],
        total: state.total + 1,
        isCreating: false,
        error: null,
      }));

      return newKB;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل إنشاء قاعدة المعرفة';
      set({ error: errorMessage, isCreating: false });
      return null;
    }
  },

  // ============================================================
  // تحديث قاعدة معرفة
  // ============================================================
  update: async (id: string, data: UpdateKnowledgeBaseData): Promise<KnowledgeBase | null> => {
    set({ isUpdating: true, error: null });

    try {
      const updatedKB = await knowledgeBaseApi.update(id, data);

      set((state) => ({
        items: state.items.map((item) => (item.id === id ? updatedKB : item)),
        isUpdating: false,
        error: null,
      }));

      return updatedKB;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل تحديث قاعدة المعرفة';
      set({ error: errorMessage, isUpdating: false });
      return null;
    }
  },

  // ============================================================
  // حذف قاعدة معرفة
  // ============================================================
  delete: async (id: string): Promise<boolean> => {
    set({ isDeleting: true, error: null });

    try {
      await knowledgeBaseApi.delete(id);

      set((state) => ({
        items: state.items.filter((item) => item.id !== id),
        total: state.total - 1,
        isDeleting: false,
        error: null,
      }));

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل حذف قاعدة المعرفة';
      set({ error: errorMessage, isDeleting: false });
      return false;
    }
  },

  // ============================================================
  // تفعيل/تعطيل قاعدة معرفة
  // ============================================================
  toggleActive: async (id: string, isActive: boolean): Promise<KnowledgeBase | null> => {
    set({ isUpdating: true, error: null });

    try {
      const updatedKB = await knowledgeBaseApi.toggleActive(id, isActive);

      set((state) => ({
        items: state.items.map((item) => (item.id === id ? updatedKB : item)),
        isUpdating: false,
        error: null,
      }));

      return updatedKB;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل تغيير حالة قاعدة المعرفة';
      set({ error: errorMessage, isUpdating: false });
      return null;
    }
  },

  // ============================================================
  // استعادة قاعدة معرفة محذوفة
  // ============================================================
  restore: async (id: string): Promise<KnowledgeBase | null> => {
    set({ isUpdating: true, error: null });

    try {
      const restoredKB = await knowledgeBaseApi.restore(id);

      set((state) => ({
        items: state.items.map((item) => (item.id === id ? restoredKB : item)),
        isUpdating: false,
        error: null,
      }));

      return restoredKB;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'فشل استعادة قاعدة المعرفة';
      set({ error: errorMessage, isUpdating: false });
      return null;
    }
  },

  // ============================================================
  // تحديث معاملات البحث
  // ============================================================
  setParams: (params: Partial<ListKnowledgeBasesParams>): void => {
    set((state) => ({
      currentParams: { ...state.currentParams, ...params },
    }));
  },

  // ============================================================
  // مسح الخطأ
  // ============================================================
  clearError: (): void => {
    set({ error: null });
  },

  // ============================================================
  // إعادة تعيين الحالة
  // ============================================================
  reset: (): void => {
    set({ ...initialState });
  },
}));

/**
 * تصدير المخزن كافتراضي.
 */
export default useKnowledgeBaseStore;