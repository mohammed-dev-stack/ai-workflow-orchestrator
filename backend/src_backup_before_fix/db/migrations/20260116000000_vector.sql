-- ============================================================
-- الترحيل الثاني لقاعدة البيانات — إعدادات pgvector والبحث الدلالي
-- التاريخ: 2026-01-16
-- الوصف: إضافة دوال مساعدة ومسارات للبحث عن المتجهات وتحسين أداء pgvector
-- التوافق: PostgreSQL 14+ مع ملحق pgvector
-- ============================================================

-- 1. تمكين ملحق pgvector (تمكين إضافي في حال لم يتم تفعيله في الترحيل الأول)
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. إنشاء دوال مساعدة للبحث عن المتجهات (Semantic Search)
-- ============================================================

-- 2.1 دالة للبحث عن المقاطع الأكثر تشابهاً مع متجه استعلام
--     تُرجع مقاطع مع درجة التشابه وبيانات وصفية
--     المعايير:
--       - query_vector: متجه الاستعلام (float[])
--       - knowledge_base_id: معرف قاعدة المعرفة (UUID)
--       - limit_count: عدد النتائج المطلوبة (افتراضي: 10)
--       - similarity_threshold: عتبة التشابه (0.0 - 1.0، افتراضي: 0.7)
--     تُرجع: جدول يحتوي على (id, content, similarity, metadata, document_id, chunk_index)
-- ============================================================
CREATE OR REPLACE FUNCTION search_similar_chunks(
    query_vector vector(1024),
    knowledge_base_id UUID,
    limit_count INTEGER DEFAULT 10,
    similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    similarity FLOAT,
    metadata JSONB,
    document_id UUID,
    chunk_index INTEGER
) LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
BEGIN
    RETURN QUERY
    SELECT
        dc.id,
        dc.content,
        (1 - (dc.vector <=> query_vector)) AS similarity,
        dc.metadata,
        dc.document_id,
        dc.chunk_index
    FROM "DocumentChunk" dc
    WHERE dc.knowledgeBaseId = knowledge_base_id
      AND dc.vector IS NOT NULL
      AND (1 - (dc.vector <=> query_vector)) >= similarity_threshold
    ORDER BY dc.vector <=> query_vector
    LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_similar_chunks IS 'البحث عن المقاطع الأكثر تشابهاً مع متجه استعلام في قاعدة معرفة محددة';

-- 2.2 دالة للبحث عن المقاطع الأكثر تشابهاً مع نص (توليد المتجه داخلياً)
--     ملاحظة: هذه الدالة تُستخدم فقط عند توفر تضمين النص داخل قاعدة البيانات
--     في التطبيق، يتم توليد التضمين عبر Claude أولاً ثم استخدام search_similar_chunks
--     هذه الدالة تُستخدم كاحتياطي أو للاختبار
-- ============================================================
CREATE OR REPLACE FUNCTION search_similar_chunks_by_text(
    query_text TEXT,
    knowledge_base_id UUID,
    limit_count INTEGER DEFAULT 10,
    similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    similarity FLOAT,
    metadata JSONB,
    document_id UUID,
    chunk_index INTEGER
) LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
DECLARE
    query_vector vector(1024);
BEGIN
    -- في الإنتاج، يتم توليد التضمين عبر Claude وليس عبر SQL
    -- هذه الدالة تُستخدم فقط للاختبار أو كاحتياطي
    -- نحن لا ننفذ توليد تضمين داخل SQL، نُعيد خطأً واضحاً
    RAISE EXCEPTION 'يجب توليد التضمين عبر Claude أولاً، استخدم search_similar_chunks مع متجه';
END;
$$;

COMMENT ON FUNCTION search_similar_chunks_by_text IS 'تحذير: يجب توليد التضمين عبر Claude أولاً، استخدم search_similar_chunks مع متجه';

