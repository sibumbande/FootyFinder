import { SocketEvents } from '@footy-finder/shared';
import type { Server, Socket } from 'socket.io';
import { TeamsRepository } from './teams.repository.js';

const room = (teamId: string) => `team:${teamId}`;

export function registerTeamGateway(io: Server) {
  const teams = new TeamsRepository();
  io.on('connection', (socket: Socket) => {
    const userId = String(socket.data.userId);
    socket.on(SocketEvents.joinTeamRoom, async ({ teamId }: { teamId: string }) => {
      if (await teams.findMembership(teamId, userId)) await socket.join(room(teamId));
    });
    socket.on(SocketEvents.leaveTeamRoom, ({ teamId }: { teamId: string }) =>
      socket.leave(room(teamId)),
    );
  });
}
