import type { Conversation, DirectMessage } from '@footy-finder/shared';
import { AppError } from '../../errors/app-error.js';
import { toPublicUser } from '../users/user.mapper.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MessagingRepository } from './messaging.repository.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { prisma } from '../../database/prisma.js';
import { blockedEitherWay, isBlockedEitherWay } from '../social/visibility.js';

const messageDto = (message: any): DirectMessage => ({
  id: message.id,
  conversationId: message.conversationId,
  senderId: message.senderId,
  content: message.content,
  createdAt: message.createdAt.toISOString(),
  editedAt: message.editedAt?.toISOString(),
  deletedAt: message.deletedAt?.toISOString(),
  sender: message.sender ? toPublicUser(message.sender) : undefined,
});
const blockedMessage = () => new AppError(403, "You can't message this player.", 'MESSAGING_UNAVAILABLE');
const conversationDto = (conversation: any, userId: string, blocked = new Set<string>()): Conversation => {
  const membership = conversation.participants.find((item: any) => item.userId === userId);
  const other = conversation.participants.find((item: any) => item.userId !== userId)?.user;
  const latest = conversation.messages?.[0];
  return {
    id: conversation.id,
    otherParticipant: toPublicUser(other),
    latestMessage: latest ? messageDto(latest) : null,
    unread: Boolean(
      latest &&
      latest.senderId !== userId &&
      (!membership?.lastReadAt || latest.createdAt > membership.lastReadAt),
    ),
    canMessage: !blocked.has(other?.id),
    updatedAt: conversation.updatedAt.toISOString(),
    messages: conversation.messages?.map(messageDto),
  };
};
export class MessagingService {
  constructor(
    private readonly messages = new MessagingRepository(),
    private readonly notifications = new NotificationsService(),
  ) {}
  async start(userId: string, otherUserId: string) {
    if (userId === otherUserId)
      throw new AppError(400, 'You cannot message yourself.', 'INVALID_RECIPIENT');
    if (!(await this.messages.userExists(otherUserId)))
      throw new AppError(404, 'Player not found.', 'PLAYER_NOT_FOUND');
    if (await isBlockedEitherWay(prisma, userId, otherUserId)) throw blockedMessage();
    return conversationDto(await this.messages.start(userId, otherUserId), userId);
  }
  async list(userId: string) {
    const conversations = await this.messages.list(userId);
    const blocked = await this.blockedOthers(userId, conversations);
    return conversations.map((item) => conversationDto(item, userId, blocked));
  }
  async get(id: string, userId: string) {
    const conversation = await this.messages.find(id, userId);
    if (!conversation) throw new AppError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
    return conversationDto(conversation, userId, await this.blockedOthers(userId, [conversation]));
  }
  async send(id: string, userId: string, content: string) {
    const result = await this.messages.send(id, userId, content);
    if (!result)
      throw new AppError(403, 'You are not part of this conversation.', 'CONVERSATION_REQUIRED');
    if ('blocked' in result) throw blockedMessage();
    const dto = messageDto(result.message);
    emitDomainEventBestEffort('direct-message:created', {
      conversationId: id,
      recipientUserId: result.recipientUserId,
      message: dto,
    });
    this.notifications.publishPersistedMany(result.notifications);
    return dto;
  }
  private blockedOthers(userId: string, conversations: Array<{ participants: Array<{ userId: string }> }>) {
    const others = conversations.flatMap(({ participants }) => participants.map((item) => item.userId)).filter((id) => id !== userId);
    return blockedEitherWay(prisma, userId, others);
  }
  async markRead(id: string, userId: string) {
    if ((await this.messages.markRead(id, userId)).count !== 1)
      throw new AppError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
  }
}
