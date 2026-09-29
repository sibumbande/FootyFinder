import { z } from 'zod';
import { managedMatchSchema } from './match.js';

export const managedMatchBookingSchema = managedMatchSchema;
export const playerFieldBookingSchema = managedMatchBookingSchema
  .omit({ visibility: true })
  .extend({ visibility: z.literal('PUBLIC').default('PUBLIC') });
export const bookingContributionSchema = z.object({
  amountCents: z.number().int().positive().max(10_000_000),
});
export type ManagedMatchBookingInput = z.infer<typeof managedMatchBookingSchema>;
export type PlayerFieldBookingInput = z.infer<typeof playerFieldBookingSchema>;
export type BookingContributionInput = z.infer<typeof bookingContributionSchema>;
