import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { enqueueDurableJob, registerDurableJobHandler, runOneDurableJob } from '../src/jobs/durable-jobs.js';
import { issueCreditInTx } from '../src/modules/tickets/match-credits.js';

/**
 * Money integrity guards on PostgreSQL (DEC-021: there is no wallet). The database itself refuses a match credit
 * valid for less than 3 years, an AVAILABLE credit with a closing date, and any change to the credit ledger; an
 * issued credit is ledgered once; and the durable job worker claims and completes a ready job exactly once.
 * The smoke user and its credit stay (marked) in the disposable database: the credit ledger is append-only.
 */
const marker = `money-integrity-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const refused = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return false;
  } catch {
    return true;
  }
};
let jobId = '';
try {
  const user = await prisma.user.create({ data: { email: `${marker}@smoke.invalid`, username: `mi_${marker.slice(-20)}`, passwordHash: 'smoke', profile: { create: { displayName: 'Money Smoke' } } } });

  // A credit is valid for 3 years (CPA s63): anything shorter is refused by the database.
  assert(
    await refused(() => prisma.matchCredit.create({ data: { userId: user.id, reason: 'GOODWILL', issuedAt: new Date(), expiresAt: new Date(Date.now() + 365 * 86_400_000) } })),
    'The database accepted a match credit valid for less than 3 years.',
  );
  const credit = await serializableTransaction((tx) => issueCreditInTx(tx, { userId: user.id, reason: 'GOODWILL', note: marker }));
  assert((await prisma.matchCreditEvent.count({ where: { creditId: credit.id, type: 'ISSUED' } })) === 1, 'The credit was not ledgered once.');
  assert(
    await refused(() => prisma.matchCredit.update({ where: { id: credit.id }, data: { closedAt: new Date() } })),
    'The database accepted an available credit with a closing date.',
  );

  // The credit ledger is append-only.
  const event = await prisma.matchCreditEvent.findFirstOrThrow({ where: { creditId: credit.id } });
  assert(await refused(() => prisma.matchCreditEvent.update({ where: { id: event.id }, data: { note: 'changed' } })), 'A credit ledger entry was changed.');
  assert(await refused(() => prisma.matchCreditEvent.delete({ where: { id: event.id } })), 'A credit ledger entry was deleted.');

  // The durable job worker claims a ready job and completes it (due first, so jobs other smokes left do not interfere).
  const jobType = `SMOKE_${marker}`;
  let handled = false;
  registerDurableJobHandler(jobType, async (payload) => { handled = (payload as { marker?: string }).marker === marker; });
  const job = await prisma.$transaction((tx) => enqueueDurableJob(tx, { type: jobType, dedupeKey: `${marker}:job`, payload: { marker }, runAt: new Date(0) }));
  jobId = job.id;
  assert(await runOneDurableJob(), 'Durable worker did not claim the ready job.');
  assert(handled && (await prisma.durableJob.findUniqueOrThrow({ where: { id: job.id } })).status === 'SUCCEEDED', 'Durable job did not complete authoritatively.');
  console.log('Money integrity smoke passed: credits are valid for 3 years and closed consistently (database checks), the credit ledger is append-only, an issued credit is ledgered once, and durable jobs complete once.');
} finally {
  if (jobId) await prisma.durableJob.deleteMany({ where: { id: jobId } });
  assert((await prisma.durableJob.count({ where: { dedupeKey: `${marker}:job` } })) === 0, 'Money integrity smoke job remained.');
  await prisma.$disconnect();
}
