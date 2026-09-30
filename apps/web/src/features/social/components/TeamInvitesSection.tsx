import { FormError } from '@/components/ui/FormError.js';
import { useMyTeamInvites, useTeamInviteAction } from '../hooks/useSocial.js';

/** Gate 9 / TKT-904: team invites waiting for you; accept or decline in one tap. */
export function TeamInvitesSection() {
  const invites = useMyTeamInvites();
  const action = useTeamInviteAction();
  if (!invites.data?.length) return null;
  return (
    <section className="grid gap-3" data-testid="team-invites">
      <h2 className="text-xs font-black uppercase tracking-[0.12em] text-content-muted">Team invites ({invites.data.length})</h2>
      <FormError message={action.error?.message} />
      {invites.data.map((invite) => (
        <article key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
          <p className="text-sm text-content">
            <strong className="text-content-strong">{invite.invitedBy.displayName}</strong> invited you to join{' '}
            <strong className="text-content-strong">{invite.team.name}</strong>.
          </p>
          <span className="flex gap-2">
            <button type="button" className="button" disabled={action.isPending} onClick={() => action.mutate({ kind: 'accept', inviteId: invite.id })}>
              Join team
            </button>
            <button type="button" className="button-secondary" disabled={action.isPending} onClick={() => action.mutate({ kind: 'decline', inviteId: invite.id })}>
              Decline
            </button>
          </span>
        </article>
      ))}
    </section>
  );
}
