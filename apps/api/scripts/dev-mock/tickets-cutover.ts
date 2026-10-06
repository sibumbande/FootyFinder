import { prisma } from '../../src/database/prisma.js';
import { serializableTransaction } from '../../src/database/transaction.js';
import { appendAdminAudit } from '../../src/modules/admin/admin-audit.js';
import { MatchesRepository } from '../../src/modules/matches/matches.repository.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import { issueCreditInTx } from '../../src/modules/tickets/match-credits.js';
import { DEV_SEED, DEV_SEED_BATCH_LABEL, DEV_SEED_CUTOVER_CREDITS, DEV_SEED_MATCH_PREFIX } from './world.js';

const REQUEST_ID = 'dev-tickets-cutover';
export const DEV_TICKETS_CUTOVER_AUDIT = 'DEV_TICKETING_CUTOVER';
const CREDIT_NOTE = `${DEV_SEED}: ticketing cutover (DEC-021 D12), no real money`;
const log = (message: string) => console.log(`  ${message}`);

/**
 * DEC-021 D12 (CEO-approved): moves the local mock world from the wallet to match tickets, once, without resetting
 * the database. Guarded by dev-mock/guard.ts (localhost `footy_finder` only).
 * 1. Every upcoming DEV SEED match that has wallet-paid players (or team money held from a team wallet) is cancelled
 *    with the dev-only reason DEV_TICKETING_CUTOVER and no money step: there are no tickets to give back.
 * 2. Wallet and team-wallet rows are left untouched, as read-only history (D13).
 * 3. Each mock player, and you with --me, gets 2 match credits (source DEV_SEED, no cash origin) to test paying with
 *    a credit. Safe to run again: nobody gets more than 2 cutover credits.
 * Past matches, results and statistics stay.
 */
export async function ticketsCutover(meEmail: string | undefined, now = new Date()) {
  console.log('DEV SEED ticketing cutover (DEC-021 D12)\n');
  const batch = await prisma.testDataBatch.findFirst({ where: { label: DEV_SEED_BATCH_LABEL } });
  const mockIds = batch
    ? (await prisma.user.findMany({ where: { testDataBatchId: batch.id, isTestAccount: true }, select: { id: true } })).map(({ id }) => id)
    : [];
  const me = meEmail ? await prisma.user.findUnique({ where: { email: meEmail.trim().toLowerCase() }, select: { id: true, isTestAccount: true, accountStatus: true } }) : null;
  if (meEmail && (!me || me.isTestAccount || me.accountStatus !== 'ACTIVE')) throw new Error('--me must be your own active account.');

  console.log('Upcoming DEV SEED matches paid from wallets');
  const upcoming = await prisma.match.findMany({
    where: {
      name: { startsWith: DEV_SEED_MATCH_PREFIX },
      status: { in: ['DRAFT', 'OPEN', 'READY'] },
      startsAt: { gt: now },
      OR: [
        { participants: { some: { status: 'JOINED', payment: { isNot: null } } } },
        { teamWalletHolds: { some: { status: 'ACTIVE' } } },
      ],
    },
    select: { id: true, name: true },
    orderBy: { startsAt: 'asc' },
  });
  const repository = new MatchesRepository();
  const notifications = new NotificationsService();
  const cancelled: string[] = [];
  for (const match of upcoming) {
    const result = await serializableTransaction((tx) => repository.cancelInTx(tx, match.id, 'DEV_TICKETING_CUTOVER'));
    notifications.publishPersistedMany(result.notifications);
    cancelled.push(match.name);
    log(`Cancelled ${match.name} (no money step; its wallet rows stay as history).`);
  }
  if (!upcoming.length) log('None found.');

  console.log('Match credits');
  const recipients = [...mockIds, ...(me ? [me.id] : [])];
  let issued = 0;
  for (const userId of recipients) {
    const have = await prisma.matchCredit.count({ where: { userId, reason: 'DEV_SEED', events: { some: { type: 'ISSUED', note: CREDIT_NOTE } } } });
    for (let index = have; index < DEV_SEED_CUTOVER_CREDITS; index += 1) {
      await serializableTransaction((tx) => issueCreditInTx(tx, { userId, reason: 'DEV_SEED', note: CREDIT_NOTE, now }));
      issued += 1;
    }
  }
  log(`${issued} credits issued (${DEV_SEED_CUTOVER_CREDITS} each to ${mockIds.length} mock players${me ? ' and you' : ''}; anyone who already had them was skipped).`);

  await serializableTransaction((tx) => appendAdminAudit(tx, {
    ...(me ? { actorUserId: me.id } : {}),
    action: DEV_TICKETS_CUTOVER_AUDIT,
    entityType: 'DEV_SEED',
    requestId: REQUEST_ID,
    metadata: { mark: DEV_SEED, cancelled, creditsIssued: issued },
  }));
  console.log('\nDone. Wallet history is untouched. Run npm run dev:seed-mock -- --reset-mock, then npm run dev:seed-mock -- --me <your email>, for fresh scenarios with paid tickets.');
}
