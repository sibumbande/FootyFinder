import { SocketEvents } from '@footy-finder/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ensureSocketConnected } from '@/socket/socket.js';
import { matchKey, matchesKey } from '@/features/matches/hooks/useMatches.js';
export function useMatchSocket(matchId?: string) {
  const cache = useQueryClient();
  useEffect(() => {
    if (!matchId) return;
    const socket = ensureSocketConnected();
    const refresh = () => {
      void cache.invalidateQueries({ queryKey: matchKey(matchId) });
      void cache.invalidateQueries({ queryKey: matchesKey });
    };
    const refreshMessages = () =>
      void cache.invalidateQueries({ queryKey: [...matchKey(matchId), 'messages'] });
    socket.emit(SocketEvents.joinRoom, { matchId });
    socket.on(SocketEvents.participantJoined, refresh);
    socket.on(SocketEvents.participantLeft, refresh);
    socket.on(SocketEvents.participantTeamChanged, refresh);
    socket.on(SocketEvents.formationUpdated, refresh);
    socket.on(SocketEvents.matchStarted, refresh);
    socket.on(SocketEvents.matchEnded, refresh);
    socket.on(SocketEvents.matchResultSubmitted, refresh);
    socket.on(SocketEvents.matchCompleted, refresh);
    socket.on(SocketEvents.messageCreated, refreshMessages);
    return () => {
      socket.emit(SocketEvents.leaveRoom, { matchId });
      socket.off(SocketEvents.participantJoined, refresh);
      socket.off(SocketEvents.participantLeft, refresh);
      socket.off(SocketEvents.participantTeamChanged, refresh);
      socket.off(SocketEvents.formationUpdated, refresh);
      socket.off(SocketEvents.matchStarted, refresh);
      socket.off(SocketEvents.matchEnded, refresh);
      socket.off(SocketEvents.matchResultSubmitted, refresh);
      socket.off(SocketEvents.matchCompleted, refresh);
      socket.off(SocketEvents.messageCreated, refreshMessages);
    };
  }, [cache, matchId]);
}
