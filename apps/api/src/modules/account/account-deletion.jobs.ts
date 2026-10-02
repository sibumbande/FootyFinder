import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { ACCOUNT_DELETION_SETTLE_CHECK_JOB, AccountDeletionFinaliser } from './account-deletion.finalise.js';
import { ACCOUNT_DELETION_FINALISE_JOB } from './account-deletion.service.js';

const invalidPayload = () => Object.assign(new Error('Invalid account deletion payload.'), { code: 'JOB_PAYLOAD_INVALID' });
const parse = (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidPayload();
  const { requestId, attempt } = payload as Record<string, unknown>;
  if (typeof requestId !== 'string') throw invalidPayload();
  return { requestId, attempt: typeof attempt === 'number' ? attempt : 0 };
};

/** CEO batch 5, item 3: the final step 14 days after confirming, and the daily finance settle check (D2). */
export const registerAccountDeletionJobHandlers = (finaliser = new AccountDeletionFinaliser()) => {
  registerDurableJobHandler(ACCOUNT_DELETION_FINALISE_JOB, async (payload) => {
    const { requestId, attempt } = parse(payload);
    await finaliser.finalise(requestId, attempt);
  });
  registerDurableJobHandler(ACCOUNT_DELETION_SETTLE_CHECK_JOB, async (payload) => {
    await finaliser.settleCheck(parse(payload).requestId);
  });
};
