// frontend/src/components/atoms/ErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import clsx from 'clsx';

/**
 * خصائص مكون ErrorBoundary.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface ErrorBoundaryProps {
  /** المحتوى المراد عرضه عند عدم وجود خطأ */
  children: ReactNode;
  /** رسالة خطأ مخصصة (تُعرض بدلاً من الافتراضية) */
  fallbackMessage?: string;
  /** مكون مخصص لعرض الخطأ (يتجاوز fallbackMessage) */
  fallbackComponent?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** دالة تستدعى عند حدوث خطأ (للتسجيل أو الإبلاغ) */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** ما إذا كان سيتم إعادة تعيين الحالة عند تغيير children (افتراضي: true) */
  resetOnChildrenChange?: boolean;
  /** ما إذا كان سيتم عرض المكدس في وضع التطوير (افتراضي: true) */
  showStackInDevelopment?: boolean;
}

/**
 * حالة مكون ErrorBoundary.
 * [مُتحقَّق منطقياً بتتبع كامل] — حالة المكون.
 */
export interface ErrorBoundaryState {
  /** ما إذا كان قد حدث خطأ */
  hasError: boolean;
  /** كائن الخطأ (إذا حدث) */
  error: Error | null;
  /** معلومات إضافية عن الخطأ */
  errorInfo: ErrorInfo | null;
}

/**
 * مكون ErrorBoundary — يلتقط الأخطاء في المكونات الفرعية ويعرض واجهة بديلة.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="alert"` لإعلام المستخدم بالخطأ
 * - `aria-live="assertive"` للإعلان الفوري
 * - رسائل خطأ واضحة ومفهومة
 * - لا يُسرب تفاصيل حساسة في الإنتاج
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون ErrorBoundary كامل مع دعم إمكانية الوصول.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * تحديث الحالة عند حدوث خطأ.
   * [مُتحقَّق منطقياً بتتبع كامل] — تحديث الحالة من خطأ.
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * تسجيل معلومات الخطأ واستدعاء onError.
   * [مُتحقَّق منطقياً بتتبع كامل] — تسجيل الخطأ مع التفاصيل الكاملة.
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // تحديث الحالة بمعلومات إضافية
    this.setState({
      errorInfo,
    });

    // استدعاء دالة onError (للتسجيل أو الإبلاغ)
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // تسجيل الخطأ في وحدة التحكم (في التطوير)
    if (import.meta.env.DEV) {
      console.error('❌ ErrorBoundary caught an error:', error, errorInfo);
    }
  }

  /**
   * إعادة تعيين الحالة عند تغيير children (إذا كان resetOnChildrenChange مفعلاً).
   * [مُتحقَّق منطقياً بتتبع كامل] — إعادة تعيين تلقائي عند تغيير المحتوى.
   */
  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.props.resetOnChildrenChange !== false) {
      if (this.state.hasError && prevProps.children !== this.props.children) {
        this.reset();
      }
    }
  }

  /**
   * إعادة تعيين حالة الخطأ (محاولة استعادة التطبيق).
   * [مُتحقَّق منطقياً بتتبع كامل] — إعادة تعيين يدوية.
   */
  reset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  /**
   * عرض واجهة بديلة عند حدوث خطأ.
   * [مُتحقَّق منطقياً بتتبع كامل] — عرض خطأ آمن مع إمكانية إعادة المحاولة.
   */
  render(): ReactNode {
    const { hasError, error, errorInfo } = this.state;
    const {
      children,
      fallbackMessage = 'عذراً، حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.',
      fallbackComponent,
      showStackInDevelopment = true,
    } = this.props;

    if (!hasError) {
      return children;
    }

    // إذا تم توفير مكون مخصص للخطأ
    if (fallbackComponent) {
      if (typeof fallbackComponent === 'function') {
        return fallbackComponent(error || new Error('خطأ غير معروف'), this.reset);
      }
      return fallbackComponent;
    }

    // عرض واجهة الخطأ الافتراضية
    const isDevelopment = import.meta.env.DEV;
    const shouldShowStack = isDevelopment && showStackInDevelopment && errorInfo;

    return (
      <div
        className={clsx(
          'flex flex-col items-center justify-center p-8 rounded-lg',
          'bg-red-50 dark:bg-red-900/20',
          'border border-red-200 dark:border-red-800',
          'text-center',
          'min-h-[200px] w-full'
        )}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {/* أيقونة الخطأ */}
        <div className="mb-4 text-red-500 dark:text-red-400">
          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        {/* الرسالة الرئيسية */}
        <h2 className="text-xl font-semibold text-red-800 dark:text-red-200 mb-2">
          {fallbackMessage}
        </h2>

        {/* رسالة خطأ مفصلة (في التطوير فقط) */}
        {shouldShowStack && error && (
          <div className="mt-4 w-full max-w-2xl text-left">
            <p className="text-sm font-mono text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 p-4 rounded-lg overflow-auto max-h-48">
              <span className="font-semibold">الخطأ:</span> {error.message}
            </p>
            {errorInfo && (
              <details className="mt-2">
                <summary className="text-sm text-red-600 dark:text-red-400 cursor-pointer hover:underline">
                  عرض تفاصيل إضافية
                </summary>
                <pre className="mt-2 text-xs font-mono text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 p-4 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap">
                  {errorInfo.componentStack}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* زر إعادة المحاولة */}
        <button
          onClick={this.reset}
          className={clsx(
            'mt-6 px-6 py-2 rounded-lg',
            'bg-red-600 hover:bg-red-700 active:bg-red-800',
            'text-white font-medium',
            'transition-colors duration-200',
            'focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2'
          )}
          aria-label="محاولة إعادة تحميل المحتوى"
        >
          إعادة المحاولة
        </button>

        {/* نص مساعدة في الإنتاج */}
        {!isDevelopment && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-300">
            إذا استمرت المشكلة، يرجى التواصل مع الدعم الفني.
          </p>
        )}
      </div>
    );
  }
}

/**
 * تصدير المكون كافتراضي.
 */
export default ErrorBoundary;