-- 2.3 دالة للحصول على المقاطع الأكثر تشابهاً عبر عدة قواعد معرفة (لمستخدم واحد)
--     تُستخدم للبحث عبر جميع قواعد المعرفة التابعة لمستأجر
-- ============================================================
CREATE OR REPLACE FUNCTION search_similar_chunks_multi_kb(
    query_vector vector(1024),
    tenant_id UUID,
    limit_count INTEGER DEFAULT 10,
    similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    similarity FLOAT,
    metadata JSONB,
    document_id UUID,
    chunk_index INTEGER,
    knowledge_base_id UUID
) LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
BEGIN
    RETURN QUERY
    SELECT
        dc.id,
        dc.content,
        (1 - (dc.vector <=> query_vector)) AS similarity,
        dc.metadata,
        dc.document_id,
        dc.chunk_index,
        dc.knowledgeBaseId
    FROM "DocumentChunk" dc
    WHERE dc.tenantId = tenant_id
      AND dc.vector IS NOT NULL
      AND (1 - (dc.vector <=> query_vector)) >= similarity_threshold
    ORDER BY dc.vector <=> query_vector
    LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_similar_chunks_multi_kb IS 'البحث عن المقاطع الأكثر تشابهاً عبر جميع قواعد المعرفة التابعة لمستأجر';

