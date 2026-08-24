import { z } from 'zod';

export const adminMfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export type AdminMfaCodeInput = z.infer<typeof adminMfaCodeSchema>;

export const managedVenueInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  addressLine1: z.string().trim().min(2).max(160),
  addressLine2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(2).max(80),
  region: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().trim().min(3).max(80).default('Africa/Johannesburg'),
  isActive: z.boolean().default(true),
});
export type ManagedVenueInput = z.infer<typeof managedVenueInputSchema>;

export const managedFieldInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).default('ACTIVE'),
  supportedFormats: z
    .array(z.enum(['FIVE_A_SIDE', 'SEVEN_A_SIDE', 'ELEVEN_A_SIDE']))
    .min(1)
    .refine((formats) => new Set(formats).size === formats.length, {
      message: 'Supported formats must be unique.',
    }),
});
export type ManagedFieldInput = z.infer<typeof managedFieldInputSchema>;

export const managedFieldAvailabilityInputSchema = z.object({
  periods: z.array(
    z
      .object({
        dayOfWeek: z.number().int().min(0).max(6),
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(1).max(1440),
      })
      .refine((value) => value.startMinute < value.endMinute, 'Start must be before end.'),
  ),
});
export type ManagedFieldAvailabilityInput = z.infer<
  typeof managedFieldAvailabilityInputSchema
>;

export const managedFieldExceptionInputSchema = z
  .object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    available: z.boolean().default(false),
    reason: z.string().trim().max(240).optional(),
  })
  .refine((value) => new Date(value.startsAt) < new Date(value.endsAt), {
    path: ['endsAt'],
    message: 'End must be after start.',
  });
export type ManagedFieldExceptionInput = z.infer<typeof managedFieldExceptionInputSchema>;

export const managedFieldPriceInputSchema = z
  .object({
    amountCents: z.number().int().min(0),
    effectiveFrom: z.string().datetime(),
    effectiveTo: z.string().datetime().optional(),
  })
  .refine(
    (value) => !value.effectiveTo || new Date(value.effectiveFrom) < new Date(value.effectiveTo),
    { path: ['effectiveTo'], message: 'End must be after start.' },
  );
export type ManagedFieldPriceInput = z.infer<typeof managedFieldPriceInputSchema>;

export const createAdminTestDataBatchSchema = z.object({
  label: z.string().trim().min(3).max(80),
  accountCount: z.number().int().min(1).max(20),
});
export type CreateAdminTestDataBatchInput = z.infer<typeof createAdminTestDataBatchSchema>;
