import { prisma } from '../../database/prisma.js';
import { safeUserInclude } from '../users/users.repository.js';
export class ChatRepository {
  findMatch(matchId: string) {
    return prisma.match.findUnique({
      where: { id: matchId },
      include: { participants: { where: { status: 'JOINED' } } },
    });
  }
  listForMatch(matchId: string) {
    return prisma.lobbyMessage.findMany({
      where: { matchId },
      include: { sender: { include: safeUserInclude } },
      orderBy: { createdAt: 'asc' },
    });
  }
  create(matchId: string, senderId: string, content: string) {
    return prisma.lobbyMessage.create({
      data: { matchId, senderId, content },
      include: { sender: { include: safeUserInclude } },
    });
  }
}
