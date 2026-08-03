// ============================================================
// frontend/src/components/pages/KnowledgeBasePage.tsx
// ============================================================
// صفحة قواعد المعرفة – تم إضافة دعم الحذف النهائي (Hard Delete)
// مع تأكيد إضافي لمنع الحذف العرضي.
// ============================================================

import React, { forwardRef, memo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useKnowledgeBase } from '../../hooks/useKnowledgeBase';
import { useAuthStore } from '../../stores/auth.store';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { Spinner } from '../atoms/Spinner';
import { SearchBar } from '../molecules/SearchBar';
import { KnowledgeBaseCard } from '../molecules/KnowledgeBaseCard';
import { Modal } from '../organisms/Modal';
import { Toaster } from '../atoms/Toaster';

/**
 * خصائص مكون صفحة قواعد المعرفة.
 */
export interface KnowledgeBasePageProps {
  /** معرف فئة CSS إضافية */
  className?: string;
}

/**
 * مكون صفحة قواعد المعرفة (KnowledgeBasePage) — صفحة كاملة.
 */
export const KnowledgeBasePage = memo(
  forwardRef<HTMLDivElement, KnowledgeBasePageProps>(
    ({ className }, ref) => {
      const navigate = useNavigate();
      const { user } = useAuthStore();

      // حالة البحث
      const [searchQuery, setSearchQuery] = useState('');
      const [debouncedSearch, setDebouncedSearch] = useState('');

      // حالة النموذج (إنشاء/تعديل)
      const [isModalOpen, setIsModalOpen] = useState(false);
      const [editingId, setEditingId] = useState<string | null>(null);
      const [formName, setFormName] = useState('');
      const [formDescription, setFormDescription] = useState('');
      const [formTags, setFormTags] = useState('');
      const [formIsActive, setFormIsActive] = useState(true);

      // حالة الحذف الناعم (Soft Delete)
      const [deleteModalOpen, setDeleteModalOpen] = useState(false);
      const [deletingId, setDeletingId] = useState<string | null>(null);

      // ✅ حالة الحذف النهائي (Hard Delete)
      const [hardDeleteModalOpen, setHardDeleteModalOpen] = useState(false);
      const [hardDeletingId, setHardDeletingId] = useState<string | null>(null);

      // استخدام خطاف قواعد المعرفة
      const {
        knowledgeBases,
        total,
        isLoading,
        error,
        fetchKnowledgeBases,
        createKnowledgeBase,
        updateKnowledgeBase,
        deleteKnowledgeBase,
        hardDeleteKnowledgeBase,
        toggleActive,
        isCreating,
        isUpdating,
        isDeleting,
        clearError,
      } = useKnowledgeBase();

      // جلب البيانات عند التحميل وعند تغيير البحث
      useEffect(() => {
        const timer = setTimeout(() => {
          setDebouncedSearch(searchQuery);
        }, 500);

        return () => clearTimeout(timer);
      }, [searchQuery]);

      useEffect(() => {
        fetchKnowledgeBases({ search: debouncedSearch || undefined });
      }, [debouncedSearch, fetchKnowledgeBases]);

      // إعادة تعيين النموذج
      const resetForm = useCallback(() => {
        setFormName('');
        setFormDescription('');
        setFormTags('');
        setFormIsActive(true);
        setEditingId(null);
      }, []);

      // فتح نموذج الإنشاء
      const handleCreate = useCallback(() => {
        resetForm();
        setIsModalOpen(true);
      }, [resetForm]);

      // فتح نموذج التعديل
      const handleEdit = useCallback(
        (id: string) => {
          const kb = knowledgeBases.find((item) => item.id === id);
          if (kb) {
            setEditingId(id);
            setFormName(kb.name);
            setFormDescription(kb.description || '');
            setFormTags(kb.tags.join(', '));
            setFormIsActive(kb.isActive);
            setIsModalOpen(true);
          }
        },
        [knowledgeBases]
      );

      // تأكيد الحذف الناعم
      const handleDeleteConfirm = useCallback((id: string) => {
        setDeletingId(id);
        setDeleteModalOpen(true);
      }, []);

      // تنفيذ الحذف الناعم
      const handleDelete = useCallback(async () => {
        if (deletingId) {
          await deleteKnowledgeBase(deletingId);
          setDeleteModalOpen(false);
          setDeletingId(null);
        }
      }, [deletingId, deleteKnowledgeBase]);

      // ✅ تأكيد الحذف النهائي
      const handleHardDeleteConfirm = useCallback((id: string) => {
        setHardDeletingId(id);
        setHardDeleteModalOpen(true);
      }, []);

      // ✅ تنفيذ الحذف النهائي
      const handleHardDelete = useCallback(async () => {
        if (hardDeletingId) {
          await hardDeleteKnowledgeBase(hardDeletingId);
          setHardDeleteModalOpen(false);
          setHardDeletingId(null);
        }
      }, [hardDeletingId, hardDeleteKnowledgeBase]);

      // إرسال النموذج (إنشاء أو تحديث)
      const handleSubmit = useCallback(async () => {
        const tagsArray = formTags.split(',').map((t) => t.trim()).filter(Boolean);

        if (editingId) {
          await updateKnowledgeBase({
            id: editingId,
            name: formName,
            description: formDescription || undefined,
            tags: tagsArray.length > 0 ? tagsArray : undefined,
            isActive: formIsActive,
          });
        } else {
          await createKnowledgeBase({
            name: formName,
            description: formDescription || undefined,
            tags: tagsArray.length > 0 ? tagsArray : undefined,
            isActive: formIsActive,
          });
        }

        if (!error) {
          setIsModalOpen(false);
          resetForm();
        }
      }, [
        editingId,
        formName,
        formDescription,
        formTags,
        formIsActive,
        createKnowledgeBase,
        updateKnowledgeBase,
        error,
        resetForm,
      ]);

      // معالج تغيير حالة النشاط
      const handleToggleActive = useCallback(
        async (id: string, currentState: boolean) => {
          await toggleActive(id, !currentState);
        },
        [toggleActive]
      );

      // معالج عرض المستندات
      const handleViewDocuments = useCallback(
        (id: string) => {
          navigate(`/knowledge-bases/${id}/documents`);
        },
        [navigate]
      );

      // دمج فئات الصفحة
      const pageClasses = clsx('flex flex-col gap-6', className);

      // حالة التحميل
      if (isLoading && knowledgeBases.length === 0) {
        return (
          <div
            ref={ref}
            className="flex items-center justify-center min-h-[400px] w-full"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className="flex flex-col items-center gap-4">
              <Spinner size="lg" variant="primary" />
              <p className="text-gray-500 dark:text-gray-400">جاري تحميل قواعد المعرفة...</p>
            </div>
          </div>
        );
      }

      // حالة الخطأ
      if (error) {
        return (
          <div
            ref={ref}
            className={clsx(
              'flex flex-col items-center justify-center min-h-[400px] w-full p-8',
              'bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800'
            )}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
          >
            <svg
              className="w-12 h-12 text-red-500 dark:text-red-400 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
              فشل تحميل قواعد المعرفة
            </h3>
            <p className="text-sm text-red-600 dark:text-red-300 mb-4 text-center max-w-md">
              {error}
            </p>
            <Button variant="primary" onClick={() => fetchKnowledgeBases({ search: debouncedSearch })}>
              إعادة المحاولة
            </Button>
          </div>
        );
      }

      // هل المستخدم لديه صلاحية ADMIN؟
      const isAdmin = user?.role === 'ADMIN';

      return (
        <div ref={ref} className={pageClasses} role="main" aria-label="صفحة قواعد المعرفة">
          {/* رأس الصفحة */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                قواعد المعرفة
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                إدارة قواعد المعرفة التي تستخدمها المحادثات
              </p>
            </div>
            {isAdmin && (
              <Button
                variant="primary"
                size="md"
                onClick={handleCreate}
                aria-label="إنشاء قاعدة معرفة جديدة"
              >
                <svg
                  className="w-5 h-5 ml-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                قاعدة معرفة جديدة
              </Button>
            )}
          </div>

          {/* شريط البحث */}
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="ابحث في قواعد المعرفة..."
            isLoading={isLoading}
            fullWidth
            aria-label="البحث في قواعد المعرفة"
          />

          {/* عداد النتائج */}
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {total > 0 ? (
              <span>عرض {knowledgeBases.length} من {total} قاعدة معرفة</span>
            ) : (
              <span>لا توجد قواعد معرفة</span>
            )}
          </div>

          {/* شبكة قواعد المعرفة */}
          {knowledgeBases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <svg
                className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
              <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300">
                لا توجد قواعد معرفة
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md">
                {isAdmin
                  ? 'قم بإنشاء قاعدة معرفة جديدة لبدء استخدام المساعد الذكي.'
                  : 'لا توجد قواعد معرفة متاحة. تواصل مع المدير لإنشاء قاعدة معرفة.'}
              </p>
              {isAdmin && (
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleCreate}
                  className="mt-4"
                  aria-label="إنشاء قاعدة معرفة جديدة"
                >
                  إنشاء قاعدة معرفة
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {knowledgeBases.map((kb) => (
                <div key={kb.id} className="flex flex-col">
                  <KnowledgeBaseCard
                    id={kb.id}
                    name={kb.name}
                    description={kb.description}
                    documentCount={kb.documentCount || 0}
                    isActive={kb.isActive}
                    tags={kb.tags}
                    createdAt={kb.createdAt}
                    createdBy={kb.createdBy || 'غير معروف'}
                    isLoading={isDeleting}
                    onClick={() => handleViewDocuments(kb.id)}
                    onEdit={isAdmin ? () => handleEdit(kb.id) : undefined}
                    onDelete={isAdmin ? () => handleDeleteConfirm(kb.id) : undefined}
                    onViewDocuments={handleViewDocuments}
                    onToggleActive={isAdmin ? handleToggleActive : undefined}
                    selectable={false}
                  />
                  {/* ✅ زر الحذف النهائي – يظهر فقط للمدير */}
                  {isAdmin && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleHardDeleteConfirm(kb.id)}
                        className="text-xs px-2 py-1"
                      >
                        🗑️ حذف نهائي
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* نافذة إنشاء/تعديل قاعدة المعرفة */}
          <Modal
            isOpen={isModalOpen}
            onClose={() => {
              if (!isCreating && !isUpdating) {
                setIsModalOpen(false);
                resetForm();
              }
            }}
            title={editingId ? 'تعديل قاعدة المعرفة' : 'إنشاء قاعدة معرفة جديدة'}
            size="md"
            closeOnOverlayClick={!isCreating && !isUpdating}
          >
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-4">
              <Input
                id="kb-name"
                label="اسم قاعدة المعرفة"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                placeholder="أدخل اسم قاعدة المعرفة"
                disabled={isCreating || isUpdating}
                autoFocus
              />

              <Input
                id="kb-description"
                label="الوصف (اختياري)"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="وصف قصير لقاعدة المعرفة"
                disabled={isCreating || isUpdating}
              />

              <Input
                id="kb-tags"
                label="العلامات (اختياري)"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
                placeholder="مفصولة بفواصل: تقنية، دعم، مبيعات"
                disabled={isCreating || isUpdating}
                helper="افصل العلامات بفواصل"
              />

              <div className="flex items-center gap-3">
                <input
                  id="kb-active"
                  type="checkbox"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                  disabled={isCreating || isUpdating}
                />
                <label htmlFor="kb-active" className="text-sm text-gray-700 dark:text-gray-300">
                  نشطة (قابلة للاستخدام في المحادثات)
                </label>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" role="alert">
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    if (!isCreating && !isUpdating) {
                      setIsModalOpen(false);
                      resetForm();
                    }
                  }}
                  disabled={isCreating || isUpdating}
                >
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  isLoading={isCreating || isUpdating}
                  disabled={isCreating || isUpdating || !formName.trim()}
                >
                  {editingId ? 'تحديث' : 'إنشاء'}
                </Button>
              </div>
            </form>
          </Modal>

          {/* نافذة تأكيد الحذف الناعم */}
          <Modal
            isOpen={deleteModalOpen}
            onClose={() => {
              if (!isDeleting) {
                setDeleteModalOpen(false);
                setDeletingId(null);
              }
            }}
            title="تأكيد الحذف"
            size="sm"
            closeOnOverlayClick={!isDeleting}
          >
            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300">
                هل أنت متأكد من حذف قاعدة المعرفة هذه؟ سيتم حذف جميع المستندات المرتبطة بها.
              </p>
              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" role="alert">
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    if (!isDeleting) {
                      setDeleteModalOpen(false);
                      setDeletingId(null);
                    }
                  }}
                  disabled={isDeleting}
                >
                  إلغاء
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  onClick={handleDelete}
                  isLoading={isDeleting}
                  disabled={isDeleting}
                >
                  حذف
                </Button>
              </div>
            </div>
          </Modal>

          {/* ✅ نافذة تأكيد الحذف النهائي – تحذير أقوى */}
          <Modal
            isOpen={hardDeleteModalOpen}
            onClose={() => {
              if (!isDeleting) {
                setHardDeleteModalOpen(false);
                setHardDeletingId(null);
              }
            }}
            title="⚠️ حذف نهائي – لا يمكن التراجع"
            size="sm"
            closeOnOverlayClick={!isDeleting}
          >
            <div className="space-y-4">
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg p-4">
                <p className="text-red-700 dark:text-red-300 font-semibold">
                  ⚠️ تحذير: هذا الإجراء لا يمكن التراجع عنه!
                </p>
                <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                  سيتم حذف قاعدة المعرفة بشكل نهائي مع جميع المستندات والمقاطع المرتبطة بها.
                </p>
              </div>
              {error && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" role="alert">
                  <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    if (!isDeleting) {
                      setHardDeleteModalOpen(false);
                      setHardDeletingId(null);
                    }
                  }}
                  disabled={isDeleting}
                >
                  إلغاء
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  onClick={handleHardDelete}
                  isLoading={isDeleting}
                  disabled={isDeleting}
                >
                  حذف نهائي
                </Button>
              </div>
            </div>
          </Modal>

          <Toaster position="top-right" />
        </div>
      );
    }
  )
);

KnowledgeBasePage.displayName = 'KnowledgeBasePage';

export default KnowledgeBasePage;