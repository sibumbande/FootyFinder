import type { TeamDetail } from '@footy-finder/shared';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { formatDate } from '@/utils/format-date.js';
import { useTeamInviteMutations, useTeamInvites } from '../hooks/useTeams.js';
import { InviteFriendsPanel } from '@/features/social/components/InviteFriendsPanel.js';
import { TeamRecruitmentPanel } from '@/features/social/components/TeamRecruitmentPanel.js';

export function TeamInvitePanel({ team }: { team: TeamDetail }) {
  const allowed = team.viewerRole === 'OWNER' || team.viewerRole === 'CAPTAIN';
  const invites = useTeamInvites(team.id, allowed);
  const actions = useTeamInviteMutations(team.id);
  const { notify } = useNotifications();
  if (!allowed) return null;
  const create = () =>
    actions.create.mutate(undefined, {
      onSuccess: async ({ data }) => {
        if (data.inviteUrl) await navigator.clipboard.writeText(data.inviteUrl);
        notify({
          variant: 'success',
          title: 'Invite created',
          message: 'The single-use invite link was copied and expires in seven days.',
        });
      },
    });
  return (
    <section className="grid gap-5">
      <InviteFriendsPanel teamId={team.id} />
      <TeamRecruitmentPanel team={team} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-content-strong">Team invitations</h2>
          <p className="text-sm text-content-muted">
            Links are single-use, securely hashed, and expire after seven days.
          </p>
        </div>
        <Button onClick={create} loading={actions.create.isPending}>
          Invite Player
        </Button>
      </div>
      <FormError
        message={
          invites.error?.message ?? actions.create.error?.message ?? actions.revoke.error?.message
        }
      />
      <div className="grid gap-3">
        {invites.data?.map((invite) => (
          <article
            key={invite.id}
            className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-muted p-4 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="font-bold text-content-strong">{invite.status}</p>
              <p className="text-sm text-content-muted">
                Created by {invite.createdBy.displayName} · expires {formatDate(invite.expiresAt)}
              </p>
            </div>
            {invite.status === 'ACTIVE' && (
              <Button
                variant="secondary"
                loading={actions.revoke.isPending}
                onClick={() =>
                  actions.revoke.mutate(invite.id, {
                    onSuccess: () =>
                      notify({
                        variant: 'info',
                        title: 'Invite revoked',
                        message: 'The link can no longer be accepted.',
                      }),
                  })
                }
              >
                Revoke
              </Button>
            )}
          </article>
        ))}
        {invites.data?.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-content-muted">
            No invitations created yet.
          </p>
        )}
      </div>
    </section>
  );
}
