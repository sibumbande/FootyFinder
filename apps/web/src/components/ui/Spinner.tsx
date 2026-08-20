export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-5 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}
