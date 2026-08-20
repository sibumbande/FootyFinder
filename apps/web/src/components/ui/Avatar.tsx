import type { PublicUser } from '@footy-finder/shared';
export function Avatar({ user, size = 'md' }: { user: PublicUser; size?: 'sm' | 'md' | 'lg' }) {
  const initials =
    user.displayName
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2) || user.username.slice(0, 2);
  const sizeClass =
    size === 'lg' ? 'size-14 text-lg' : size === 'sm' ? 'size-9 text-xs' : 'size-11 text-sm';
  if (user.avatarUrl)
    return (
      <img
        className={`${sizeClass} shrink-0 rounded-full object-cover`}
        src={user.avatarUrl}
        alt=""
      />
    );
  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} grid shrink-0 place-items-center rounded-full bg-brand-100 font-bold uppercase text-brand-700`}
    >
      {initials}
    </span>
  );
}
