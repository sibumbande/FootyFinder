import type { LobbyMessage } from '@footy-finder/shared';
import { getMatchEndsAt } from '@footy-finder/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { domainEvents } from '../../events/domain-events.js';
import { toPublicUser } from '../users/user.mapper.js';
import { ChatRepository } from './chat.repository.js';
const mapMessage = (message: any): LobbyMessage => ({
  id: message.id,
  matchId: message.matchId,
  senderId: message.senderId,
  content: message.content,
  createdAt: message.createdAt.toISOString(),
  editedAt: message.editedAt?.toISOString(),
  deletedAt: message.deletedAt?.toISOString(),
  sender: message.sender ? toPublicUser(message.sender) : undefined,
});
export class ChatService {
  constructor(private readonly chat = new ChatRepository()) {}
  async history(matchId: string, userId: string) {
    await this.authorize(matchId, userId, false);
    return (await this.chat.listForMatch(matchId)).map(mapMessage);
  }
  async send(matchId: string, userId: string, content: string) {
    await this.authorize(matchId, userId, true);
    const message = mapMessage(await this.chat.create(matchId, userId, content));
    domainEvents.emit('lobby-message:created', { matchId, message });
    return message;
  }
  private async authorize(matchId: string, userId: string, sending: boolean) {
    const match = await this.chat.findMatch(matchId);
    if (!match) throw new AppError(404, 'Match not found.', 'MATCH_NOT_FOUND');
    if (
      match.createdById !== userId &&
      !match.participants.some((participant) => participant.userId === userId)
    )
      throw new AppError(403, 'Join this match to use lobby chat.', 'LOBBY_ACCESS_REQUIRED');
    const chatClosesAt = new Date(
      getMatchEndsAt({
        startsAt: match.startsAt,
        durationMinutes: match.durationMinutes,
      }).getTime() +
        env.POST_MATCH_CHAT_DURATION_MINUTES * 60_000,
    );
    if (sending && new Date() > chatClosesAt)
      throw new AppError(409, 'Post-match chat is closed.', 'CHAT_CLOSED');
  }
}
