import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { appendAdminAudit } from '../src/modules/admin/admin-audit.js';

const marker = `slice-8-${randomUUID()}`;
const tag = randomUUID().slice(0, 8);
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
let mismatchBlocked = false;
let immutableBlocked = false;
const walletRowsBefore = await prisma.walletTransaction.count();

try {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email: `${marker}-check@smoke.invalid`, username: `s8-${tag}-check`, passwordHash: 'smoke' } });
    await tx.dispute.create({ data: {
      openedByUserId: user.id,
      type: 'FIELD_BOOKING',
      referenceId: randomUUID(),
      reason: 'FIELD_QUALITY',
      details: marker,
      evidenceSnapshot: {},
      status: 'RESOLVED',
      resolutionOutcome: 'RESULT_CONFIRMED',
      resolutionSummary: 'Invalid cross-domain outcome.',
      resolvedAt: new Date(),
    } });
  });
} catch (error) {
  mismatchBlocked = String(error).includes('Dispute_outcome_type_check');
}

try {
  await prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({ data: { email: `${marker}-admin@smoke.invalid`, username: `s8-${tag}-a`, passwordHash: 'smoke', platformRole: 'ADMIN' } });
    const host = await tx.user.create({ data: { email: `${marker}-host@smoke.invalid`, username: `s8-${tag}-h`, passwordHash: 'smoke' } });
    const player = await tx.user.create({ data: { email: `${marker}-player@smoke.invalid`, username: `s8-${tag}-p`, passwordHash: 'smoke' } });
    const venue = await tx.venue.create({ data: { name: marker, addressLine1: '1 Test Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA' } });
    const match = await tx.match.create({ data: { name: `${marker}-result`, createdById: host.id, venueId: venue.id, format: 'FIVE_A_SIDE', visibility: 'PUBLIC', startsAt: new Date(Date.now() - 3_600_000), durationMinutes: 50, feeCents: 0, status: 'COMPLETED' } });
    const home = await tx.matchParticipant.create({ data: { matchId: match.id, userId: host.id, team: 'HOME' } });
    await tx.matchParticipant.create({ data: { matchId: match.id, userId: player.id, team: 'AWAY' } });
    const result = await tx.matchResult.create({ data: { matchId: match.id, homeScore: 1, awayScore: 0, submittedById: host.id } });
    await tx.matchScorer.create({ data: { matchResultId: result.id, participantId: home.id, team: 'HOME', goals: 1 } });
    const revisionOne = await tx.matchResultRevision.create({ data: { matchResultId: result.id, revisionNumber: 1, homeScore: 1, awayScore: 0, scorersSnapshot: [{ participantId: home.id, team: 'HOME', goals: 1 }], reason: 'INITIAL_SUBMISSION' } });
    const resultDispute = await tx.dispute.create({ data: { openedByUserId: player.id, type: 'MATCH_RESULT', referenceId: result.id, reason: 'INCORRECT_SCORE', details: marker, evidenceSnapshot: { matchId: match.id, homeScore: 1, awayScore: 0 } } });

    const managedVenue = await tx.managedVenue.create({ data: { name: marker, addressLine1: '2 Test Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA' } });
    const field = await tx.managedField.create({ data: { venueId: managedVenue.id, name: 'Court A' } });
    const price = await tx.managedFieldPrice.create({ data: { fieldId: field.id, amountCents: 80000, effectiveFrom: new Date(Date.now() - 60_000) } });
    const bookingMatch = await tx.match.create({ data: { name: `${marker}-booking`, createdById: player.id, venueId: venue.id, format: 'FIVE_A_SIDE', visibility: 'PUBLIC', startsAt: new Date(Date.now() + 86_400_000), durationMinutes: 50, feeCents: 0, status: 'OPEN' } });
    const reservation = await tx.fieldReservation.create({ data: { fieldId: field.id, fieldPriceId: price.id, matchId: bookingMatch.id, source: 'PLAYER_BOOKING', status: 'CONFIRMED', startsAt: bookingMatch.startsAt, endsAt: new Date(bookingMatch.startsAt.getTime() + 50 * 60_000), priceCentsSnapshot: 80000, venueNameSnapshot: marker, fieldNameSnapshot: field.name, addressSnapshot: '2 Test Road', citySnapshot: 'Cape Town', confirmedAt: new Date() } });
    await tx.dispute.create({ data: { openedByUserId: player.id, type: 'FIELD_BOOKING', referenceId: reservation.id, reason: 'FIELD_QUALITY', details: marker, evidenceSnapshot: { reservationId: reservation.id, priceCents: 80000 } } });

    await tx.matchScorer.deleteMany({ where: { matchResultId: result.id } });
    await tx.matchScorer.create({ data: { matchResultId: result.id, participantId: home.id, team: 'HOME', goals: 2 } });
    await tx.matchResult.update({ where: { id: result.id }, data: { homeScore: 2, awayScore: 0 } });
    await tx.matchResultRevision.create({ data: { matchResultId: result.id, revisionNumber: 2, homeScore: 2, awayScore: 0, scorersSnapshot: [{ participantId: home.id, team: 'HOME', goals: 2 }], reason: 'ADMIN_CORRECTION', createdByAdminUserId: admin.id } });
    await tx.dispute.update({ where: { id: resultDispute.id }, data: { status: 'RESOLVED', assignedAdminUserId: admin.id, resolutionOutcome: 'RESULT_CORRECTED', resolutionSummary: 'Evidence supports the corrected final score.', resolvedAt: new Date() } });
    await tx.notification.create({ data: { userId: player.id, type: 'DISPUTE_RESOLVED', title: 'Dispute resolved', message: 'Evidence supports the corrected final score.', dedupeKey: `${marker}:resolved` } });
    await appendAdminAudit(tx, { actorUserId: admin.id, action: 'DISPUTE_RESOLVED', entityType: 'DISPUTE', entityId: resultDispute.id, requestId: marker });
    const revisions = await tx.matchResultRevision.findMany({ where: { matchResultId: result.id }, orderBy: { revisionNumber: 'asc' } });
    assert(revisions.length === 2 && revisions[0]?.homeScore === 1 && revisions[1]?.homeScore === 2, 'Result revision history was not preserved.');
    assert((await tx.matchResult.findUniqueOrThrow({ where: { id: result.id } })).homeScore === 2, 'Current result projection was not corrected.');
    assert(await tx.walletTransaction.count() === walletRowsBefore, 'Booking adjudication mutated wallet history.');
    await tx.matchResultRevision.update({ where: { id: revisionOne.id }, data: { homeScore: 99 } });
  });
} catch (error) {
  immutableBlocked = String(error).includes('append-only');
} finally {
  assert(mismatchBlocked, 'Database accepted a cross-domain dispute outcome.');
  assert(immutableBlocked, 'Database allowed an immutable result revision to change.');
  assert(await prisma.user.count({ where: { email: { startsWith: marker } } }) === 0, 'Dispute smoke users remained.');
  assert(await prisma.dispute.count({ where: { details: marker } }) === 0, 'Dispute smoke rows remained.');
  assert(await prisma.adminAuditLog.count({ where: { requestId: marker } }) === 0, 'Dispute smoke audit remained.');
  assert(await prisma.notification.count({ where: { dedupeKey: `${marker}:resolved` } }) === 0, 'Dispute smoke notification remained.');
  assert(await prisma.walletTransaction.count() === walletRowsBefore, 'Dispute smoke changed wallet history.');
  await prisma.$disconnect();
}

console.log('Slice 8 result revisions, dispute outcomes, wallet isolation, append-only enforcement, rollback, and exact cleanup smoke test passed.');
