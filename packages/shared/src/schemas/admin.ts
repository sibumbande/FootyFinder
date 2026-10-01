import { z } from 'zod';

const timezoneSchema = z.string().trim().min(3).max(80).refine((timezone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}, 'Use a valid IANA timezone.');

export const adminMfaCodeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export type AdminMfaCodeInput = z.infer<typeof adminMfaCodeSchema>;

export const managedVenueInputSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
  name: z.string().trim().min(2).max(120),
  publicDescription: z.string().trim().min(20).max(3000).optional(),
  addressLine1: z.string().trim().min(2).max(160),
  addressLine2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(2).max(80),
  region: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: timezoneSchema.default('Africa/Johannesburg'),
  amenities: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  coverImageUrl: z.string().url().refine((value) => value.startsWith('https://'), 'Use an HTTPS image URL').optional(),
  coverImageAlt: z.string().trim().min(3).max(240).optional(),
  coverImageAttribution: z.string().trim().min(2).max(500).optional(),
  isActive: z.boolean().default(true),
});
export type ManagedVenueInput = z.input<typeof managedVenueInputSchema>;

export const managedFieldInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'MAINTENANCE']).default('ACTIVE'),
  turnaroundBufferMinutes: z.number().int().min(15).max(240).default(15),
  supportedFormats: z
    .array(z.enum(['FIVE_A_SIDE', 'SEVEN_A_SIDE', 'ELEVEN_A_SIDE']))
    .min(1)
    .refine((formats) => new Set(formats).size === formats.length, {
      message: 'Supported formats must be unique.',
    }),
});
export type ManagedFieldInput = z.input<typeof managedFieldInputSchema>;

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
    format: z.enum(['FIVE_A_SIDE', 'SEVEN_A_SIDE', 'ELEVEN_A_SIDE']).optional(),
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    startMinute: z.number().int().min(0).max(1439).optional(),
    endMinute: z.number().int().min(1).max(1440).optional(),
    effectiveFrom: z.string().datetime(),
    effectiveTo: z.string().datetime().optional(),
  })
  .refine(
    (value) => !value.effectiveTo || new Date(value.effectiveFrom) < new Date(value.effectiveTo),
    { path: ['effectiveTo'], message: 'End must be after start.' },
  )
  .refine(
    (value) => [value.dayOfWeek, value.startMinute, value.endMinute].every((item) => item === undefined) ||
      [value.dayOfWeek, value.startMinute, value.endMinute].every((item) => item !== undefined),
    { message: 'Day and time scope must be supplied together.' },
  )
  .refine((value) => value.startMinute === undefined || value.endMinute === undefined || value.startMinute < value.endMinute, {
    path: ['endMinute'], message: 'Price end minute must be after its start minute.',
  });
export type ManagedFieldPriceInput = z.infer<typeof managedFieldPriceInputSchema>;

export const managedVenueMediaInputSchema = z.object({
  items: z.array(z.object({
    url: z.string().url().refine((value) => value.startsWith('https://'), 'Use an HTTPS image URL'),
    altText: z.string().trim().min(3).max(240),
    attribution: z.string().trim().min(2).max(500),
  })).min(3).max(20),
});
export type ManagedVenueMediaInput = z.infer<typeof managedVenueMediaInputSchema>;

/**
 * CEO touch-up batch 3, item 1 (D4): the venue's photos, saved in one go. Each photo is either one already in
 * the venue (mediaId) or a fresh upload (fileId); 3 to 12 photos, and the cover is one of them.
 */
export const VENUE_PHOTOS_MIN = 3;
export const VENUE_PHOTOS_MAX = 12;
/** CEO touch-up batch 3, item 2: "About this venue" and up to five links. */
export const VENUE_ABOUT_MAX = 1000;
export const VENUE_LINKS_MAX = 5;
export const VENUE_LINK_TYPES = ['WEBSITE', 'INSTAGRAM', 'FACEBOOK', 'X', 'TIKTOK', 'OTHER'] as const;
export const venueContentInputSchema = z.object({
  photos: z.array(z.object({
    mediaId: z.string().uuid().optional(),
    fileId: z.string().uuid().optional(),
    altText: z.string().trim().min(3).max(240),
    attribution: z.string().trim().min(2).max(500),
  }).refine((photo) => Boolean(photo.mediaId) !== Boolean(photo.fileId), 'Each photo is either an existing photo or a new upload.'))
    .max(VENUE_PHOTOS_MAX, `Use at most ${VENUE_PHOTOS_MAX} photos.`),
  coverIndex: z.number().int().min(0).default(0),
  aboutText: z.string().trim().max(VENUE_ABOUT_MAX, `Keep "About this venue" to ${VENUE_ABOUT_MAX} characters.`).default(''),
  links: z.array(z.object({
    type: z.enum(VENUE_LINK_TYPES),
    label: z.string().trim().min(1).max(40),
    url: z.string().trim().url('Enter a full web address.').refine((value) => value.startsWith('https://'), 'Use an https:// link.'),
  })).max(VENUE_LINKS_MAX, `Add at most ${VENUE_LINKS_MAX} links.`).default([]),
}).refine((value) => value.photos.length === 0 || value.coverIndex < value.photos.length, { path: ['coverIndex'], message: 'Choose one of the photos as the cover.' });
export type VenueContentInput = z.input<typeof venueContentInputSchema>;
export type VenueContentData = z.infer<typeof venueContentInputSchema>;

