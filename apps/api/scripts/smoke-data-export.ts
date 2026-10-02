import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '../src/database/prisma.js';
import { DATA_EXPORT_AUDIT_ACTION, DataExportService } from '../src/modules/account/data-export.service.js';

/**
 * CEO batch 5, item 5 on PostgreSQL: "Download my data". The password is re-checked, the JSON holds the player's
 * profile, wallet, friends, consents, Terms acceptances and the messages they sent (never the other person's
 * messages or contact details), it can be downloaded once every 24 hours, and each download is audited.
 * The player is kept in the disposable database by design (the audit log names them).
 */
const marker = `exp-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
};
const PASSWORD = 'Smoke-export-password-1';
const service = new DataExportService();
const conversationIds: string[] = [];
const removable: string[] = [];

try {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const make = (label: string) =>
    prisma.user.create({
      data: {
        email: `${marker}-${label}@smoke.invalid`, username: `${marker.replace('-', '_')}_${label}`, passwordHash,
        profile: { create: { displayName: `${label} ${marker}`, homeArea: `${label} Home`, bio: `${label} bio`, dateOfBirth: new Date('1996-03-03') } },
        walletAccount: { create: { balanceCents: 0 } },
      },
    });
  const me = await make('me');
  const friend = await make('friend');
  removable.push(friend.id);
  const [low, high] = [me.id, friend.id].sort();
  await prisma.friendship.create({ data: { userLowId: low!, userHighId: high! } });
  const conversation = await prisma.conversation.create({ data: { directKey: `${marker}-dm`, participants: { create: [{ userId: me.id }, { userId: friend.id }] } } });
  conversationIds.push(conversation.id);
  await prisma.directMessage.create({ data: { conversationId: conversation.id, senderId: me.id, content: `My message ${marker}` } });
  await prisma.directMessage.create({ data: { conversationId: conversation.id, senderId: friend.id, content: `Their private reply ${marker}` } });

  assert((await code(service.export(me.id, { password: 'wrong' }))) === 'CURRENT_PASSWORD_INVALID', 'A wrong password was accepted.');
  const data = await service.export(me.id, { password: PASSWORD }, marker);
  assert(data.account.email === me.email && data.profile.homeArea === 'me Home' && data.profile.dateOfBirth === '1996-03-03', 'Profile data is missing.');
  assert(data.friends.some(({ displayName }) => displayName === `friend ${marker}`), 'Friends are missing.');
  assert(data.messagesSent.direct.length === 1 && data.messagesSent.direct[0]!.content === `My message ${marker}`, 'Sent messages are missing.');
  assert(Array.isArray(data.wallet.transactions) && Array.isArray(data.termsAcceptances) && Array.isArray(data.consents.cityWaitingList), 'Sections are missing.');
  const json = JSON.stringify(data);
  for (const secret of [`Their private reply ${marker}`, friend.email, 'friend Home', 'friend bio', friend.username])
    assert(!json.includes(secret), `The export contains another player's private data: ${secret}`);
  assert((await prisma.adminAuditLog.count({ where: { actorUserId: me.id, action: DATA_EXPORT_AUDIT_ACTION, requestId: marker } })) === 1, 'The download was not audited.');
  assert((await code(service.export(me.id, { password: PASSWORD }))) === 'DATA_EXPORT_RATE_LIMITED', 'A second download within 24 hours was allowed.');
  const tomorrow = new Date(Date.now() + 24 * 3_600_000 + 60_000);
  assert((await service.export(me.id, { password: PASSWORD }, undefined, tomorrow)).generatedAt === tomorrow.toISOString(), 'A download after 24 hours was refused.');
  console.log('Data export smoke passed: the password is re-checked; profile, friends, wallet, consents, Terms acceptances and the messages the player sent are included, never another player\'s messages or contact details; once per 24 hours; audited.');
} finally {
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.friendship.deleteMany({ where: { OR: [{ userLowId: { in: removable } }, { userHighId: { in: removable } }] } });
  await prisma.user.deleteMany({ where: { id: { in: removable } } });
  await prisma.$disconnect();
}
