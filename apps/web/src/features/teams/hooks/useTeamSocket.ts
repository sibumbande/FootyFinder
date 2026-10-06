import { SocketEvents } from '@footy-finder/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ensureSocketConnected } from '@/socket/socket.js';
import { myTeamsKey, teamFormationKey, teamKey } from './useTeams.js';
import { teamChatKey } from './useTeamChat.js';
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
    // Gate 7 / TKT-711: a new team chat message arrived in the team room.
    const refreshChat = () => void cache.invalidateQueries({ queryKey: teamChatKey(teamId) });
    const joinAndRecover = () => {
      socket.emit(SocketEvents.joinTeamRoom, { teamId });
      refresh();
      refreshFormation();
    };
    joinAndRecover();
    socket.on('connect', joinAndRecover);
    socket.on(SocketEvents.teamMemberJoined, refresh);
    socket.on(SocketEvents.teamMemberRemoved, refresh);
    socket.on(SocketEvents.teamDetailsUpdated, refresh);
    socket.on(SocketEvents.teamFormationUpdated, refreshFormation);
    socket.on(SocketEvents.teamMemberRoleUpdated, refresh);
    socket.on(SocketEvents.teamDeleted, refresh);
    socket.on(SocketEvents.teamChatMessage, refreshChat);
    return () => {
      socket.emit(SocketEvents.leaveTeamRoom, { teamId });
      socket.off('connect', joinAndRecover);
      socket.off(SocketEvents.teamMemberJoined, refresh);
      socket.off(SocketEvents.teamMemberRemoved, refresh);
      socket.off(SocketEvents.teamDetailsUpdated, refresh);
      socket.off(SocketEvents.teamFormationUpdated, refreshFormation);
      socket.off(SocketEvents.teamMemberRoleUpdated, refresh);
      socket.off(SocketEvents.teamDeleted, refresh);
      socket.off(SocketEvents.teamChatMessage, refreshChat);
    };
  }, [cache, format, teamId]);
}
