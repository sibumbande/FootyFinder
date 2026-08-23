import { SocketEvents } from '@footy-finder/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ensureSocketConnected } from '@/socket/socket.js';
import { myTeamsKey, teamFormationKey, teamKey } from './useTeams.js';
import type { MatchFormat } from '@footy-finder/shared';

export function useTeamSocket(teamId: string, format?: MatchFormat) {
  const cache = useQueryClient();
  useEffect(() => {
    if (!teamId) return;
    const socket = ensureSocketConnected();
    const refresh = () => {
      void cache.invalidateQueries({ queryKey: teamKey(teamId) });
      void cache.invalidateQueries({ queryKey: myTeamsKey });
    };
    const refreshFormation = () => {
      void cache.invalidateQueries({
        queryKey: format ? teamFormationKey(teamId, format) : [...teamKey(teamId), 'formation'],
      });
      refresh();
    };
    socket.emit(SocketEvents.joinTeamRoom, { teamId });
    socket.on(SocketEvents.teamMemberJoined, refresh);
    socket.on(SocketEvents.teamMemberRemoved, refresh);
    socket.on(SocketEvents.teamDetailsUpdated, refresh);
    socket.on(SocketEvents.teamFormationUpdated, refreshFormation);
    return () => {
      socket.emit(SocketEvents.leaveTeamRoom, { teamId });
      socket.off(SocketEvents.teamMemberJoined, refresh);
      socket.off(SocketEvents.teamMemberRemoved, refresh);
      socket.off(SocketEvents.teamDetailsUpdated, refresh);
      socket.off(SocketEvents.teamFormationUpdated, refreshFormation);
    };
  }, [cache, format, teamId]);
}
