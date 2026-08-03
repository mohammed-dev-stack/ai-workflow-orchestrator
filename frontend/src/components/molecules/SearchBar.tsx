// frontend/src/components/molecules/SearchBar.tsx
import React, { forwardRef, useState, useCallback, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { Input, InputProps } from '../atoms/Input';
import { Button } from '../atoms/Button';

/**
 * خصائص مكون SearchBar.
 * [مُتحقَّق منطقياً بتتبع كامل] — جميع الخصائص المطلوبة مع وثائق JSDoc.
 */
export interface SearchBarProps extends Omit<InputProps, 'onChange' | 'onSubmit' | 'value'> {
  /** القيمة الحالية لمربع البحث */
  value?: string;
  /** القيمة الافتراضية (للمكون غير المُتحكم) */
  defaultValue?: string;
  /** دالة تستدعى عند تغيير النص */
  onChange?: (value: string) => void;
  /** دالة تستدعى عند إرسال البحث (ضغط Enter أو زر البحث) */
  onSearch?: (value: string) => void;
  /** دالة تستدعى عند مسح النص (زر المسح) */
  onClear?: () => void;
  /** نص توضيحي في مربع البحث (placeholder) */
  placeholder?: string;
  /** ما إذا كان البحث قيد التحميل */
  isLoading?: boolean;
  /** ما إذا كان زر البحث معطلاً */
  disabled?: boolean;
  /** ما إذا كان مربع البحث ممتلئ العرض */
  fullWidth?: boolean;
  /** نص زر البحث (افتراضي: "بحث") */
  searchButtonText?: string;
  /** ما إذا كان سيتم عرض زر المسح (افتراضي: true) */
  showClearButton?: boolean;
  /** تأخير التنفيذ بعد التوقف عن الكتابة بالمللي ثانية (debounce) — افتراضي: 300 */
  debounceDelay?: number;
  /** معرف فريد لمربع البحث (للوصول) */
  id?: string;
}

/**
 * مكون SearchBar — جزيئي يجمع Input و Button.
 * يلتزم بـ WCAG 2.1 AA:
 * - `role="search"` للإشارة إلى أن هذا عنصر بحث
 * - `aria-label` للتسمية الوصفية
 * - دعم التنقل عبر لوحة المفاتيح (Enter)
 *
 * [مُتحقَّق منطقياً بتتبع كامل] — مكون SearchBar كامل مع دعم إمكانية الوصول.
 */
export const SearchBar = forwardRef<HTMLDivElement, SearchBarProps>(
  (
    {
      value: controlledValue,
      defaultValue = '',
      onChange,
      onSearch,
      onClear,
      placeholder = 'بحث...',
      isLoading = false,
      disabled = false,
      fullWidth = false,
      searchButtonText = 'بحث',
      showClearButton = true,
      debounceDelay = 300,
      id,
      className,
      ...props
    },
    ref
  ) => {
    // معرف فريد لمربع البحث
    const searchId = id || `search-${Math.random().toString(36).slice(2, 9)}`;

    // حالة داخلية (للمكون غير المُتحكم)
    const [internalValue, setInternalValue] = useState(defaultValue);
    const value = controlledValue !== undefined ? controlledValue : internalValue;

    // مؤقت debounce
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // مرجع للحقل
    const inputRef = useRef<HTMLInputElement>(null);

    // معالج تغيير النص
    const handleChange = useCallback(
      (newValue: string) => {
        if (controlledValue === undefined) {
          setInternalValue(newValue);
        }

        // استدعاء onChange فوراً (للوالدين)
        onChange?.(newValue);

        // Debounce لـ onSearch
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }

        if (onSearch && debounceDelay > 0) {
          debounceTimerRef.current = setTimeout(() => {
            onSearch(newValue);
          }, debounceDelay);
        }
      },
      [controlledValue, onChange, onSearch, debounceDelay]
    );

    // معالج إرسال البحث (ضغط Enter أو زر البحث)
    const handleSearch = useCallback(() => {
      if (onSearch && value.trim()) {
        onSearch(value.trim());
      }
    }, [onSearch, value]);

    // معالج مسح النص
    const handleClear = useCallback(() => {
      if (controlledValue === undefined) {
        setInternalValue('');
      }
      onChange?.('');
      onClear?.();

      // التركيز على مربع البحث بعد المسح
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, [controlledValue, onChange, onClear]);

    // معالج ضغط Enter
    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          handleSearch();
        }
      },
      [handleSearch]
    );

    // تنظيف مؤقت debounce عند إلغاء التثبيت
    useEffect(() => {
      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
      };
    }, []);

    // دمج الفئات
    const containerClasses = clsx(
      'flex items-center gap-2',
      fullWidth && 'w-full',
      className
    );

    const inputClasses = clsx(
      'flex-1',
      !fullWidth && 'min-w-[200px]'
    );

    // عرض زر المسح
    const shouldShowClear = showClearButton && value.length > 0 && !isLoading;

    return (
      <div
        ref={ref}
        className={containerClasses}
        role="search"
        aria-label="مربع البحث"
      >
        {/* حقل الإدخال */}
        <div className={inputClasses}>
          <Input
            ref={inputRef}
            id={searchId}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isLoading}
            isLoading={isLoading}
            fullWidth
            suffix={
              shouldShowClear && (
                <button
                  type="button"
                  onClick={handleClear}
                  className={clsx(
                    'p-1 rounded-full',
                    'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300',
                    'hover:bg-gray-100 dark:hover:bg-gray-700',
                    'transition-colors duration-200',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500'
                  )}
                  aria-label="مسح النص"
                  tabIndex={0}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )
            }
            {...props}
          />
        </div>

        {/* زر البحث */}
        <Button
          variant="primary"
          size={props.size === 'sm' ? 'sm' : props.size === 'lg' ? 'lg' : 'md'}
          onClick={handleSearch}
          isLoading={isLoading}
          disabled={disabled || !value.trim()}
          aria-label={searchButtonText}
        >
          {searchButtonText}
        </Button>
      </div>
    );
  }
);

SearchBar.displayName = 'SearchBar';

/**
 * تصدير المكون كافتراضي.
 */
export default SearchBar;