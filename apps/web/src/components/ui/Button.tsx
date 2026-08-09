import type { ButtonHTMLAttributes } from 'react';
import { Spinner } from './Spinner.js';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'primary' | 'secondary' | 'ghost' };
export function Button({ children, loading, disabled, variant = 'primary', className = '', ...props }: Props) {
  const styles = variant === 'primary'
    ? 'bg-pitch-600 text-white shadow-sm hover:bg-pitch-700 focus:ring-pitch-100'
    : variant === 'secondary'
      ? 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:ring-slate-200'
      : 'text-slate-600 hover:bg-slate-100 focus:ring-slate-200';
  return <button className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${className}`} disabled={disabled || loading} {...props}>{loading && <Spinner className="size-4" />}{children}</button>;
}
