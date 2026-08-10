import { forwardRef, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };
export const Input = forwardRef<HTMLInputElement, Props>(function Input({ label, error, hint, id, className = '', ...props }, ref) {
  const inputId = id ?? props.name;
  return <label className="grid gap-2 text-sm font-semibold text-content" htmlFor={inputId}>{label}<input ref={ref} id={inputId} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} className={`min-h-12 w-full rounded-xl border bg-surface px-3.5 py-3 font-normal text-content-strong outline-none transition placeholder:text-content-subtle focus:border-brand-500 focus:ring-4 focus:ring-brand-100 ${error ? 'border-danger-400' : 'border-line-strong'} ${className}`} {...props} />{hint && !error && <span className="font-normal text-content-muted">{hint}</span>}{error && <span id={`${inputId}-error`} className="font-normal text-danger-600">{error}</span>}</label>;
});
