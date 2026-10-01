import { Link } from 'react-router-dom';

// CEO touch-up batch 2, item 2: the FootyFinder "FF" mark (public/logo-96.png, cut from logo.png) on its own
// navy tile, so it reads the same on the light paper and the dark floodlit theme.
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/"
      aria-label="FootyFinder home"
      className={`group inline-flex items-center gap-2 font-extrabold ${light ? 'text-content-inverse' : 'text-content-strong'}`}
    >
      <span
        className={`relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-[0.55rem] border-2 bg-[#000018] shadow-[3px_3px_0_rgb(var(--theme-accent-gold))] transition group-hover:-rotate-3 group-hover:scale-105 ${light ? 'border-content-inverse/70' : 'border-brand-900 dark:border-line-strong'}`}
      >
        <img src="/logo-96.png" alt="" width={40} height={40} className="size-full object-cover" />
      </span>
      <span className="hidden -skew-x-6 font-black uppercase leading-none tracking-[-0.035em] xs:block sm:block" aria-hidden="true">
        <span className="block text-[0.95rem]">Footy</span>
        <span
          className={`block text-[0.72rem] tracking-[0.16em] ${light ? 'text-hero-accent' : 'text-brand-700'}`}
        >
          Finder
        </span>
      </span>
    </Link>
  );
}
