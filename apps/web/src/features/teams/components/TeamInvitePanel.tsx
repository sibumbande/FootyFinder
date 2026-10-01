import type { TeamDetail } from '@footy-finder/shared';
import { useEffect, useRef, useState } from 'react';
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
  // CEO touch-up batch 2, item 6: the new link is shown on screen (only the hash is stored, so it can
  // only be shown right after it is created) with Copy, Share and Replace.
  const [shown, setShown] = useState<{ id: string; url: string }>();
  if (!allowed) return null;
  const create = () =>
    actions.create.mutate(undefined, {
      onSuccess: ({ data }) => {
        if (data.inviteUrl) setShown({ id: data.id, url: data.inviteUrl });
      },
    });
  const replace = () => {
    if (!shown || !window.confirm('Replace this link? The current link will stop working.')) return;
    actions.revoke.mutate(shown.id, { onSuccess: create });
  };
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
      {shown && <InviteLinkBox url={shown.url} onReplace={replace} replacing={actions.revoke.isPending || actions.create.isPending} />}
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

function InviteLinkBox({ url, onReplace, replacing }: { url: string; onReplace: () => void; replacing: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => setCopied(false), [url]);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers or a denied permission: select the text and fall back to the copy command.
      input.current?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
  };
  const share = () => navigator.share({ title: 'Join my team on FootyFinder', text: 'Join my team on FootyFinder.', url }).catch(() => undefined);
  return (
    <div className="grid gap-3 rounded-2xl border-2 border-brand-200 bg-brand-50 p-4" data-testid="invite-link-box">
      <label className="grid gap-2 text-xs font-black uppercase tracking-[0.08em] text-content">
        Invite link
        <input
          ref={input}
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="h-12 w-full min-w-0 rounded-md border-2 border-line-strong bg-surface px-3.5 text-sm font-semibold normal-case tracking-normal text-content-strong"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={copy}>{copied ? 'Copied!' : 'Copy'}</Button>
        {canShare && <Button variant="secondary" onClick={share}>Share</Button>}
        <Button variant="secondary" onClick={onReplace} loading={replacing}>Replace link</Button>
        <span role="status" aria-live="polite" className="sr-only">{copied ? 'Invite link copied' : ''}</span>
      </div>
      <p className="text-sm text-content-muted">Single-use, expires in seven days. For security we can only show the link now; if you lose it, replace it.</p>
    </div>
  );
}
