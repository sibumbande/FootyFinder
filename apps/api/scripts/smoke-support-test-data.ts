import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { appendAdminAudit } from '../src/modules/admin/admin-audit.js';
import { persistNotifications } from '../src/modules/notifications/notification-writer.js';

const marker = `slice-4-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
let rolledBack = false;
try {
  await prisma.$transaction(async (tx) => {
    const player = await tx.user.create({ data: { email: `${marker}-player@smoke.invalid`, username: `p_${marker.slice(-20)}`, passwordHash: 'smoke', profile: { create: { displayName: 'Smoke Player' } }, walletAccount: { create: {} } } });
    const admin = await tx.user.create({ data: { email: `${marker}-admin@smoke.invalid`, username: `a_${marker.slice(-20)}`, passwordHash: 'smoke', platformRole: 'ADMIN', profile: { create: { displayName: 'Smoke Admin' } }, walletAccount: { create: {} } } });
    const ticket = await tx.supportTicket.create({ data: { referenceCode: `FF-${randomUUID()}`, createdByUserId: player.id, subject: 'Smoke support ticket', category: 'GENERAL', messages: { create: { authorUserId: player.id, authorRole: 'USER', content: 'Please help.' } } } });
    const response = await tx.supportTicketMessage.create({ data: { ticketId: ticket.id, authorUserId: admin.id, authorRole: 'ADMIN', content: 'We are helping.' } });
    await tx.supportTicketMessage.create({ data: { ticketId: ticket.id, authorUserId: admin.id, authorRole: 'ADMIN', content: 'Internal only.', internal: true } });
    await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: 'WAITING_ON_USER', assignedAdminUserId: admin.id, lastMessageAt: response.createdAt } });
    const notifications = await persistNotifications(tx, [{ userId: player.id, type: 'SUPPORT_REPLY', title: 'Support replied', message: 'A reply is ready.', targetPath: `/support/${ticket.id}`, dedupeKey: `support:${response.id}` }]);
    assert(notifications.length === 1, 'Support reply notification was not persisted exactly once.');
    const batch = await tx.testDataBatch.create({ data: { label: marker, createdByAdminUserId: admin.id } });
    await tx.user.create({ data: { email: `${marker}-test@test.invalid`, username: `t_${marker.slice(-20)}`, passwordHash: 'smoke', isTestAccount: true, testDataBatchId: batch.id, profile: { create: { displayName: 'Disposable Player' } }, walletAccount: { create: {} } } });
    const stored = await tx.supportTicket.findUniqueOrThrow({ where: { id: ticket.id }, include: { messages: true } });
    assert(stored.messages.filter((message) => !message.internal).length === 2, 'Public support thread was incomplete.');
    assert(stored.messages.filter((message) => message.internal).length === 1, 'Internal support note boundary was not persisted.');
    assert((await tx.user.count({ where: { testDataBatchId: batch.id, isTestAccount: true } })) === 1, 'Test account was not batch tagged.');
    await appendAdminAudit(tx, { actorUserId: admin.id, action: 'SMOKE_SUPPORT_TEST_DATA', entityType: 'SUPPORT_TICKET', entityId: ticket.id, requestId: marker });
    throw new Error('ROLLBACK_SUPPORT_TEST_DATA');
  });
} catch (error) { rolledBack = String(error).includes('ROLLBACK_SUPPORT_TEST_DATA'); }
finally {
  assert(rolledBack, 'Support/test-data smoke did not reach rollback.');
  assert((await prisma.user.count({ where: { email: { startsWith: marker } } })) === 0, 'Smoke users remained.');
  assert((await prisma.testDataBatch.count({ where: { label: marker } })) === 0, 'Test-data batch remained.');
  assert((await prisma.adminAuditLog.count({ where: { requestId: marker } })) === 0, 'Audit row remained.');
  await prisma.$disconnect();
}
console.log('Slice 4 support privacy, notifications, batch tagging, audit, rollback, and cleanup smoke test passed.');
