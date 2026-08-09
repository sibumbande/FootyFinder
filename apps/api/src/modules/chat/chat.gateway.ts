import type { Server, Socket } from 'socket.io'; import { SocketEvents } from '@footy-finder/shared';
const room = (matchId: string) => `match:${matchId}`;
export function registerChatGateway(io: Server) { io.on('connection', (socket: Socket) => { socket.on(SocketEvents.joinRoom, ({ matchId }: { matchId: string }) => socket.join(room(matchId))); socket.on(SocketEvents.leaveRoom, ({ matchId }: { matchId: string }) => socket.leave(room(matchId))); socket.on(SocketEvents.sendMessage, () => { socket.emit('error', { message: 'Message persistence is not implemented yet' }); }); }); }
