import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { serializableTransaction } from '../src/database/transaction.js';
import { enqueueDurableJob, registerDurableJobHandler, runOneDurableJob } from '../src/jobs/durable-jobs.js';
import { FinancialInsufficientFundsError, FinancialRepository } from '../src/modules/wallet/financial.repository.js';
import { WalletRepository } from '../src/modules/wallet/wallet.repository.js';

const marker = `slice-5-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
const financial = new FinancialRepository();
const walletRepository = new WalletRepository(financial);
let userId = '';
let jobId = '';
try {
  const user = await prisma.user.create({ data: { email: `${marker}@smoke.invalid`, username: `f_${marker.slice(-20)}`, passwordHash: 'smoke', profile: { create: { displayName: 'Finance Smoke' } }, walletAccount: { create: {} } } });
  userId = user.id;
  await serializableTransaction((tx) => financial.credit(tx, { userId, amountCents: 10_000, type: 'DEPOSIT_CREDIT', idempotencyKey: `${marker}:seed`, referenceType: 'SMOKE', referenceId: marker }));

  const holds = await Promise.allSettled([
    serializableTransaction((tx) => financial.createHold(tx, { userId, amountCents: 7_000, idempotencyKey: `${marker}:hold-a`, referenceType: 'SMOKE', referenceId: marker })),
    serializableTransaction((tx) => financial.createHold(tx, { userId, amountCents: 7_000, idempotencyKey: `${marker}:hold-b`, referenceType: 'SMOKE', referenceId: marker })),
  ]);
  assert(holds.filter((result) => result.status === 'fulfilled').length === 1, 'Concurrent holds did not produce exactly one winner.');
  assert(holds.some((result) => result.status === 'rejected' && result.reason instanceof FinancialInsufficientFundsError), 'Losing hold did not report insufficient available funds.');
  const hold = (holds.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<FinancialRepository['createHold']>>>).value.hold;

  let debitBlocked = false;
  try { await serializableTransaction((tx) => financial.debit(tx, { userId, amountCents: 4_000, type: 'MATCH_ENTRY_DEBIT', idempotencyKey: `${marker}:blocked-debit`, referenceType: 'SMOKE', referenceId: marker })); }
  catch (error) { debitBlocked = error instanceof FinancialInsufficientFundsError; }
  assert(debitBlocked, 'Active hold did not reduce spendable balance.');

  const capture = await serializableTransaction((tx) => financial.captureHold(tx, hold.id, { type: 'MATCH_ENTRY_DEBIT', idempotencyKey: `${marker}:capture`, description: 'Smoke capture' }));
  const replay = await serializableTransaction((tx) => financial.captureHold(tx, hold.id, { type: 'MATCH_ENTRY_DEBIT', idempotencyKey: `${marker}:capture`, description: 'Smoke capture' }));
  assert(!capture.replayed && replay.replayed, 'Hold capture was not idempotent.');
  assert((await prisma.walletAccount.findUniqueOrThrow({ where: { userId } })).balanceCents === 3_000, 'Hold capture changed the balance more than once.');

  const pending = await Promise.all([
    walletRepository.createPending(userId, 5_000, 'smoke-provider', `${marker}:deposit`),
    walletRepository.createPending(userId, 5_000, 'smoke-provider', `${marker}:deposit`),
  ]);
  assert(pending.filter((item) => item.created).length === 1, 'Concurrent deposit creation produced duplicate operations.');
  assert((await prisma.walletTransaction.count({ where: { idempotencyKey: `${marker}:deposit` } })) === 1, 'Concurrent deposit key produced duplicate ledger rows.');

  let terminalBlocked = false;
  try { await prisma.walletTransaction.update({ where: { id: capture.transaction.id }, data: { status: 'FAILED' } }); }
  catch (error) { terminalBlocked = String(error).includes('terminal state is immutable'); }
  assert(terminalBlocked, 'Database allowed a succeeded transaction to reverse state.');

  let negativeBlocked = false;
  try { await prisma.walletAccount.update({ where: { userId }, data: { balanceCents: -1 } }); }
  catch (error) { negativeBlocked = true; }
  assert(negativeBlocked, 'Database allowed a negative wallet balance.');

  const jobType = `SMOKE_${marker}`;
  let handled = false;
  registerDurableJobHandler(jobType, async (payload) => { handled = (payload as { marker?: string }).marker === marker; });
  const job = await prisma.$transaction((tx) => enqueueDurableJob(tx, { type: jobType, dedupeKey: `${marker}:job`, payload: { marker }, runAt: new Date() }));
  jobId = job.id;
  assert(await runOneDurableJob(), 'Durable worker did not claim the ready job.');
  assert(handled && (await prisma.durableJob.findUniqueOrThrow({ where: { id: job.id } })).status === 'SUCCEEDED', 'Durable job did not complete authoritatively.');

  const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { userId } });
  const ledger = await prisma.walletTransaction.aggregate({ where: { walletAccountId: wallet.id, status: 'SUCCEEDED' }, _sum: { amountCents: true } });
  assert(ledger._sum.amountCents === wallet.balanceCents, 'Wallet did not reconcile to its settled ledger.');
} finally {
  if (jobId) await prisma.durableJob.deleteMany({ where: { id: jobId } });
  if (userId) {
    const wallet = await prisma.walletAccount.findUnique({ where: { userId } });
    if (wallet) {
      await prisma.matchPayment.deleteMany({ where: { userId } });
      await prisma.walletHold.deleteMany({ where: { walletAccountId: wallet.id } });
      await prisma.walletTransaction.deleteMany({ where: { walletAccountId: wallet.id } });
    }
    await prisma.user.deleteMany({ where: { id: userId } });
  }
  assert((await prisma.user.count({ where: { email: `${marker}@smoke.invalid` } })) === 0, 'Financial smoke user remained.');
  assert((await prisma.durableJob.count({ where: { dedupeKey: `${marker}:job` } })) === 0, 'Financial smoke job remained.');
  await prisma.$disconnect();
}
console.log('Slice 5 concurrent holds, atomic deposits, terminal transitions, reconciliation, durable jobs, and cleanup smoke test passed.');
