import { z } from 'zod';
import { TEAM_SIDES } from '../types/match.js';

/**
 * DEC-021 A1: buy a ticket for one place. A position (with its slot) or a substitute place, on one side, paid by card /
 * Instant EFT through Paystack or with a match credit. The cancellation-policy tick is required (A8).
 */
export const ticketCheckoutSchema = z
  .object({
    seat: z.enum(['POSITION', 'SUBSTITUTE']),
    side: z.enum(TEAM_SIDES),
    slotId: z.string().uuid().optional(),
    method: z.enum(['PAYMENT', 'CREDIT']).default('PAYMENT'),
    acceptPolicy: z.literal(true, { errorMap: () => ({ message: 'Tick "I understand the cancellation policy" to continue.' }) }),
  })
  .refine((value) => (value.seat === 'POSITION') === Boolean(value.slotId), { message: 'Choose a position, or a substitute place.', path: ['slotId'] });

export type TicketCheckoutInput = z.infer<typeof ticketCheckoutSchema>;

/** DEC-021 A2: leaving. More than 24 hours before kick-off a paid place needs a choice: a match credit or a refund. */
export const ticketLeaveSchema = z.object({ choice: z.enum(['CREDIT', 'REFUND']).optional() });
/** DEC-021 A3: what a cancelled match gives back, for all (or some) of the payer's places. */
export const ticketChoiceSchema = z.object({ choice: z.enum(['CREDIT', 'REFUND']), ticketIds: z.array(z.string().uuid()).max(30).optional() });
export type TicketLeaveInput = z.infer<typeof ticketLeaveSchema>;
export type TicketChoiceInput = z.infer<typeof ticketChoiceSchema>;

/**
 * DEC-021 A5: a squad member pays for named teammates (themselves included). A match credit can only pay for the
 * payer's own seat, so a credit checkout names exactly the payer.
 */
export const teamTicketCheckoutSchema = z.object({
  playerIds: z.array(z.string().uuid()).min(1).max(30),
  method: z.enum(['PAYMENT', 'CREDIT']).default('PAYMENT'),
  acceptPolicy: z.literal(true, { errorMap: () => ({ message: 'Tick "I understand the cancellation policy" to continue.' }) }),
});
export type TeamTicketCheckoutInput = z.infer<typeof teamTicketCheckoutSchema>;
