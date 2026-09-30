import { Avatar } from '@/components/ui/Avatar.js';
import { FormError } from '@/components/ui/FormError.js';
import { useInvitableFriends, useTeamInviteAction, useTeamMemberInvites } from '../hooks/useSocial.js';

/** Gate 9 / TKT-904: on the team page, pick friends and invite each in one tap. */
export function InviteFriendsPanel({ teamId }: { teamId: string }) {
  const friends = useInvitableFriends(teamId);
  const pending = useTeamMemberInvites(teamId);
  const action = useTeamInviteAction();
  return (
    <section className="grid gap-3 rounded-2xl border border-line p-4" data-testid="invite-friends">
      <div>
        <h3 className="font-black text-content-strong">Invite friends</h3>
        <p className="text-sm text-content-muted">Your friend gets an invite in the app and joins with one tap. Invites expire after 14 days.</p>
      </div>
      <FormError message={friends.error?.message ?? action.error?.message} />
      {friends.data?.length === 0 && <p className="text-sm text-content-muted">Add friends in Social to invite them here.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {friends.data?.map(({ player, status, inviteId }) => (
          <div key={player.id} className="flex items-center gap-3 rounded-xl bg-surface-muted p-3">
            <Avatar user={player} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-content-strong">{player.displayName}</span>
            {status === 'MEMBER' && <span className="text-[11px] font-black uppercase text-content-muted">In team</span>}
            {status === 'INVITED' && (
              <button type="button" className="text-[11px] font-black uppercase text-content-muted hover:text-content-strong" onClick={() => action.mutate({ kind: 'cancel', teamId, inviteId: inviteId! })}>
                Invited · Cancel
              </button>
            )}
            {status === 'INVITABLE' && (
              <button type="button" className="text-[11px] font-black uppercase text-brand-700 hover:underline" disabled={action.isPending} onClick={() => action.mutate({ kind: 'invite', teamId, userId: player.id })}>
                Invite
              </button>
            )}
          </div>
        ))}
      </div>
      {pending.data?.some(({ source }) => source === 'LOOKING') && (
        <p className="text-xs text-content-muted">
          Also invited from "Players looking": {pending.data.filter(({ source }) => source === 'LOOKING').map(({ invitee }) => invitee.displayName).join(', ')}
        </p>
      )}
    </section>
  );
}
