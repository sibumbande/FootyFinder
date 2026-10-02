import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner.js';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
};
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({
  children,
  loading,
  disabled,
  variant = 'primary',
  className = '',
  ...props
}, ref) {
  const styles =
    variant === 'primary'
      ? 'border-2 border-brand-900 bg-brand-600 text-content-inverse shadow-[3px_4px_0_rgb(var(--theme-accent-gold))] hover:-translate-y-0.5 hover:bg-brand-500 hover:shadow-[4px_5px_0_rgb(var(--theme-accent-scarlet))] focus:ring-brand-100'
      : variant === 'secondary'
        ? 'border-2 border-line-strong bg-surface text-content shadow-[2px_3px_0_rgb(var(--theme-ink)/0.16)] hover:-translate-y-0.5 hover:bg-surface-hover focus:ring-line'
        : 'border border-transparent text-content-muted hover:bg-surface-hover hover:text-content-strong focus:ring-line';
  return (
    <button
      ref={ref}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-black uppercase tracking-[0.045em] transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
});
