import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { AppError } from '../src/errors/app-error.js';
import { appendAdminAudit } from '../src/modules/admin/admin-audit.js';
import { ModerationService } from '../src/modules/moderation/moderation.service.js';

const marker = `slice-7-${randomUUID()}`;
const tag = randomUUID().slice(0, 8);
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const service = new ModerationService();
let reporterId = '';
let targetId = '';
let reportId = '';

try {
  const [reporter, target] = await prisma.$transaction([
    prisma.user.create({ data: { email: `${marker}-reporter@smoke.invalid`, username: `s7-${tag}-r`, passwordHash: 'smoke' } }),
    prisma.user.create({ data: { email: `${marker}-target@smoke.invalid`, username: `s7-${tag}-t`, passwordHash: 'smoke' } }),
  ]);
  reporterId = reporter.id;
  targetId = target.id;
  const report = await service.createReport(reporter.id, {
    targetType: 'USER',
    targetId: target.id,
    reason: 'SAFETY',
    details: 'Smoke safety report.',
  });
  reportId = report.id;
  const stored = await prisma.moderationReport.findUniqueOrThrow({ where: { id: report.id } });
  assert((stored.evidenceSnapshot as { userId?: string }).userId === target.id, 'Evidence snapshot did not preserve the target identity.');
  const mine = await service.listMine(reporter.id);
  assert(mine.length === 1 && !('evidenceSnapshot' in mine[0]!), 'Player report history exposed internal evidence.');
  let selfRejected = false;
  try {
    await service.createReport(reporter.id, { targetType: 'USER', targetId: reporter.id, reason: 'OTHER' });
  } catch (error) {
    selfRejected = error instanceof AppError && error.code === 'REPORT_SELF_NOT_ALLOWED';
  }
  assert(selfRejected, 'Self-report was not rejected with the stable error.');

  let constraintBlocked = false;
  try {
    await prisma.$transaction(async (tx) => {
      const admin = await tx.user.create({ data: { email: `${marker}-constraint-admin@smoke.invalid`, username: `s7-${tag}-ca`, passwordHash: 'smoke', platformRole: 'ADMIN' } });
      const player = await tx.user.create({ data: { email: `${marker}-constraint-player@smoke.invalid`, username: `s7-${tag}-cp`, passwordHash: 'smoke' } });
      await tx.accountEnforcement.create({ data: { userId: player.id, type: 'BAN', publicReason: 'First', createdByAdminUserId: admin.id } });
      await tx.accountEnforcement.create({ data: { userId: player.id, type: 'SUSPENSION', publicReason: 'Second', endsAt: new Date(Date.now() + 60_000), createdByAdminUserId: admin.id } });
    });
  } catch (error) {
    constraintBlocked = String(error).includes('Unique constraint failed') || String(error).includes('AccountEnforcement_one_active_per_user');
  }
  assert(constraintBlocked, 'Database allowed two active enforcements for one player.');

  let rollbackProved = false;
  try {
    await prisma.$transaction(async (tx) => {
      const admin = await tx.user.create({ data: { email: `${marker}-admin@smoke.invalid`, username: `s7-${tag}-a`, passwordHash: 'smoke', platformRole: 'ADMIN' } });
      const player = await tx.user.create({ data: { email: `${marker}-player@smoke.invalid`, username: `s7-${tag}-p`, passwordHash: 'smoke' } });
      await tx.authSession.create({ data: { userId: player.id, expiresAt: new Date(Date.now() + 60_000) } });
      const enforcement = await tx.accountEnforcement.create({ data: { userId: player.id, type: 'SUSPENSION', publicReason: 'Temporary safety review.', endsAt: new Date(Date.now() + 60_000), createdByAdminUserId: admin.id } });
      await tx.user.update({ where: { id: player.id }, data: { accountStatus: 'SUSPENDED' } });
      const revoked = await tx.authSession.updateMany({ where: { userId: player.id, revokedAt: null }, data: { revokedAt: new Date() } });
      assert(revoked.count === 1, 'Enforcement did not revoke the active session.');
      await tx.durableJob.create({ data: { type: 'ACCOUNT_SUSPENSION_EXPIRE', dedupeKey: `${marker}:expire`, payload: { enforcementId: enforcement.id }, runAt: enforcement.endsAt! } });
      const audit = await appendAdminAudit(tx, { actorUserId: admin.id, action: 'PLAYER_SUSPENDED', entityType: 'USER', entityId: player.id, requestId: marker });
      await tx.$executeRaw`UPDATE "AdminAuditLog" SET "action" = 'TAMPERED' WHERE "id" = ${audit.id}::uuid`;
    });
  } catch (error) {
    rollbackProved = String(error).includes('append-only');
  }
  assert(rollbackProved, 'Atomic audit rollback was not proven.');
  assert(await prisma.adminAuditLog.count({ where: { requestId: marker } }) === 0, 'Rolled-back audit remained.');
  assert(await prisma.durableJob.count({ where: { dedupeKey: `${marker}:expire` } }) === 0, 'Rolled-back expiry job remained.');
} finally {
  if (reportId) await prisma.moderationReport.deleteMany({ where: { id: reportId } });
  if (reporterId || targetId) await prisma.user.deleteMany({ where: { id: { in: [reporterId, targetId].filter(Boolean) } } });
  assert(await prisma.user.count({ where: { email: { startsWith: marker } } }) === 0, 'Moderation smoke users remained.');
  assert(await prisma.moderationReport.count({ where: { details: 'Smoke safety report.' } }) === 0, 'Moderation smoke report remained.');
  await prisma.$disconnect();
}

console.log('Slice 7 report privacy, enforcement constraints, session revocation, audit rollback, and exact cleanup smoke test passed.');
