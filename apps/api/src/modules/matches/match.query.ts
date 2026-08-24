import { Prisma } from '@prisma/client';
import { safeUserInclude } from '../users/users.repository.js';

export const participantInclude = Prisma.validator<Prisma.MatchParticipantInclude>()({
  user: { include: safeUserInclude },
});
export const matchInclude = Prisma.validator<Prisma.MatchInclude>()({
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
});

export type MatchRecord = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;
export type ParticipantRecord = Prisma.MatchParticipantGetPayload<{
  include: typeof participantInclude;
}>;