-- 2.4 دالة لتحديث عمود المتجه في DocumentChunk (للصيانة)
--     تُستخدم لإعادة حساب المتجهات أو تصحيحها
-- ============================================================
CREATE OR REPLACE FUNCTION update_chunk_vector(
    chunk_id UUID,
    new_vector vector(1024)
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- التحقق من وجود المقطع
    IF NOT EXISTS (SELECT 1 FROM "DocumentChunk" WHERE id = chunk_id) THEN
        RAISE EXCEPTION 'المقطع غير موجود: %', chunk_id;
    END IF;

    -- تحديث المتجه
    UPDATE "DocumentChunk"
    SET vector = new_vector
    WHERE id = chunk_id;

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION update_chunk_vector IS 'تحديث متجه مقطع معين (لإعادة الحساب أو التصحيح)';

-- 2.5 دالة لحذف جميع متجهات مستند (للاستخدام عند حذف مستند)
--     تُستخدم لتنظيف البيانات عند حذف مستند
-- ============================================================
CREATE OR REPLACE FUNCTION delete_document_vectors(
    doc_id UUID
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- التحقق من وجود المستند
    IF NOT EXISTS (SELECT 1 FROM "Document" WHERE id = doc_id) THEN
        RAISE EXCEPTION 'المستند غير موجود: %', doc_id;
    END IF;

    -- حذف المتجهات (تعيينها إلى NULL بدلاً من حذف المقطع)
    UPDATE "DocumentChunk"
    SET vector = NULL
    WHERE documentId = doc_id;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION delete_document_vectors IS 'حذف جميع متجهات مستند (تعيينها إلى NULL)';

-- 3. إنشاء دوال لتحديث إحصائيات المتجهات (للصيانة)
-- ============================================================

-- 3.1 دالة لإعادة بناء فهرس IVFFlat (للصيانة الدورية)
--     تُستخدم بعد إضافة كمية كبيرة من البيانات
-- ============================================================
CREATE OR REPLACE FUNCTION rebuild_vector_index(
    index_name TEXT DEFAULT 'DocumentChunk_vector_idx'
)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- التحقق من وجود الفهرس
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = index_name
    ) THEN
        RAISE EXCEPTION 'الفهرس غير موجود: %', index_name;
    END IF;

    -- إعادة بناء الفهرس
    EXECUTE format('REINDEX INDEX %I', index_name);

    -- تحديث الإحصائيات
    EXECUTE format('ANALYZE "DocumentChunk"');

    RETURN format('تم إعادة بناء الفهرس %s بنجاح', index_name);
END;
$$;

COMMENT ON FUNCTION rebuild_vector_index IS 'إعادة بناء فهرس IVFFlat للصيانة الدورية';

-- 3.2 دالة للحصول على إحصائيات المتجهات (للرصد)
--     تُرجع عدد المتجهات، الحد الأدنى/الأقصى للقيم، إلخ.
-- ============================================================
CREATE OR REPLACE FUNCTION get_vector_statistics(
    knowledge_base_id UUID DEFAULT NULL
)
RETURNS TABLE (
    total_chunks BIGINT,
    chunks_with_vectors BIGINT,
    chunks_without_vectors BIGINT,
    avg_vector_norm FLOAT,
    min_vector_norm FLOAT,
    max_vector_norm FLOAT
) LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF knowledge_base_id IS NULL THEN
        -- إحصائيات عامة
        RETURN QUERY
        SELECT
            COUNT(*) AS total_chunks,
            COUNT(vector) AS chunks_with_vectors,
            COUNT(*) - COUNT(vector) AS chunks_without_vectors,
            AVG(vector <-> '0'::vector) AS avg_vector_norm,
            MIN(vector <-> '0'::vector) AS min_vector_norm,
            MAX(vector <-> '0'::vector) AS max_vector_norm
        FROM "DocumentChunk"
        WHERE vector IS NOT NULL;
    ELSE
        -- إحصائيات لقاعدة معرفة محددة
        RETURN QUERY
        SELECT
            COUNT(*) AS total_chunks,
            COUNT(vector) AS chunks_with_vectors,
            COUNT(*) - COUNT(vector) AS chunks_without_vectors,
            AVG(vector <-> '0'::vector) AS avg_vector_norm,
            MIN(vector <-> '0'::vector) AS min_vector_norm,
            MAX(vector <-> '0'::vector) AS max_vector_norm
        FROM "DocumentChunk"
        WHERE knowledgeBaseId = knowledge_base_id
          AND vector IS NOT NULL;
    END IF;
END;
$$;

COMMENT ON FUNCTION get_vector_statistics IS 'الحصول على إحصائيات المتجهات للرصد والصيانة';

-- 4. إنشاء دوال للبحث المتقدم (مع ترشيح إضافي)
-- ============================================================

-- 4.1 دالة للبحث عن المقاطع الأكثر تشابهاً مع ترشيح حسب حالة المستند
--     تُستخدم للبحث في المستندات المكتملة فقط
-- ============================================================
CREATE OR REPLACE FUNCTION search_similar_chunks_filtered(
    query_vector vector(1024),
    knowledge_base_id UUID,
    document_status_filter TEXT DEFAULT 'COMPLETED',
    limit_count INTEGER DEFAULT 10,
    similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    similarity FLOAT,
    metadata JSONB,
    document_id UUID,
    chunk_index INTEGER,
    document_status TEXT
) LANGUAGE plpgsql STABLE PARALLEL SAFE AS $$
BEGIN
    RETURN QUERY
    SELECT
        dc.id,
        dc.content,
        (1 - (dc.vector <=> query_vector)) AS similarity,
        dc.metadata,
        dc.document_id,
        dc.chunk_index,
        d.status::TEXT
    FROM "DocumentChunk" dc
    INNER JOIN "Document" d ON d.id = dc.documentId
    WHERE dc.knowledgeBaseId = knowledge_base_id
      AND dc.vector IS NOT NULL
      AND d.status::TEXT = document_status_filter
      AND (1 - (dc.vector <=> query_vector)) >= similarity_threshold
    ORDER BY dc.vector <=> query_vector
    LIMIT limit_count;
END;
$$;

COMMENT ON FUNCTION search_similar_chunks_filtered IS 'البحث عن المقاطع الأكثر تشابهاً مع ترشيح حسب حالة المستند';

-- 5. دوال لتنقية المدخلات ومنع حقن SQL (الأمان — §7)
-- ============================================================

-- 5.1 دالة لتنقية معرف قاعدة المعرفة قبل استخدامه في الاستعلامات
--     تُستخدم في دوال البحث لضمان صحة الإدخال
-- ============================================================
CREATE OR REPLACE FUNCTION sanitize_uuid(input_text TEXT)
RETURNS UUID LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    -- التحقق من صحة UUID
    IF input_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'معرف غير صالح: %', input_text;
    END IF;

    RETURN input_text::UUID;
END;
$$;

COMMENT ON FUNCTION sanitize_uuid IS 'تنقية معرف UUID للاستخدام الآمن في الاستعلامات';

-- 5.2 دالة لتنقية النص قبل استخدامه في البحث
--     تُستخدم لمنع حقن SQL عند استخدام المدخلات النصية
-- ============================================================
CREATE OR REPLACE FUNCTION sanitize_search_text(input_text TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    -- إزالة الرموز الخطيرة
    RETURN regexp_replace(
        input_text,
        '[''";\\]',
        '',
        'g'
    );
END;
$$;

COMMENT ON FUNCTION sanitize_search_text IS 'تنقية النص للاستخدام الآمن في البحث';

-- 6. دوال لتسجيل مقاييس البحث (للرصد — §5)
-- ============================================================

-- 6.1 دالة لتسجيل عمليات البحث (للتحليلات)
--     تُستخدم لتتبع استخدام البحث الدلالي
-- ============================================================
CREATE OR REPLACE FUNCTION log_search_metric(
    p_tenant_id UUID,
    p_knowledge_base_id UUID,
    p_query_length INTEGER,
    p_result_count INTEGER,
    p_duration_ms INTEGER,
    p_success BOOLEAN
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO "Metric" (
        name,
        value,
        tags,
        tenantId,
        timestamp
    ) VALUES (
        'vector.search',
        p_duration_ms,
        jsonb_build_object(
            'knowledgeBaseId', p_knowledge_base_id,
            'queryLength', p_query_length,
            'resultCount', p_result_count,
            'success', p_success
        ),
        p_tenant_id,
        CURRENT_TIMESTAMP
    );
END;
$$;

COMMENT ON FUNCTION log_search_metric IS 'تسجيل مقاييس البحث الدلالي للرصد والتحليلات';

-- 7. إعدادات إضافية لتحسين أداء pgvector
-- ============================================================

-- 7.1 ضبط معلمات PostgreSQL لتحسين أداء المتجهات
--     هذه الإعدادات يمكن تطبيقها على مستوى قاعدة البيانات أو الجلسة
-- ============================================================
-- تعيين حجم العملة لعمليات المتجهات
-- ALTER SYSTEM SET work_mem = '256MB';

-- تعيين حجم التخزين المؤقت للفهارس
-- ALTER SYSTEM SET shared_buffers = '4GB';

-- إعادة تحميل الإعدادات
-- SELECT pg_reload_conf();

-- ملاحظة: هذه الإعدادات تتطلب صلاحيات superuser ويتم تطبيقها يدوياً حسب بيئة التشغيل
-- تم التعليق عليها لتجنب الأخطاء في البيئات غير المصرح بها

-- 8. تعليقات توضيحية إضافية
-- ============================================================
COMMENT ON FUNCTION search_similar_chunks IS 'البحث عن المقاطع الأكثر تشابهاً مع متجه استعلام في قاعدة معرفة محددة';
COMMENT ON FUNCTION search_similar_chunks_by_text IS 'تحذير: يجب توليد التضمين عبر Claude أولاً، استخدم search_similar_chunks مع متجه';
COMMENT ON FUNCTION search_similar_chunks_multi_kb IS 'البحث عن المقاطع الأكثر تشابهاً عبر جميع قواعد المعرفة التابعة لمستأجر';
COMMENT ON FUNCTION update_chunk_vector IS 'تحديث متجه مقطع معين (لإعادة الحساب أو التصحيح)';
COMMENT ON FUNCTION delete_document_vectors IS 'حذف جميع متجهات مستند (تعيينها إلى NULL)';
COMMENT ON FUNCTION rebuild_vector_index IS 'إعادة بناء فهرس IVFFlat للصيانة الدورية';
COMMENT ON FUNCTION get_vector_statistics IS 'الحصول على إحصائيات المتجهات للرصد والصيانة';
COMMENT ON FUNCTION search_similar_chunks_filtered IS 'البحث عن المقاطع الأكثر تشابهاً مع ترشيح حسب حالة المستند';
COMMENT ON FUNCTION sanitize_uuid IS 'تنقية معرف UUID للاستخدام الآمن في الاستعلامات';
COMMENT ON FUNCTION sanitize_search_text IS 'تنقية النص للاستخدام الآمن في البحث';
COMMENT ON FUNCTION log_search_metric IS 'تسجيل مقاييس البحث الدلالي للرصد والتحليلات';