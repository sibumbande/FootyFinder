import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { ModerationService } from './moderation.service.js';

export const registerModerationJobHandlers = (service = new ModerationService()) => {
  registerDurableJobHandler('ACCOUNT_SUSPENSION_EXPIRE', async (payload) => {
    const enforcementId = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.enforcementId : undefined;
    if (typeof enforcementId !== 'string')
      throw Object.assign(new Error('Invalid suspension expiry payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    await service.expireSuspension(enforcementId);
  });
};
