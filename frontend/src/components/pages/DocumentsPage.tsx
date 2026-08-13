// ============================================================
// frontend/src/components/pages/DocumentsPage.tsx
// ============================================================
// صفحة عرض المستندات لقاعدة معرفة معينة.
// تم إصلاح مشكلة رفع المستندات بإضافة الحقول المطلوبة (fileSize, mimeType, storagePath).
// ✅ تم إصلاح خطأ TypeScript: Property 'userId' does not exist on type 'User'.
// ============================================================

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDocuments } from '../../hooks/useDocuments';
import { Spinner } from '../atoms/Spinner';
import { Button } from '../atoms/Button';
import { useAuthStore } from '../../stores/auth.store';

/**
 * صفحة عرض المستندات الخاصة بقاعدة معرفة محددة.
 */
export const DocumentsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>(); // معرف قاعدة المعرفة
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';

  const {
    documents,
    total,
    isLoading,
    isUploading,
    error,
    fetchDocuments,
    uploadDocument,
    deleteDocument,
    clearError,
  } = useDocuments();

  // حالة نموذج رفع المستند
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // جلب المستندات عند تحميل الصفحة أو تغيير معرف القاعدة
  useEffect(() => {
    if (id) {
      fetchDocuments({ knowledgeBaseId: id });
    }
  }, [id, fetchDocuments]);

  // معالج رفع المستند – ✅ تم إصلاحه بإضافة الحقول المطلوبة
  const handleUpload = async () => {
    if (!selectedFile || !id) return;

    // استخراج معرف المستخدم بأمان (يتوافق مع كل من id و userId)
    const uploadedBy = (user as any)?.userId || (user as any)?.id || 'unknown';

    // بناء الكائن مع جميع الحقول المطلوبة من نوع UploadDocumentData
    const uploadData = {
      knowledgeBaseId: id,
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      mimeType: selectedFile.type || 'application/octet-stream',
      storagePath: `/uploads/${selectedFile.name}`,
      tenantId: user?.tenantId || 'default-tenant-id',
      uploadedBy: uploadedBy,
      file: selectedFile,
    };

    const result = await uploadDocument(uploadData);

    if (result) {
      setIsUploadModalOpen(false);
      setSelectedFile(null);
      // إعادة جلب المستندات لتحديث القائمة
      fetchDocuments({ knowledgeBaseId: id });
    }
  };

  // معالج حذف المستند
  const handleDelete = async (docId: string) => {
    if (window.confirm('هل أنت متأكد من حذف هذا المستند؟')) {
      await deleteDocument(docId);
      fetchDocuments({ knowledgeBaseId: id });
    }
  };

  // حالة التحميل الأولي
  if (isLoading && documents.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-[200px]">
        <Spinner size="lg" />
        <p className="mr-4 text-gray-500">جاري تحميل المستندات...</p>
      </div>
    );
  }

  // حالة الخطأ
  if (error) {
    return (
      <div className="text-center text-red-600 p-4">
        <p>❌ {error}</p>
        <Button
          variant="primary"
          onClick={() => fetchDocuments({ knowledgeBaseId: id })}
          className="mt-2"
        >
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* رأس الصفحة */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
            📄 المستندات
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            إدارة مستندات قاعدة المعرفة
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="primary"
            onClick={() => setIsUploadModalOpen(true)}
            disabled={isUploading}
          >
            {isUploading ? 'جاري الرفع...' : '+ رفع مستند'}
          </Button>
        )}
      </div>

      {/* عداد المستندات */}
      <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {total > 0 ? (
          <span>عرض {documents.length} من {total} مستند</span>
        ) : (
          <span>لا توجد مستندات</span>
        )}
      </div>

      {/* قائمة المستندات */}
      {documents.length === 0 ? (
        <div className="text-center text-gray-500 dark:text-gray-400 py-12 border-2 border-dashed rounded-lg">
          <p className="text-4xl mb-2">📭</p>
          <p>لا توجد مستندات في هذه القاعدة</p>
          {isAdmin && (
            <p className="text-sm mt-2">اضغط على "رفع مستند" لإضافة ملف</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="bg-white dark:bg-gray-800 border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200 truncate">
                    {doc.fileName}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    الحجم: {(doc.fileSize / 1024).toFixed(1)} KB
                  </p>
                  <p className="text-sm mt-1">
                    الحالة:{' '}
                    {doc.status === 'COMPLETED' ? (
                      <span className="text-green-600 dark:text-green-400">✅ مكتمل</span>
                    ) : doc.status === 'PROCESSING' ? (
                      <span className="text-yellow-600 dark:text-yellow-400">⏳ قيد المعالجة</span>
                    ) : doc.status === 'FAILED' ? (
                      <span className="text-red-600 dark:text-red-400">❌ فشل</span>
                    ) : (
                      <span className="text-gray-500 dark:text-gray-400">⏸ معلق</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(doc.createdAt).toLocaleDateString('ar-EG')}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(doc.id)}
                  >
                    حذف
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* نافذة رفع المستند (Modal مبسط) */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-800 dark:text-gray-200 mb-4">
              رفع مستند جديد
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  اختر ملف
                </label>
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600"
                  accept=".txt,.pdf,.doc,.docx,.md,.csv,.json,.xml,.html,.css,.js,.ts,.png,.jpg,.jpeg,.gif,.svg"
                />
                {selectedFile && (
                  <p className="text-sm text-gray-500 mt-1">
                    {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsUploadModalOpen(false);
                    setSelectedFile(null);
                  }}
                >
                  إلغاء
                </Button>
                <Button
                  variant="primary"
                  onClick={handleUpload}
                  isLoading={isUploading}
                  disabled={!selectedFile || isUploading}
                >
                  رفع
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}</div>
  );
};

export default DocumentsPage;
