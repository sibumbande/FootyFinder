import { Prisma } from '../../generated/prisma/client.js';
import { safeUserInclude } from '../users/users.repository.js';

export const participantInclude = {
  user: { include: safeUserInclude },
} satisfies Prisma.MatchParticipantInclude;
export const matchInclude = {
  venue: true,
  createdBy: { include: safeUserInclude },
  participants: {
    where: { status: 'JOINED' },
    include: participantInclude,
    orderBy: { joinedAt: 'asc' },
  },
  formationSlots: {
    include: { participant: { include: participantInclude } },
    orderBy: [{ team: 'asc' }, { slotIndex: 'asc' }],
  },
  result: {
    include: {
      scorers: { include: { participant: { include: participantInclude } } },
      revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 },
    },
  },
  teamSides: { orderBy: { side: 'asc' } },
} satisfies Prisma.MatchInclude;

export type MatchRecord = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;
export type ParticipantRecord = Prisma.MatchParticipantGetPayload<{
  include: typeof participantInclude;
}>;
