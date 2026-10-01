import type { PropsWithChildren } from 'react';
import { HeroPhoto } from '@/components/HeroPhoto.js';
import { Logo } from '@/components/Logo.js';
import { ThemeToggle } from '@/components/ThemeToggle.js';
import { TERMS_ANCHORS } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
export function AuthLayout({
  children,
  eyebrow,
  title,
  description,
}: PropsWithChildren<{ eyebrow: string; title: string; description: string }>) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(30rem,0.82fr)]">
      {/* CEO touch-up batch 3.5, item 7: the same Cape Town photo as the home hero (desktop only). */}
      <aside className="relative hidden overflow-hidden border-r-8 border-danger-600 bg-brand-900 p-12 text-content-inverse lg:flex lg:flex-col lg:justify-between">
        <HeroPhoto sizes="50vw" className="object-[55%_center]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(var(--theme-brand-900)/0.35)_0%,rgb(var(--theme-brand-900)/0.55)_35%,rgb(var(--theme-brand-900)/0.92)_62%,rgb(var(--theme-brand-900)/0.96)_100%)]" />
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
          <p className="mt-5 text-lg leading-8 text-hero-muted">
            A simpler way to connect with local football players and organise the matches that bring
            everyone together.
          </p>
        </div>
        <p className="relative text-sm text-hero-muted">
          Built for football communities, everywhere.
        </p>
      </aside>
      {/* CEO touch-up batch 3, item 7: one header row (logo left, theme toggle right), like the main site header;
          no decorative ring over the heading. On large screens the logo sits in the hero panel instead. */}
      <main className="flex min-h-screen min-w-0 flex-col">
        <header className="flex h-[4.5rem] shrink-0 items-center gap-2 px-4 sm:px-6 lg:px-8" data-testid="auth-header">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <div className="flex flex-1 items-center justify-center px-4 pb-10 pt-2 sm:px-8">
        <div className="w-full max-w-xl">
          <div className="mb-7">
            <p className="anime-kicker">{eyebrow}</p>
            <h1 className="mt-3 text-4xl font-black uppercase leading-none tracking-tight text-content-strong sm:text-5xl">
              {title}
            </h1>
            <p className="mt-3 leading-7 text-content-muted">{description}</p>
          </div>
          {children}
          <nav className="mt-4 flex flex-wrap justify-center gap-x-4 text-sm font-semibold text-content-muted [&>a]:inline-flex [&>a]:min-h-11 [&>a]:items-center" aria-label="Legal">
            <Link to="/legal/terms">Terms</Link><Link to={`/legal/terms#${TERMS_ANCHORS.privacy}`}>Privacy</Link><Link to={`/legal/terms#${TERMS_ANCHORS.riskWaiver}`}>Risk waiver</Link><Link to="/waiting-list">Other cities</Link>
          </nav>
        </div>
        </div>
      </main>
    </div>
  );
}
