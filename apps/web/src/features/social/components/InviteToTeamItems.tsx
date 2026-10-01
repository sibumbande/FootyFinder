import { menuItemClass } from '@/components/ui/ActionMenu.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { useTeamInviteAction } from '../hooks/useSocial.js';

/** The teams the signed-in player owns or captains (the ones they can invite to). */
export function useInvitableTeams() {
  const { user } = useAuth();
  return (user?.teams ?? []).filter(({ role }) => role === 'OWNER' || role === 'CAPTAIN');
}

/**
 * CEO touch-up batch 3, item 9: "Invite to team" items inside a card's "⋯" menu, one per team you own or
 * captain (team names wrap). The outcome is confirmed with a toast.
 */
export function InviteToTeamItems({ userId, playerName, source = 'FRIEND', close }: { userId: string; playerName: string; source?: 'FRIEND' | 'LOOKING'; close: () => void }) {
  const teams = useInvitableTeams();
  const action = useTeamInviteAction();
  const { notify } = useNotifications();
  return (
    <>
      {teams.map((team) => (
        <button
          key={team.id}
          type="button"
          role="menuitem"
          className={menuItemClass}
          disabled={action.isPending}
          onClick={() => {
            close();
            action.mutate(
              { kind: 'invite', teamId: team.id, userId, source },
              {
                onSuccess: () => notify({ variant: 'success', title: 'Invite sent', message: `${playerName} was invited to ${team.name}.` }),
                onError: (error) => notify({ variant: 'error', title: 'Invite not sent', message: error.message }),
              },
            );
          }}
        >
          <span className="[overflow-wrap:anywhere]">Invite to {team.name}</span>
        </button>
      ))}
    </>
  );
}
