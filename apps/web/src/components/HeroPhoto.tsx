/**
 * CEO touch-up batch 3.5, item 7: Cape Town and Table Mountain at dusk, as a responsive photo behind a hero.
 * WebP at 640-2560 px (the browser picks the smallest that fits; about 30 KB on a phone) with a JPEG fallback.
 * Files come from apps/web/scripts/build-hero-images.mjs. The parent must be `relative` and clip its overflow;
 * the dark gradient that keeps the text readable is drawn by the parent, above this photo.
 */
const WIDTHS = [640, 960, 1280, 1920, 2560];

export function HeroPhoto({ sizes, className = '', priority = false }: { sizes: string; className?: string; priority?: boolean }) {
  return (
    <picture>
      <source type="image/webp" srcSet={WIDTHS.map((width) => `/hero/cape-town-${width}.webp ${width}w`).join(', ')} sizes={sizes} />
      <img
        src="/hero/cape-town-1280.jpg"
        alt="Table Mountain above Cape Town at dusk"
        width={1280}
        height={720}
        decoding="async"
        {...(priority ? { fetchpriority: 'high' } : { loading: 'lazy' as const })}
        className={`absolute inset-0 h-full w-full object-cover ${className}`}
        data-testid="hero-photo"
      />
    </picture>
  );
}
