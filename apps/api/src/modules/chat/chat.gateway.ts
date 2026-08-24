import {
  sendDirectMessageSchema,
  sendLobbyMessageSchema,
  SocketEvents,
} from '@footy-finder/shared';
import type { Server, Socket } from 'socket.io';
import { MessagingService } from '../messaging/messaging.service.js';
import { ChatService } from './chat.service.js';
import { publicSocketError } from '../../socket/socket-errors.js';
import { env } from '../../config/env.js';
import { rateLimitStore } from '../../middleware/rate-limit.js';
const room = (matchId: string) => `match:${matchId}`;
export function registerChatGateway(io: Server) {
  const chat = new ChatService();
  const messaging = new MessagingService();
  io.on('connection', (socket: Socket) => {
    const userId = String(socket.data.userId);
    socket.on(SocketEvents.joinRoom, async ({ matchId }: { matchId: string }) => {
      try {
        await chat.history(matchId, userId);
        await socket.join(room(matchId));
      } catch (error) {
        socket.emit(
          'error',
          publicSocketError(error, {
            code: 'MATCH_ROOM_FORBIDDEN',
            message: 'Unable to join that Match room.',
          }),
        );
      }
    });
    socket.on(SocketEvents.leaveRoom, ({ matchId }: { matchId: string }) =>
      socket.leave(room(matchId)),
    );
    socket.on(SocketEvents.sendMessage, async (payload: { matchId: string; content: string }) => {
      try {
        const rate = rateLimitStore.consume(
          `socket-match-message:user:${userId}`,
          env.RATE_LIMIT_MESSAGES_PER_MINUTE,
          60_000,
        );
        if (!rate.allowed)
          return socket.emit('error', {
            code: 'RATE_LIMITED',
            message: 'Too many messages. Please wait before trying again.',
          });
        const { content } = sendLobbyMessageSchema.parse(payload);
        await chat.send(payload.matchId, userId, content);
      } catch (error) {
        socket.emit(
          'error',
          publicSocketError(error, {
            code: 'MESSAGE_SEND_FAILED',
            message: 'Unable to send that message.',
          }),
        );
      }
    });
    socket.on(
      SocketEvents.directMessageSend,
      async (payload: { conversationId: string; content: string }) => {
        try {
          const rate = rateLimitStore.consume(
            `socket-direct-message:user:${userId}`,
            env.RATE_LIMIT_MESSAGES_PER_MINUTE,
            60_000,
          );
          if (!rate.allowed)
            return socket.emit('error', {
              code: 'RATE_LIMITED',
              message: 'Too many messages. Please wait before trying again.',
            });
          const { content } = sendDirectMessageSchema.parse(payload);
          await messaging.send(payload.conversationId, userId, content);
        } catch (error) {
          socket.emit(
            'error',
            publicSocketError(error, {
              code: 'DIRECT_MESSAGE_SEND_FAILED',
              message: 'Unable to send that message.',
            }),
          );
        }
      },
    );
  });
}
