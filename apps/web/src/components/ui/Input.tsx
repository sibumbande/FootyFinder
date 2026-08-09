import { forwardRef, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };
export const Input = forwardRef<HTMLInputElement, Props>(function Input({ label, error, hint, id, className = '', ...props }, ref) {
  const inputId = id ?? props.name;
  return <label className="grid gap-2 text-sm font-semibold text-slate-700" htmlFor={inputId}>{label}<input ref={ref} id={inputId} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} className={`min-h-12 w-full rounded-xl border bg-white px-3.5 py-3 font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-pitch-500 focus:ring-4 focus:ring-pitch-100 ${error ? 'border-red-400' : 'border-slate-300'} ${className}`} {...props} />{hint && !error && <span className="font-normal text-slate-500">{hint}</span>}{error && <span id={`${inputId}-error`} className="font-normal text-red-600">{error}</span>}</label>;
});
