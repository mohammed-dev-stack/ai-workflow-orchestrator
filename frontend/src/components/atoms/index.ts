// frontend/src/components/atoms/index.ts
export { Button, default as ButtonDefault } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Input, default as InputDefault } from './Input';
export type { InputProps, InputSize } from './Input';

export { Spinner, LoadingSpinner, default as SpinnerDefault } from './Spinner';
export type { SpinnerProps, SpinnerSize, SpinnerVariant } from './Spinner';

export { SkipLink, default as SkipLinkDefault } from './SkipLink';
export type { SkipLinkProps } from './SkipLink';

export { Toaster, default as ToasterDefault } from './Toaster';
export type { Toast, ToasterProps, ToastVariant, ToastPosition } from './Toaster';

export { ErrorBoundary, default as ErrorBoundaryDefault } from './ErrorBoundary';
export type { ErrorBoundaryProps, ErrorBoundaryState } from './ErrorBoundary';