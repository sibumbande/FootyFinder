import { serializableTransaction } from '../../database/transaction.js';
import { prisma } from '../../database/prisma.js';
import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { FinancialRepository } from './financial.repository.js';

export const registerWalletHoldJobHandlers = (financial = new FinancialRepository()) => {
  registerDurableJobHandler('WALLET_HOLD_EXPIRE', async (payload) => {
    const holdId =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload.holdId
        : undefined;
    if (typeof holdId !== 'string')
      throw Object.assign(new Error('Invalid wallet hold expiry payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    const current = await prisma.walletHold.findUnique({ where: { id: holdId }, select: { status: true } });
    if (!current || current.status !== 'ACTIVE') return;
    await serializableTransaction((tx) => financial.releaseHold(tx, holdId, true));
  });
};
