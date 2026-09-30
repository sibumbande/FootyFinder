import type { ReactNode } from 'react';

export function SocialEmpty({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-3 py-16 text-center">
      <svg viewBox="0 0 24 24" className="size-14 text-line-strong" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M16 4.5a4 4 0 0 1 0 7M22 21a7 7 0 0 0-4.5-6.5" />
      </svg>
      <p className="text-xs font-black uppercase tracking-[0.12em] text-content-muted">{message}</p>
      {children}
    </div>
  );
}
