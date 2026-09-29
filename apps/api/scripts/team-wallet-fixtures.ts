import { prisma } from '../src/database/prisma.js';

/**
 * Gate 7: removes the team-wallet rows of disposable smoke-test teams, in foreign-key order,
 * so the teams, matches and users themselves can be cleaned up afterwards. Test fixtures only.
 */
export async function deleteTeamWalletFixtures(teamIds: string[]) {
  if (!teamIds.length) return;
  const accounts = await prisma.teamWalletAccount.findMany({ where: { teamId: { in: teamIds } }, select: { id: true } });
  const accountIds = accounts.map(({ id }) => id);
  if (!accountIds.length) return;
  const transactionIds = (
    await prisma.teamWalletTransaction.findMany({ where: { teamWalletAccountId: { in: accountIds } }, select: { id: true } })
  ).map(({ id }) => id);
  await prisma.teamWalletAllocation.deleteMany({
    where: { OR: [{ contributionTransactionId: { in: transactionIds } }, { debitTransactionId: { in: transactionIds } }] },
  });
  await prisma.teamWalletHold.deleteMany({ where: { teamWalletAccountId: { in: accountIds } } });
  await prisma.teamWalletTransaction.deleteMany({ where: { teamWalletAccountId: { in: accountIds } } });
  await prisma.teamWalletAccount.deleteMany({ where: { id: { in: accountIds } } });
}
