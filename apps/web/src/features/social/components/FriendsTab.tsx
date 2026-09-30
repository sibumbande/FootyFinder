import type { SocialPlayerCard } from '@footy-finder/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { useBlocks, useFriendAction, useFriendRequests, useFriends } from '../hooks/useSocial.js';
import { SocialEmpty } from './SocialEmpty.js';
import { FriendRequestsSwitch } from './FriendRequestsSwitch.js';
import { SocialPlayerCardView } from './SocialPlayerCardView.js';
import { InviteToTeamMenu } from './InviteToTeamMenu.js';
import { TeamInvitesSection } from './TeamInvitesSection.js';

const matches = (player: SocialPlayerCard, needle: string) =>
  !needle || player.displayName.toLowerCase().includes(needle) || player.username.toLowerCase().includes(needle);
const small = 'text-[11px] font-black uppercase tracking-[0.06em] text-content-muted hover:text-content-strong';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xs font-black uppercase tracking-[0.12em] text-content-muted">{title}</h2>
      {children}
    </section>
  );
}

/** Friends: requests waiting for you, requests you sent, your friends, and your blocked players. */
export function FriendsTab({ query, extraActions }: { query: string; extraActions?: (friend: SocialPlayerCard) => ReactNode }) {
  const needle = query.toLowerCase();
  const friends = useFriends();
  const requests = useFriendRequests();
  const blocks = useBlocks();
  const action = useFriendAction();
  const incoming = (requests.data?.incoming ?? []).filter(({ player }) => matches(player, needle));
  const outgoing = (requests.data?.outgoing ?? []).filter(({ player }) => matches(player, needle));
  const visible = (friends.data ?? []).filter((friend) => matches(friend, needle));
  return (
    <div className="grid gap-8">
      <FormError message={friends.error?.message ?? requests.error?.message ?? action.error?.message} />
      <TeamInvitesSection />
      {incoming.length > 0 && (
        <Section title={`Friend requests (${incoming.length})`}>
          <div className="grid gap-3 md:grid-cols-2">
            {incoming.map((request) => <SocialPlayerCardView key={request.id} player={request.player} />)}
          </div>
        </Section>
      )}
      <Section title={`Your friends (${friends.data?.length ?? 0})`}>
        {friends.isPending && <div className="h-20 animate-pulse rounded-2xl bg-surface-muted" />}
        {friends.data && visible.length === 0 && (
          <SocialEmpty message={query ? 'No friends found.' : 'No friends yet.'}>
            <p className="max-w-sm text-sm text-content-muted">Add players from Discover, their profile, or "Players you played with" after a match.</p>
          </SocialEmpty>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((friend) => (
            <SocialPlayerCardView
              key={friend.id}
              player={friend}
              actions={
                <span className="flex flex-wrap justify-end gap-2">
                  {extraActions?.(friend)}
                  <InviteToTeamMenu userId={friend.id} />
                  <Link className={small} to={`/messages/new/${friend.id}`}>Message</Link>
                  <button
                    type="button"
                    className={small}
                    onClick={() => window.confirm(`Remove ${friend.displayName} from your friends?`) && action.mutate({ kind: 'remove', userId: friend.id })}
                  >
                    Remove
                  </button>
                </span>
              }
            />
          ))}
        </div>
      </Section>
      {outgoing.length > 0 && (
        <Section title={`Requests you sent (${outgoing.length})`}>
          <div className="grid gap-3 md:grid-cols-2">
            {outgoing.map((request) => <SocialPlayerCardView key={request.id} player={request.player} />)}
          </div>
        </Section>
      )}
      <Section title="Settings">
        <FriendRequestsSwitch />
        {(blocks.data?.length ?? 0) > 0 && (
          <div className="grid gap-2 rounded-2xl border border-line p-4">
            <p className="text-sm font-black text-content-strong">Blocked players</p>
            {blocks.data!.map((player) => (
              <div key={player.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{player.displayName} <span className="text-content-muted">@{player.username}</span></span>
                <button type="button" className={small} onClick={() => action.mutate({ kind: 'unblock', userId: player.id })}>Unblock</button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
