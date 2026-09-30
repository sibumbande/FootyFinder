import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../src/app.js';
import { allowedOrigins } from '../src/config/cors.js';
import { prisma } from '../src/database/prisma.js';
import { SessionsService } from '../src/modules/auth/sessions.service.js';

/**
 * Gate 8 smoke (DEC-020): the FootyFinder referee role (TKT-801).
 * Admin (users with audit rows) are kept in the disposable test database, as in the Gate 6 smokes:
 * AdminAuditLog is append-only by design.
 */
const marker = `g8-referees-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sessions = new SessionsService();
const origin = allowedOrigins[0]!;
const userIds: string[] = [];

const user = async (label: string, extra: { platformRole?: 'ADMIN' } = {}) => {
  const created = await prisma.user.create({
    data: {
      email: `${marker}-${label}@smoke.invalid`,
      username: `${marker.slice(-8)}_${label}`,
      passwordHash: 'smoke-test-only',
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: `${label} ${marker.slice(-4)}` } },
      ...extra,
    },
  });
  if (!extra.platformRole) userIds.push(created.id);
  return created;
};

/** A signed-in admin cookie whose MFA check happened `mfaAgeMinutes` ago. */
const adminCookie = async (adminId: string, mfaAgeMinutes: number) => {
  const session = await sessions.issue(adminId, { userAgent: marker });
  await prisma.authSession.update({
    where: { id: session.sessionId },
    data: { adminVerifiedAt: new Date(Date.now() - mfaAgeMinutes * 60_000) },
  });
  return `footy_finder_session=${session.token}`;
};

async function main() {
  const admin = await user('admin', { platformRole: 'ADMIN' });
  const referee = await user('ref');
  const player = await user('player');
  const fresh = await adminCookie(admin.id, 1);
  const stale = await adminCookie(admin.id, 20);
  const post = (path: string, cookie: string, body: object) =>
    request(app).post(path).set('Origin', origin).set('Cookie', cookie).send(body);

  // TKT-801: granting needs a fresh MFA check (D25) and a written reason.
  const staleGrant = await post(`/admin/referees/${referee.id}`, stale, { reason: 'Qualified referee' });
  assert(staleGrant.status === 403 && staleGrant.body.code === 'ADMIN_MFA_REVERIFY_REQUIRED', 'Referee grant did not require fresh MFA.');
  const noReason = await post(`/admin/referees/${referee.id}`, fresh, { reason: '' });
  assert(noReason.status === 400, 'Referee grant accepted an empty reason.');
  const granted = await post(`/admin/referees/${referee.id}`, fresh, { reason: 'Qualified referee' });
  assert(granted.status === 201 && granted.body.data.userId === referee.id, 'Admin could not grant the referee role.');
  const again = await post(`/admin/referees/${referee.id}`, fresh, { reason: 'Qualified referee' });
  assert(again.status === 409 && again.body.code === 'ALREADY_REFEREE', 'A second active referee grant was allowed.');
  const list = await request(app).get('/admin/referees').set('Cookie', fresh);
  assert(list.status === 200 && list.body.data.some((row: { userId: string }) => row.userId === referee.id), 'Referee missing from the admin list.');

  // A referee sees isReferee on their own account; an ordinary player does not.
  const refereeCookie = `footy_finder_session=${(await sessions.issue(referee.id, {})).token}`;
  const playerCookie = `footy_finder_session=${(await sessions.issue(player.id, {})).token}`;
  assert((await request(app).get('/users/me').set('Cookie', refereeCookie)).body.data.isReferee === true, 'Referee account did not report isReferee.');
  assert((await request(app).get('/users/me').set('Cookie', playerCookie)).body.data.isReferee === false, 'Ordinary player reported isReferee.');
  // Only admins may manage referees.
  const byPlayer = await post(`/admin/referees/${player.id}`, playerCookie, { reason: 'Self promotion' });
  assert(byPlayer.status === 403, 'A non-admin could grant the referee role.');

  // Grants are permanent: only an active grant can be revoked, once, and never edited.
  let tamperBlocked = false;
  try {
    await prisma.$executeRaw`UPDATE "RefereeGrant" SET "grantReason" = 'tampered' WHERE "userId" = ${referee.id}::uuid`;
  } catch (error) {
    tamperBlocked = String(error).includes('referee grants are permanent');
  }
  assert(tamperBlocked, 'The database allowed a referee grant to be edited.');
  const staleRevoke = await post(`/admin/referees/${referee.id}/revoke`, stale, { reason: 'Stepped down' });
  assert(staleRevoke.status === 403, 'Referee revoke did not require fresh MFA.');
  const revoked = await post(`/admin/referees/${referee.id}/revoke`, fresh, { reason: 'Stepped down' });
  assert(revoked.status === 200, 'Admin could not revoke the referee role.');
  const revokedAgain = await post(`/admin/referees/${referee.id}/revoke`, fresh, { reason: 'Stepped down' });
  assert(revokedAgain.status === 404 && revokedAgain.body.code === 'NOT_A_REFEREE', 'A revoked grant was revoked twice.');
  assert((await request(app).get('/users/me').set('Cookie', refereeCookie)).body.data.isReferee === false, 'Revoked referee still reported isReferee.');
  // Re-granting creates a new permanent row and keeps the old one.
  assert((await post(`/admin/referees/${referee.id}`, fresh, { reason: 'Returned to refereeing' })).status === 201, 'Re-grant failed.');
  assert((await prisma.refereeGrant.count({ where: { userId: referee.id } })) === 2, 'Referee grant history was not kept.');
  const audits = await prisma.adminAuditLog.findMany({ where: { actorUserId: admin.id, entityId: referee.id }, select: { action: true } });
  assert(
    audits.filter(({ action }) => action === 'REFEREE_GRANTED').length === 2 && audits.filter(({ action }) => action === 'REFEREE_REVOKED').length === 1,
    'Referee role changes were not audited.',
  );
  // A restricted account cannot be made a referee.
  await prisma.user.update({ where: { id: player.id }, data: { accountStatus: 'SUSPENDED' } });
  const restricted = await post(`/admin/referees/${player.id}`, fresh, { reason: 'Qualified referee' });
  assert(restricted.status === 409 && restricted.body.code === 'REFEREE_ACCOUNT_RESTRICTED', 'A suspended account was made a referee.');

  console.log('Gate 8 referees smoke passed: referee role grant/revoke (fresh MFA, reasons, permanent audited history, isReferee).');
}

async function cleanup() {
  await prisma.refereeGrant.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

try {
  await main();
} finally {
  await cleanup().catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  });
  await prisma.$disconnect();
}
