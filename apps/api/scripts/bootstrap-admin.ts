import { prisma } from '../src/database/prisma.js';
import { appendAdminAudit } from '../src/modules/admin/admin-audit.js';

const identifier = process.argv.slice(2).find((value) => !value.startsWith('-'));
if (!identifier)
  throw new Error(
    'Usage: npm run admin:bootstrap --workspace=@footy-finder/api -- <email-or-username>',
  );

try {
  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findFirst({
      where: {
        OR: [
          { email: identifier.toLowerCase() },
          { username: { equals: identifier, mode: 'insensitive' } },
        ],
      },
    });
    if (!existing) throw new Error('The user account does not exist. Register it first.');
    const promoted = await tx.user.update({
      where: { id: existing.id },
      data: { platformRole: 'ADMIN', accountStatus: 'ACTIVE' },
    });
    await appendAdminAudit(tx, {
      action: 'ADMIN_BOOTSTRAPPED',
      entityType: 'USER',
      entityId: promoted.id,
      metadata: { identifier: promoted.username },
    });
    return promoted;
  });

  console.log(`Admin role granted to ${user.username}. Sign in at the Admin app to configure MFA.`);
} finally {
  await prisma.$disconnect();
}
