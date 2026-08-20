import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner.js';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
};
export function Button({
  children,
  loading,
  disabled,
  variant = 'primary',
  className = '',
  ...props
}: Props) {
  const styles =
    variant === 'primary'
      ? 'bg-brand-600 text-content-inverse shadow-sm hover:bg-brand-700 focus:ring-brand-100'
      : variant === 'secondary'
        ? 'border border-line-strong bg-surface text-content hover:bg-surface-hover focus:ring-line'
        : 'text-content-muted hover:bg-surface-hover hover:text-content-strong focus:ring-line';
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}
