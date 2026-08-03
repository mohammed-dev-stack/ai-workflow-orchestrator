// frontend/src/components/atoms/Input.tsx
import React, { forwardRef, InputHTMLAttributes, useState } from 'react';
import clsx from 'clsx';

export type InputSize = 'sm' | 'md' | 'lg';

// نمدد Omit لإزالة 'size' و 'prefix' و 'suffix' لتجنب التعارض مع ReactNode
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix' | 'suffix'> {
  label?: string;
  id?: string;
  error?: string;
  helper?: string;
  size?: InputSize;
  fullWidth?: boolean;
  required?: boolean;
  isLoading?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

const sizeClasses: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-5 py-3 text-lg',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      id,
      error,
      helper,
      size = 'md',
      fullWidth = false,
      required = false,
      isLoading = false,
      disabled = false,
      className,
      type = 'text',
      prefix,
      suffix,
      onFocus,
      onBlur,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).slice(2, 9)}`;
    const errorId = error ? `${inputId}-error` : undefined;
    const helperId = helper ? `${inputId}-helper` : undefined;
    const describedBy = [errorId, helperId].filter(Boolean).join(' ');

    const [isFocused, setIsFocused] = useState(false);

    const inputClasses = clsx(
      'w-full rounded-lg border',
      'transition-all duration-200',
      'bg-white dark:bg-gray-800',
      'text-gray-900 dark:text-gray-100',
      'placeholder:text-gray-400 dark:placeholder:text-gray-500',
      'focus:outline-none focus:ring-2',
      sizeClasses[size],
      fullWidth && 'w-full',
      disabled && 'cursor-not-allowed opacity-60',
      isLoading && 'opacity-70',
      error
        ? 'border-red-500 focus:ring-red-500 dark:border-red-400 dark:focus:ring-red-400'
        : isFocused
          ? 'border-blue-500 ring-2 ring-blue-500/20 dark:border-blue-400 dark:ring-blue-400/20'
          : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500',
      (prefix || suffix) && 'flex-1',
      className
    );

    const inputElement = (
      <input
        ref={ref}
        id={inputId}
        type={type}
        className={inputClasses}
        disabled={disabled || isLoading}
        required={required}
        aria-required={required}
        aria-invalid={!!error}
        aria-describedby={describedBy || undefined}
        aria-label={!label ? props.placeholder || 'إدخال' : undefined}
        onFocus={(e) => {
          setIsFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setIsFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
    );

    const labelElement = label && (
      <label
        htmlFor={inputId}
        className="block mb-1.5 text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}
        {required && <span className="text-red-500 mr-1" aria-hidden="true">*</span>}
      </label>
    );

    const errorElement = error && (
      <p id={errorId} className="mt-1.5 text-sm text-red-600 dark:text-red-400" role="alert">
        {error}
      </p>
    );

    const helperElement = helper && (
      <p id={helperId} className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
        {helper}
      </p>
    );

    if (prefix || suffix) {
      const containerClasses = clsx(
        'flex items-center rounded-lg border transition-all duration-200',
        error
          ? 'border-red-500 focus-within:ring-2 focus-within:ring-red-500/20 dark:border-red-400'
          : isFocused
            ? 'border-blue-500 ring-2 ring-blue-500/20 dark:border-blue-400 dark:ring-blue-400/20'
            : 'border-gray-300 dark:border-gray-600',
        disabled && 'cursor-not-allowed opacity-60',
        isLoading && 'opacity-70'
      );

      return (
        <div className={clsx('flex flex-col', fullWidth && 'w-full')}>
          {labelElement}
          <div className={containerClasses}>
            {prefix && (
              <span className="flex items-center pr-3 text-gray-500 dark:text-gray-400 select-none">
                {prefix}
              </span>
            )}
            {inputElement}
            {suffix && (
              <span className="flex items-center pl-3 text-gray-500 dark:text-gray-400 select-none">
                {suffix}
              </span>
            )}
          </div>
          {errorElement}
          {helperElement}
        </div>
      );
    }

    return (
      <div className={clsx('flex flex-col', fullWidth && 'w-full')}>
        {labelElement}
        {inputElement}
        {errorElement}
        {helperElement}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;