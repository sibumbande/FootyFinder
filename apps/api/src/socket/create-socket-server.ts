import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { SocketEvents } from '@footy-finder/shared';
import { allowedOrigins } from '../config/cors.js';
import { domainEvents } from '../events/domain-events.js';
import { AUTH_COOKIE_NAME, TokenService } from '../modules/auth/token.service.js';
import { registerChatGateway } from '../modules/chat/chat.gateway.js';
import { registerTeamGateway } from '../modules/teams/team.gateway.js';
const tokens = new TokenService();
const cookieValue = (header: string | undefined, name: string) =>
  header
    ?.split(';')
    .map((item) => item.trim().split('='))
    .find(([key]) => key === name)?.[1];
export function createSocketServer(server: HttpServer) {
  const io = new Server(server, {
    cors: { origin: allowedOrigins, credentials: true, methods: ['GET', 'POST'] },
  });
  io.use((socket, next) => {
    try {
      const token =
        typeof socket.handshake.auth.token === 'string'
          ? socket.handshake.auth.token
          : cookieValue(socket.handshake.headers.cookie, AUTH_COOKIE_NAME);
      if (!token) throw new Error('Missing session');
      socket.data.userId = tokens.verify(token).sub;
      next();
    } catch {
      next(new Error('Authentication required.'));
    }
  });
  registerChatGateway(io);
  registerTeamGateway(io);
  domainEvents.on('participant:joined', (payload) =>
    io.to(`match:${payload.matchId}`).emit(SocketEvents.participantJoined, payload.participant),
  );
  domainEvents.on('participant:left', (payload) =>
    io.to(`match:${payload.matchId}`).emit(SocketEvents.participantLeft, payload),
  );
  domainEvents.on('participant:team-changed', (payload) =>
    io
      .to(`match:${payload.matchId}`)
      .emit(SocketEvents.participantTeamChanged, payload.participant),
  );
  domainEvents.on('formation:updated', (payload) =>
    io.to(`match:${payload.matchId}`).emit(SocketEvents.formationUpdated, payload.slots),
  );
  domainEvents.on('lobby-message:created', (payload) =>
    io.to(`match:${payload.matchId}`).emit(SocketEvents.messageCreated, payload.message),
  );
  domainEvents.on('match:started', (payload) =>
    io.to(`match:${payload.matchId}`).emit(SocketEvents.matchStarted, payload),
  );
  domainEvents.on('match:ended', (payload) =>
    io.to(`match:${payload.matchId}`).emit(SocketEvents.matchEnded, payload),
  );
  domainEvents.on('match:result-submitted', (payload) => {
    io.to(`match:${payload.matchId}`).emit(SocketEvents.matchResultSubmitted, payload.result);
    io.to(`match:${payload.matchId}`).emit(SocketEvents.matchCompleted, payload.result);
  });
  domainEvents.on('match-availability:requested', (payload) =>
    io.to(`match:${payload.matchId}`).emit(SocketEvents.matchAvailabilityRequested, payload),
  );
  domainEvents.on('match-availability:updated', (payload) =>
    io.to(`match:${payload.matchId}`).emit(SocketEvents.matchAvailabilityUpdated, payload),
  );
  domainEvents.on('match-lineup:changed', (payload) => {
    const event =
      payload.reason === 'POSITION_OPENED'
        ? SocketEvents.matchLineupPositionOpened
        : payload.reason === 'POSITION_CLAIMED'
          ? SocketEvents.matchLineupPositionClaimed
          : payload.reason === 'MOVEMENT'
            ? SocketEvents.matchLineupSlotMoved
            : payload.reason === 'FINALIZED'
              ? SocketEvents.matchLineupFinalized
              : payload.reason === 'DEFAULT_SAVED'
                ? SocketEvents.matchLineupDefaultSaved
                : SocketEvents.matchLineupSelectionUpdated;
    io.to(`match:${payload.matchId}`).emit(event, {
      matchId: payload.matchId,
      side: payload.side,
    });
  });
  domainEvents.on('direct-message:created', (payload) => {
    io.to(`user:${payload.recipientUserId}`).emit(
      SocketEvents.directMessageCreated,
      payload.message,
    );
    io.to(`user:${payload.message.senderId}`).emit(
      SocketEvents.directMessageCreated,
      payload.message,
    );
  });
  domainEvents.on('notification:created', (payload) =>
    io.to(`user:${payload.userId}`).emit(SocketEvents.notificationCreated, payload.notification),
  );
  domainEvents.on('team:member-joined', (payload) =>
    io.to(`team:${payload.teamId}`).emit(SocketEvents.teamMemberJoined, payload.member),
  );
  domainEvents.on('team:member-removed', (payload) =>
    io.to(`team:${payload.teamId}`).emit(SocketEvents.teamMemberRemoved, payload),
  );
  domainEvents.on('team:details-updated', (payload) =>
    io.to(`team:${payload.teamId}`).emit(SocketEvents.teamDetailsUpdated, payload.team),
  );
  domainEvents.on('team:formation-updated', (payload) =>
    io.to(`team:${payload.teamId}`).emit(SocketEvents.teamFormationUpdated, payload),
  );
  return io;
}
