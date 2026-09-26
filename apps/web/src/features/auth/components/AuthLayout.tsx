import type { PropsWithChildren } from 'react';
import { Logo } from '@/components/Logo.js';
import { ThemeToggle } from '@/components/ThemeToggle.js';
import { Link } from 'react-router-dom';
export function AuthLayout({
  children,
  eyebrow,
  title,
  description,
}: PropsWithChildren<{ eyebrow: string; title: string; description: string }>) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(30rem,0.82fr)]">
      <aside
        className="relative hidden overflow-hidden border-r-8 border-danger-600 bg-brand-900 bg-cover bg-center p-12 text-content-inverse lg:flex lg:flex-col lg:justify-between"
        style={{ backgroundImage: "url('/art/matchday-heroes.png')" }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--theme-brand-900)/0.72),rgb(var(--theme-brand-900)/0.95))]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle,rgb(var(--theme-content-inverse)/0.18)_0_1px,transparent_1.5px)] bg-[length:9px_9px]" />
        <div className="relative">
          <Logo light />
        </div>
        <div className="relative max-w-lg">
          <p className="mb-5 inline-flex -skew-x-6 bg-danger-600 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-content-inverse shadow-[4px_4px_0_rgb(var(--theme-accent-gold))]">
            Your game starts here!
          </p>
          <h2 className="text-5xl font-black uppercase leading-[0.94] drop-shadow-[3px_3px_0_rgb(var(--theme-brand-900))]">
            Find players. Build a squad. Get on the pitch.
          </h2>
          <p className="mt-5 text-lg leading-8 text-brand-100">
            A simpler way to connect with local football players and organise the matches that bring
            everyone together.
          </p>
        </div>
        <p className="relative text-sm text-brand-100">
          Built for football communities, everywhere.
        </p>
      </aside>
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-5 sm:p-8">
        <div className="pointer-events-none absolute -right-28 top-20 size-72 rounded-full border-[2.5rem] border-warning-200/30" />
        <div className="absolute right-5 top-5 sm:right-8 sm:top-8">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-xl">
          <div className="mb-8 pr-14 lg:hidden">
            <Logo />
          </div>
          <div className="mb-7">
            <p className="anime-kicker">{eyebrow}</p>
            <h1 className="mt-3 text-4xl font-black uppercase leading-none tracking-tight text-content-strong sm:text-5xl">
              {title}
            </h1>
            <p className="mt-3 leading-7 text-content-muted">{description}</p>
          </div>
          {children}
          <nav className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-semibold text-content-muted" aria-label="Legal">
            <Link to="/legal/about">About</Link><Link to="/legal/terms">Terms</Link><Link to="/legal/privacy">Privacy</Link><Link to="/legal/participation">Participation</Link><Link to="/legal/conduct">Conduct</Link><Link to="/waiting-list">Other cities</Link>
          </nav>
        </div>
      </main>
    </div>
  );
}
