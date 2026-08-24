import { SocketEvents, type TeamMatchAvailabilityChangedEvent } from '@footy-finder/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ensureSocketConnected } from '@/socket/socket.js';
import { matchKey, matchesKey } from '@/features/matches/hooks/useMatches.js';
import {
  teamMatchAvailabilityRootKey,
  teamMatchLineupKey,
} from '@/features/matches/hooks/useTeamMatchDay.js';
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
    const refreshAvailability = ({ side }: TeamMatchAvailabilityChangedEvent) =>
      void cache.invalidateQueries({ queryKey: teamMatchAvailabilityRootKey(matchId, side) });
    const refreshLineup = ({ side }: TeamMatchAvailabilityChangedEvent) => {
      void cache.invalidateQueries({ queryKey: teamMatchLineupKey(matchId, side) });
      void cache.invalidateQueries({ queryKey: teamMatchAvailabilityRootKey(matchId, side) });
    };
    const refreshDefault = (payload: TeamMatchAvailabilityChangedEvent) => {
      refreshLineup(payload);
      void cache.invalidateQueries({ queryKey: ['teams'] });
    };
    const joinAndRecover = () => {
      socket.emit(SocketEvents.joinRoom, { matchId });
      refresh();
      refreshMessages();
    };
    joinAndRecover();
    socket.on('connect', joinAndRecover);
    socket.on(SocketEvents.participantJoined, refresh);
    socket.on(SocketEvents.participantLeft, refresh);
    socket.on(SocketEvents.participantTeamChanged, refresh);
    socket.on(SocketEvents.formationUpdated, refresh);
    socket.on(SocketEvents.matchStarted, refresh);
    socket.on(SocketEvents.matchEnded, refresh);
    socket.on(SocketEvents.matchResultSubmitted, refresh);
    socket.on(SocketEvents.matchCompleted, refresh);
    socket.on(SocketEvents.matchUpdated, refresh);
    socket.on(SocketEvents.matchReady, refresh);
    socket.on(SocketEvents.matchCancelled, refresh);
    socket.on(SocketEvents.messageCreated, refreshMessages);
    socket.on(SocketEvents.matchAvailabilityRequested, refreshAvailability);
    socket.on(SocketEvents.matchAvailabilityUpdated, refreshAvailability);
    socket.on(SocketEvents.matchLineupSelectionUpdated, refreshLineup);
    socket.on(SocketEvents.matchLineupPositionOpened, refreshLineup);
    socket.on(SocketEvents.matchLineupPositionClaimed, refreshLineup);
    socket.on(SocketEvents.matchLineupSlotMoved, refreshLineup);
    socket.on(SocketEvents.matchLineupFinalized, refreshLineup);
    socket.on(SocketEvents.matchLineupDefaultSaved, refreshDefault);
    return () => {
      socket.emit(SocketEvents.leaveRoom, { matchId });
      socket.off('connect', joinAndRecover);
      socket.off(SocketEvents.participantJoined, refresh);
      socket.off(SocketEvents.participantLeft, refresh);
      socket.off(SocketEvents.participantTeamChanged, refresh);
      socket.off(SocketEvents.formationUpdated, refresh);
      socket.off(SocketEvents.matchStarted, refresh);
      socket.off(SocketEvents.matchEnded, refresh);
      socket.off(SocketEvents.matchResultSubmitted, refresh);
      socket.off(SocketEvents.matchCompleted, refresh);
      socket.off(SocketEvents.matchUpdated, refresh);
      socket.off(SocketEvents.matchReady, refresh);
      socket.off(SocketEvents.matchCancelled, refresh);
      socket.off(SocketEvents.messageCreated, refreshMessages);
      socket.off(SocketEvents.matchAvailabilityRequested, refreshAvailability);
      socket.off(SocketEvents.matchAvailabilityUpdated, refreshAvailability);
      socket.off(SocketEvents.matchLineupSelectionUpdated, refreshLineup);
      socket.off(SocketEvents.matchLineupPositionOpened, refreshLineup);
      socket.off(SocketEvents.matchLineupPositionClaimed, refreshLineup);
      socket.off(SocketEvents.matchLineupSlotMoved, refreshLineup);
      socket.off(SocketEvents.matchLineupFinalized, refreshLineup);
      socket.off(SocketEvents.matchLineupDefaultSaved, refreshDefault);
    };
  }, [cache, matchId]);
}
