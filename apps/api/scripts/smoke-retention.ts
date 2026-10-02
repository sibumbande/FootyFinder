import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { RETENTION_CATEGORIES } from '../src/modules/retention/retention.policy.js';
import { RetentionService } from '../src/modules/retention/retention.service.js';

/**
 * CEO batch 5, item 4 on PostgreSQL: the retention table. A dry run reports old records and deletes nothing;
 * after an admin switches categories to APPLY (audited) the daily run purges them, except a conversation
 * under investigation and an unresolved report; financial records cannot be switched to purge.
 */
const marker = `ret-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const monthsAgo = (months: number) => {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
};
const service = new RetentionService();
const userIds: string[] = [];
const extra = { interestId: '', reportIds: [] as string[] };
const player = async (label: string) => {
  const user = await prisma.user.create({
    data: { email: `${marker}-${label}@smoke.invalid`, username: `${marker.replace('-', '_')}_${label}`, passwordHash: 'smoke', profile: { create: { displayName: `${label} ${marker}` } }, walletAccount: { create: {} } },
  });
  userIds.push(user.id);
  return user;
};

try {
  const admin = await player('admin');
  await prisma.user.update({ where: { id: admin.id }, data: { platformRole: 'ADMIN' } });
  userIds.splice(userIds.indexOf(admin.id), 1); // named in the append-only audit log: kept by design
  const a = await player('a');
  const b = await player('b');

  // Messages: an old DM, a recent DM, and an old DM in a conversation that is under investigation.
  const plain = await prisma.conversation.create({ data: { directKey: `${marker}-plain`, participants: { create: [{ userId: a.id }, { userId: b.id }] } } });
  const oldDm = await prisma.directMessage.create({ data: { conversationId: plain.id, senderId: a.id, content: 'old', createdAt: monthsAgo(13) } });
  const newDm = await prisma.directMessage.create({ data: { conversationId: plain.id, senderId: b.id, content: 'new' } });
  const held = await prisma.conversation.create({ data: { directKey: `${marker}-held`, participants: { create: [{ userId: a.id }, { userId: admin.id }] } } });
  const heldDm = await prisma.directMessage.create({ data: { conversationId: held.id, senderId: a.id, content: 'reported', createdAt: monthsAgo(14) } });
  const openReport = await prisma.moderationReport.create({
    data: { reporterUserId: b.id, targetType: 'DIRECT_MESSAGE', targetId: heldDm.id, reason: 'HARASSMENT', details: marker, evidenceSnapshot: {}, status: 'OPEN', createdAt: monthsAgo(14) },
  });
  extra.reportIds.push(openReport.id);
  // Conduct: a report resolved 4 years ago (purged) and the open one above (kept).
  const oldReport = await prisma.moderationReport.create({
    data: { reporterUserId: b.id, targetType: 'USER', targetId: a.id, reason: 'HARASSMENT', details: marker, evidenceSnapshot: {}, status: 'RESOLVED', resolutionSummary: 'Warned', resolvedAt: monthsAgo(49), createdAt: monthsAgo(50) },
  });
  extra.reportIds.push(oldReport.id);
  // Ended social: a friend request declined 13 months ago.
  const declined = await prisma.friendRequest.create({
    data: { requesterId: a.id, recipientId: b.id, pairKey: `${marker}-pair`, status: 'DECLINED', expiresAt: monthsAgo(12), respondedAt: monthsAgo(13), createdAt: monthsAgo(13) },
  });
  // Waiting list: an unsubscribed entry.
  const city = await prisma.city.findFirstOrThrow();
  const interest = await prisma.cityInterest.create({
    data: { cityId: city.id, email: `${marker}-wait@smoke.invalid`, dedupeKey: `${marker}-wait`, manageTokenHash: `${marker}-token`, consentedAt: monthsAgo(2), source: 'smoke', unsubscribedAt: monthsAgo(1) },
  });
  extra.interestId = interest.id;

  // 1. Dry run ("Report now"): everything is counted, nothing deleted.
  const report = await service.run({ trigger: 'ADMIN_REPORT', actorUserId: admin.id });
  assert(report.length === RETENTION_CATEGORIES.length && report.every(({ mode, purgedCount }) => mode === 'REPORT' && purgedCount === 0), 'A dry run purged something.');
  const messages = report.find(({ category }) => category === 'MESSAGES')!;
  assert(messages.counts.directMessages! >= 1, 'The old DM was not reported.');
  assert(await prisma.directMessage.findUnique({ where: { id: oldDm.id } }), 'A dry run deleted a DM.');
  assert((await prisma.adminAuditLog.count({ where: { actorUserId: admin.id, action: 'RETENTION_REPORTED' } })) === RETENTION_CATEGORIES.length, 'The dry run was not audited per category.');

  // 2. Financial records cannot be purged; switching the others is audited.
  let refused = '';
  try {
    await service.setMode('FINANCIAL', 'APPLY', admin.id, marker);
  } catch (error) {
    refused = (error as { code?: string }).code ?? '';
  }
  assert(refused === 'RETENTION_REPORT_ONLY', 'Financial records could be switched to purge.');
  for (const category of ['MESSAGES', 'ENDED_SOCIAL', 'CONDUCT', 'WAITING_LIST'] as const) await service.setMode(category, 'APPLY', admin.id, marker);
  assert((await prisma.adminAuditLog.count({ where: { requestId: marker, action: 'RETENTION_MODE_CHANGED' } })) === 4, 'Mode changes were not audited.');

  // 3. The daily run purges what is due and keeps what is under investigation or recent.
  const daily = await service.run({ trigger: 'DAILY' });
  assert(daily.find(({ category }) => category === 'FINANCIAL')!.mode === 'REPORT', 'Financial records were not report-only.');
  assert(!(await prisma.directMessage.findUnique({ where: { id: oldDm.id } })), 'The 13-month-old DM was not purged.');
  assert(await prisma.directMessage.findUnique({ where: { id: newDm.id } }), 'A recent DM was purged.');
  assert(await prisma.directMessage.findUnique({ where: { id: heldDm.id } }), 'A DM under investigation was purged.');
  assert(!(await prisma.friendRequest.findUnique({ where: { id: declined.id } })), 'The ended friend request was not purged.');
  assert(!(await prisma.moderationReport.findUnique({ where: { id: oldReport.id } })), 'The 4-year-old resolved report was not purged.');
  assert(await prisma.moderationReport.findUnique({ where: { id: openReport.id } }), 'An unresolved report was purged.');
  const gone = await prisma.cityInterest.findUniqueOrThrow({ where: { id: interest.id } });
  assert(gone.deletedAt && !gone.email.includes(marker), 'The unsubscribed waiting-list entry was not removed.');
  assert((await prisma.retentionRun.count({ where: { trigger: 'DAILY', mode: 'APPLY', purgedCount: { gt: 0 } } })) >= 4, 'Purges were not recorded.');
  console.log('Retention smoke passed: a dry run reports and deletes nothing (audited per category); financial records are report-only; mode changes are audited; the daily run purges 12-month-old messages and ended requests, 3-year-old resolved reports and unsubscribed waiting-list entries, and keeps recent messages, a conversation under investigation and unresolved reports.');
} finally {
  // Back to the safe default for every other smoke and the next run.
  await prisma.retentionPolicySetting.updateMany({ data: { mode: 'REPORT' } });
  await prisma.moderationReport.deleteMany({ where: { id: { in: extra.reportIds } } });
  if (extra.interestId) await prisma.cityInterest.deleteMany({ where: { id: extra.interestId } });
  await prisma.friendRequest.deleteMany({ where: { OR: [{ requesterId: { in: userIds } }, { recipientId: { in: userIds } }] } });
  await prisma.conversation.deleteMany({ where: { participants: { some: { userId: { in: userIds } } } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
}
