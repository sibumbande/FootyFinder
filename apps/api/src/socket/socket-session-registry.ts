import type { Server, Socket } from 'socket.io';
import { SocketEvents } from '@footy-finder/shared';

const add = (map: Map<string, Set<string>>, key: string, socketId: string) => {
  const ids = map.get(key) ?? new Set<string>();
  ids.add(socketId);
  map.set(key, ids);
};

const remove = (map: Map<string, Set<string>>, key: string, socketId: string) => {
  const ids = map.get(key);
  if (!ids) return;
  ids.delete(socketId);
  if (!ids.size) map.delete(key);
};

export class SocketSessionRegistry {
  private readonly byUser = new Map<string, Set<string>>();
  private readonly bySession = new Map<string, Set<string>>();

  register(socket: Socket) {
    const userId = String(socket.data.userId);
    const sessionId = socket.data.sessionId ? String(socket.data.sessionId) : undefined;
    add(this.byUser, userId, socket.id);
    if (sessionId) add(this.bySession, sessionId, socket.id);
    socket.once('disconnect', () => {
      remove(this.byUser, userId, socket.id);
      if (sessionId) remove(this.bySession, sessionId, socket.id);
    });
  }

  async leaveUserRoom(io: Server, userId: string, room: string) {
    for (const socketId of this.byUser.get(userId) ?? [])
      await io.sockets.sockets.get(socketId)?.leave(room);
  }

  disconnectSession(io: Server, sessionId: string) {
    this.disconnectIds(io, this.bySession.get(sessionId));
  }

  disconnectUser(io: Server, userId: string) {
    this.disconnectIds(io, this.byUser.get(userId));
  }

  private disconnectIds(io: Server, ids: Set<string> | undefined) {
    for (const socketId of [...(ids ?? [])]) {
      const socket = io.sockets.sockets.get(socketId);
      socket?.emit(SocketEvents.sessionRevoked, {
        code: 'SESSION_REVOKED',
        message: 'Your session has ended.',
      });
      socket?.disconnect(true);
    }
  }
}

export const socketSessionRegistry = new SocketSessionRegistry();
