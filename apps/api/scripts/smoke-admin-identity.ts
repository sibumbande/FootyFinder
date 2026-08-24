import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { appendAdminAudit } from '../src/modules/admin/admin-audit.js';
import {
  adminTotpCode,
  createAdminMfaSecret,
  decryptAdminMfaSecret,
  encryptAdminMfaSecret,
  verifyAdminTotp,
} from '../src/modules/admin/admin-mfa.js';

const marker = `slice-2-admin-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
let appendOnlyBlocked = false;

try {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: `${marker}@smoke.invalid`,
        username: marker.slice(0, 28),
        passwordHash: 'smoke-test-only',
        platformRole: 'ADMIN',
      },
    });
    const session = await tx.authSession.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        adminVerifiedAt: new Date(),
      },
    });
    const secret = createAdminMfaSecret();
    const encryptedSecret = encryptAdminMfaSecret(secret);
    await tx.adminMfaCredential.create({
      data: { userId: user.id, encryptedSecret, confirmedAt: new Date() },
    });
    assert(decryptAdminMfaSecret(encryptedSecret) === secret, 'MFA secret encryption failed.');
    assert(verifyAdminTotp(secret, adminTotpCode(secret)), 'TOTP verification failed.');
    const audit = await appendAdminAudit(tx, {
      actorUserId: user.id,
      action: 'SMOKE_ADMIN_ACTION',
      entityType: 'AUTH_SESSION',
      entityId: session.id,
      requestId: marker,
      metadata: { marker },
    });
    assert(audit.actorUserId === user.id, 'Audit actor was not persisted.');
    await tx.$executeRaw`UPDATE "AdminAuditLog" SET "action" = 'TAMPERED' WHERE "id" = ${audit.id}::uuid`;
  });
} catch (error) {
  appendOnlyBlocked = String(error).includes('append-only');
} finally {
  assert(appendOnlyBlocked, 'Database allowed an Admin audit entry to be mutated.');
  assert(
    (await prisma.user.count({ where: { email: `${marker}@smoke.invalid` } })) === 0,
    'Rolled-back Admin smoke user remained.',
  );
  assert(
    (await prisma.adminAuditLog.count({ where: { requestId: marker } })) === 0,
    'Rolled-back Admin audit entry remained.',
  );
  await prisma.$disconnect();
}

console.log('Slice 2 Admin identity, MFA, and append-only audit smoke test passed.');
