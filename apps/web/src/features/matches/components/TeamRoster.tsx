import type { MatchParticipant, TeamSide } from '@footy-finder/shared';
import { Avatar } from '@/components/ui/Avatar.js';
import { FriendButton } from '@/features/social/components/FriendButton.js';
export function TeamRoster({
  team,
  participants,
}: {
  team: TeamSide;
  participants: MatchParticipant[];
}) {
  const players = participants.filter((item) => item.team === team);
  return (
    <section
      className={`rounded-3xl border p-5 ${team === 'HOME' ? 'border-team-home-border bg-team-home-muted' : 'border-team-away-border bg-team-away-muted'}`}
    >
      <h2 className={`text-xl font-bold ${team === 'HOME' ? 'text-team-home' : 'text-team-away'}`}>
        {team === 'HOME' ? 'Home Team' : 'Away Team'}
      </h2>
      <div className="mt-4 grid gap-2">
        {players.map((participant) => (
          <div key={participant.id} className="flex items-center gap-3 rounded-xl bg-surface p-3">
            {participant.user && <Avatar user={participant.user} size="sm" />}
            <span className="flex-1 font-semibold text-content-strong">
              {participant.user?.displayName ?? 'Player'}
            </span>
            <FriendButton userId={participant.userId} />
          </div>
        ))}
        {players.length === 0 && <p className="text-sm text-content-muted">No players yet.</p>}
      </div>
    </section>
  );
}
