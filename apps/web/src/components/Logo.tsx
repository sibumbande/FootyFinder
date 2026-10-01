import { Link } from 'react-router-dom';
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/"
      className={`group inline-flex items-center gap-2 font-extrabold ${light ? 'text-content-inverse' : 'text-content-strong'}`}
    >
      <span
        className={`relative grid size-10 -skew-x-6 place-items-center rounded-[0.3rem_0.75rem_0.3rem_0.75rem] border-2 transition group-hover:-rotate-3 group-hover:scale-105 ${light ? 'border-content-inverse bg-danger-600 text-content-inverse' : 'border-brand-900 bg-danger-600 text-content-inverse'} shadow-[3px_3px_0_rgb(var(--theme-accent-gold))]`}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5 skew-x-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 3-2 3 2-1 4h-4zM7 17l3-4M17 17l-3-4M8 8 5 1M16 8l-5 1" />
        </svg>
      </span>
      <span className="hidden -skew-x-6 font-black uppercase leading-none tracking-[-0.035em] xs:block sm:block">
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
