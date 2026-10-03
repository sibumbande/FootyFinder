import { prisma } from '../../src/database/prisma.js';

/** Ticket job types a smoke can queue (DEC-021). */
const TICKET_JOB_TYPES = ['TICKET_HOLD_EXPIRE', 'TICKET_PAYMENT_RECHECK', 'TICKET_REFUND_SUBMIT', 'TICKET_EMAIL', 'TICKET_CHOICE_AUTO_REFUND'];

/**
 * Removes the ticket jobs a smoke queued (since `since`), so a later smoke's durable queue is not slowed or blocked
 * by jobs for rows that no longer exist. Smokes run one at a time on the disposable database.
 */
export const removeTicketJobsSince = (since: Date) =>
  prisma.durableJob.deleteMany({ where: { type: { in: TICKET_JOB_TYPES }, createdAt: { gte: since } } });
