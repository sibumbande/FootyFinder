import { forwardRef, type InputHTMLAttributes, useId } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};
export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, error, hint, id, className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? props.name ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    // CEO touch-up batch 2, item 3: content-start + a fixed h-12 keep side-by-side fields (date, number, text)
    // the same height even when only one of them has a hint underneath.
    <div className="grid content-start gap-2">
      <label
        className="text-xs font-black uppercase tracking-[0.08em] text-content"
        htmlFor={inputId}
      >
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={`h-12 w-full min-w-0 rounded-md border-2 bg-surface px-3.5 py-3 text-sm font-semibold normal-case tracking-normal text-content-strong shadow-[inset_3px_3px_0_rgb(var(--theme-ink)/0.04)] outline-none transition placeholder:text-content-subtle focus:-translate-y-0.5 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 ${error ? 'border-danger-400' : 'border-line-strong'} ${className}`}
        {...props}
      />
      {hint && (
        <span id={hintId} className="font-normal normal-case tracking-normal text-content-muted">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="font-normal normal-case tracking-normal text-danger-700">
          {error}
        </span>
      )}
    </div>
  );
});
