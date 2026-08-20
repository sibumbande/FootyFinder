import { Link } from 'react-router-dom';
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/"
      className={`inline-flex items-center gap-2.5 font-extrabold tracking-tight ${light ? 'text-content-inverse' : 'text-content-strong'}`}
    >
      <span
        className={`grid size-9 place-items-center rounded-xl ${light ? 'bg-content-inverse text-brand-700' : 'bg-brand-600 text-content-inverse'}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 3-2 3 2-1 4h-4zM7 17l3-4M17 17l-3-4M8 8 5 1M16 8l-5 1" />
        </svg>
      </span>
      <span>Footy Finder</span>
    </Link>
  );
}
