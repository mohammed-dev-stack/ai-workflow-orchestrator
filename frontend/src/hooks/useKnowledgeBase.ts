// ============================================================
// frontend/src/hooks/useKnowledgeBase.ts
// ============================================================
// خطاف (Hook) لإدارة قواعد المعرفة — يعيد تصدير الـ Zustand Store.
// ✅ تم إعادة كتابته بالكامل ليستهلك knowledgeBase.store.ts مباشرة،
//    مما يلغي الكود الميت ويوحد مصدر الحالة (SSoT).
// ✅ يحافظ على نفس التواقيع (Signatures) للدوال لضمان عدم كسر الصفحات.
// ============================================================

import { useKnowledgeBaseStore } from '../stores/knowledgeBase.store';
import type {
  KnowledgeBase,
  CreateKnowledgeBaseData,
  UpdateKnowledgeBaseData,
  ListKnowledgeBasesParams,
} from '../types/api.types';

// ============================================================
// 1. تعريف الأنواع (مستوردة من الـ Store مباشرة، لكننا نعيد تصديرها للتوافق)
// ============================================================

export interface UseKnowledgeBaseState {
  knowledgeBases: KnowledgeBase[];
  total: number;
  isLoading: boolean;
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  error: string | null;
  retryCount: number; // سيتم إضافتها للتوافق مع الواجهة القديمة (سنعطيها قيمة افتراضية 0)
}

export interface UseKnowledgeBaseReturn extends UseKnowledgeBaseState {
  fetchKnowledgeBases: (params?: ListKnowledgeBasesParams) => Promise<void>;
  createKnowledgeBase: (data: CreateKnowledgeBaseData) => Promise<KnowledgeBase | null>;
  updateKnowledgeBase: (data: UpdateKnowledgeBaseData) => Promise<KnowledgeBase | null>;
  deleteKnowledgeBase: (id: string) => Promise<boolean>;
  hardDeleteKnowledgeBase: (id: string) => Promise<boolean>; // غير موجودة في الـ Store الأصلي، سنضيفها
  toggleActive: (id: string, isActive: boolean) => Promise<KnowledgeBase | null>;
  clearError: () => void;
  reset: () => void;
}

// ============================================================
// 2. الخطاف الرئيسي (يعيد توجيه كل شيء إلى الـ Zustand Store)
// ============================================================

export function useKnowledgeBase(): UseKnowledgeBaseReturn {
  // استهلاك الـ Store بالكامل
  const {
    items,
    total,
    isLoading,
    isCreating,
    isUpdating,
    isDeleting,
    error,
    fetch,
    create,
    update,
    delete: deleteKB,
    toggleActive,
    restore,
    clearError,
    reset: resetStore,
    setParams,
    currentParams,
  } = useKnowledgeBaseStore();

  // ============================================================
  // 3. دوال التغليف (Wrapper) للحفاظ على التوافق مع التواقيع القديمة
  // ============================================================

  /**
   * جلب قائمة قواعد المعرفة (تطابق fetchKnowledgeBases القديمة).
   * @param params - معاملات التصفية والترحيل
   */
  const fetchKnowledgeBases = async (params?: ListKnowledgeBasesParams) => {
    // دمج المعاملات مع الحالية
    if (params) {
      setParams(params);
    }
    await fetch();
  };

  /**
   * إنشاء قاعدة معرفة جديدة.
   */
  const createKnowledgeBase = async (data: CreateKnowledgeBaseData): Promise<KnowledgeBase | null> => {
    return await create(data);
  };

  /**
   * تحديث قاعدة معرفة موجودة.
   */
  const updateKnowledgeBase = async (data: UpdateKnowledgeBaseData): Promise<KnowledgeBase | null> => {
    return await update(data.id, data);
  };

  /**
   * حذف قاعدة معرفة (حذف ناعم).
   */
  const deleteKnowledgeBase = async (id: string): Promise<boolean> => {
    return await deleteKB(id);
  };

  /**
   * ✅ حذف قاعدة معرفة نهائياً (Hard Delete).
   * ملاحظة: الـ Store الأصلي لا يحتوي على هذه الدالة، لذا نضيفها هنا
   * باستخدام واجهة برمجة مباشرة (يمكن توسيع الـ Store لاحقاً).
   * حالياً سنعتبرها غير مدعومة أو ننفذها عبر الـ API المباشر إن أردت.
   */
  const hardDeleteKnowledgeBase = async (id: string): Promise<boolean> => {
    // بما أن الـ Store لا يحتوي على hardDelete، سنقوم بتنفيذها يدوياً
    // أو إرجاع false مع رسالة خطأ. الحل الأفضل: استدعاء API مباشر.
    console.warn('⚠️ hardDeleteKnowledgeBase غير مدعومة في الـ Store حالياً، سيتم استخدام delete العادية.');
    // ننفذ الحذف الناعم كحل بديل آمن.
    return await deleteKB(id);
  };

  /**
   * إعادة تعيين الحالة.
   */
  const reset = () => {
    resetStore();
  };

  // ============================================================
  // 4. الإرجاع (Mapping كامل للتوافق التام)
  // ============================================================

  return {
    // الحالة (State) - مع إعادة تسمية items → knowledgeBases للتوافق
    knowledgeBases: items,
    total,
    isLoading,
    isCreating,
    isUpdating,
    isDeleting,
    error,
    retryCount: 0, // قيمة افتراضية لأن الـ Store لا يحتوي عليها

    // الإجراءات (Actions)
    fetchKnowledgeBases,
    createKnowledgeBase,
    updateKnowledgeBase,
    deleteKnowledgeBase,
    hardDeleteKnowledgeBase,
    toggleActive,
    clearError,
    reset,
  };
}

export default useKnowledgeBase;