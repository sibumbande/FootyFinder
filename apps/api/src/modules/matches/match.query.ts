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
      // Gate 8 / TKT-804: referee-final goals, with scorer and assister from the lineup record.
      goals: {
        orderBy: { sortOrder: 'asc' },
        include: {
          scorer: { select: { userId: true, displayNameSnapshot: true } },
          assist: { select: { userId: true, displayNameSnapshot: true } },
        },
      },
    },
  },
  teamSides: { orderBy: { side: 'asc' } },
  // CEO touch-up batch 3, item 1: the venue's cover photo and page (never its prices or policies).
  fieldReservation: { select: { field: { select: { venue: { select: { slug: true, coverImageUrl: true, coverImageAlt: true } } } } } },
  // Gate 8 / D18: players see the referee's display name only.
  referee: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
} satisfies Prisma.MatchInclude;

export type MatchRecord = Prisma.MatchGetPayload<{ include: typeof matchInclude }>;
export type ParticipantRecord = Prisma.MatchParticipantGetPayload<{
  include: typeof participantInclude;
}>;