export const venueContentDecisionSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const venueCancellationPolicyInputSchema = z.object({
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().optional(),
  fullCreditBeforeHours: z.number().int().min(0).max(720).default(24),
  lateCreditPercent: z.number().int().min(0).max(100).default(0),
  venueCancellationPercent: z.number().int().min(0).max(100).default(100),
  policyText: z.string().trim().min(20).max(3000),
}).refine((value) => !value.effectiveTo || value.effectiveFrom < value.effectiveTo, {
  path: ['effectiveTo'], message: 'End must be after start.',
});
export type VenueCancellationPolicyInput = z.infer<typeof venueCancellationPolicyInputSchema>;

export const venueDeactivationInputSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const createAdminTestDataBatchSchema = z.object({
  label: z.string().trim().min(3).max(80),
  accountCount: z.number().int().min(1).max(20),
});
export type CreateAdminTestDataBatchInput = z.infer<typeof createAdminTestDataBatchSchema>;

/**
 * CEO Q4: admin "Cancel match (weather/venue)" before kick-off. The written reason goes to the
 * audit log only; players see a fixed sentence.
 */
export const adminCancelMatchSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type AdminCancelMatchInput = z.infer<typeof adminCancelMatchSchema>;

/** Gate 6 / TKT-606: admin card refund of a top-up (whole cents, reason required). */
export const adminCardRefundSchema = z.object({
  amountCents: z.number().int().positive().max(500_000),
  reason: z.string().trim().min(5).max(500),
});
export type AdminCardRefundInput = z.infer<typeof adminCardRefundSchema>;
export const adminFinanceReasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });
export const adminTopUpQuerySchema = z.object({
  status: z.enum(['INITIALIZED', 'SUCCEEDED', 'FAILED', 'REVIEW']).optional(),
  reference: z.string().trim().max(120).optional(),
});

/** Gate 6 / TKT-607: venue bank details (South African account formats). Fake data in non-production. */
export const venueBankDetailsSchema = z.object({
  bankName: z.string().trim().min(2).max(80),
  accountHolder: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().regex(/^[0-9]{6,16}$/, 'Account number must be 6 to 16 digits.'),
  branchCode: z.string().trim().regex(/^[0-9]{6}$/, 'Branch code must be 6 digits.'),
  accountType: z.enum(['CHEQUE', 'SAVINGS', 'TRANSMISSION']),
});
export const createVenueBeneficiarySchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  details: venueBankDetailsSchema,
  linkedUserId: z.string().uuid().optional(),
});
export type CreateVenueBeneficiaryInput = z.infer<typeof createVenueBeneficiarySchema>;
export const venuePayableAdjustmentSchema = z.object({
  amountCents: z.number().int().refine((value) => value !== 0, 'Adjustment cannot be zero.').refine((value) => Math.abs(value) <= 10_000_000),
  reason: z.string().trim().min(5).max(500),
});
export const adminPayableQuerySchema = z.object({
  status: z.enum(['DUE', 'IN_BATCH', 'PAID', 'VOID']).optional(),
  venueId: z.string().uuid().optional(),
});

/** Gate 6 / TKT-608: weekly dual-control settlement. */
export const prepareSettlementSchema = z.object({
  venueId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the Monday of the week (YYYY-MM-DD).'),
});
export type PrepareSettlementInput = z.infer<typeof prepareSettlementSchema>;
export const markSettlementPaidSchema = z.object({
  payoutReference: z.string().trim().min(4).max(120),
  evidenceNote: z.string().trim().min(5).max(1000),
});
export type MarkSettlementPaidInput = z.infer<typeof markSettlementPaidSchema>;
export const adminSettlementQuerySchema = z.object({
  status: z.enum(['PREPARED', 'APPROVED', 'PAID', 'CANCELLED']).optional(),
});
