import {
  sendDirectMessageSchema,
  sendLobbyMessageSchema,
  SocketEvents,
} from '@footy-finder/shared';
import type { Server, Socket } from 'socket.io';
import { MessagingService } from '../messaging/messaging.service.js';
import { ChatService } from './chat.service.js';
const room = (matchId: string) => `match:${matchId}`;
export function registerChatGateway(io: Server) {
  const chat = new ChatService();
  const messaging = new MessagingService();
  io.on('connection', (socket: Socket) => {
    const userId = String(socket.data.userId);
    socket.join(`user:${userId}`);
    socket.on(SocketEvents.joinRoom, async ({ matchId }: { matchId: string }) => {
      try {
        await chat.history(matchId, userId);
        await socket.join(room(matchId));
      } catch (error) {
        socket.emit('error', {
          message: error instanceof Error ? error.message : 'Unable to join match room.',
        });
      }
    });
    socket.on(SocketEvents.leaveRoom, ({ matchId }: { matchId: string }) =>
      socket.leave(room(matchId)),
    );
    socket.on(SocketEvents.sendMessage, async (payload: { matchId: string; content: string }) => {
      try {
        const { content } = sendLobbyMessageSchema.parse(payload);
        await chat.send(payload.matchId, userId, content);
      } catch (error) {
        socket.emit('error', {
          message: error instanceof Error ? error.message : 'Unable to send message.',
        });
      }
    });
    socket.on(
      SocketEvents.directMessageSend,
      async (payload: { conversationId: string; content: string }) => {
        try {
          const { content } = sendDirectMessageSchema.parse(payload);
          await messaging.send(payload.conversationId, userId, content);
        } catch (error) {
          socket.emit('error', {
            message: error instanceof Error ? error.message : 'Unable to send message.',
          });
        }
      },
    );
  });
}
