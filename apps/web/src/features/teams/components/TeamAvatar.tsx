import type { TeamSummary } from '@footy-finder/shared';

export function TeamAvatar({
  team,
  size = 'md',
}: {
  team: Pick<TeamSummary, 'name' | 'shortName' | 'profileImageUrl'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const initials =
    team.shortName ||
    team.name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 3);
  const sizeClass =
    size === 'lg' ? 'size-24 text-2xl' : size === 'sm' ? 'size-11 text-xs' : 'size-16 text-lg';
  if (team.profileImageUrl)
    return (
      <img
        src={team.profileImageUrl}
        alt={`${team.name} badge`}
        className={`${sizeClass} shrink-0 rounded-2xl border border-line object-cover shadow-sm`}
      />
    );
  return (
    <span
      aria-label={`${team.name} initials`}
      className={`${sizeClass} grid shrink-0 place-items-center rounded-2xl border border-brand-200 bg-brand-100 font-black uppercase text-brand-700 shadow-sm`}
    >
      {initials}
    </span>
  );
}
