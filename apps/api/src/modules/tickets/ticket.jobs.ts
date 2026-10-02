import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { expireTicketHold, TICKET_HOLD_EXPIRE_JOB_TYPE } from './ticket-checkout.service.js';

const checkoutIdOf = (payload: unknown) => {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  if (typeof record.checkoutId !== 'string')
    throw Object.assign(new Error('Invalid ticket hold payload.'), { code: 'JOB_PAYLOAD_INVALID' });
  return record.checkoutId;
};

/** DEC-021 A1.2: releases a place whose checkout was not paid within 10 minutes. */
export const registerTicketJobHandlers = () => {
  registerDurableJobHandler(TICKET_HOLD_EXPIRE_JOB_TYPE, (payload) => expireTicketHold(checkoutIdOf(payload)));
};
