import { z } from 'zod';
import { emailSchema } from './auth.js';
import { FOOTBALL_POSITIONS } from '../types/user.js';
import type { AuthenticatedUser, CitySummary } from '../types/user.js';

/**
 * CEO decision (ToS review Q1, 2026-09-30): the master Terms of Service, which include the Privacy
 * Notice and the Participation Agreement, are the only legal document the app publishes and
 * requires. The database enum still holds the retired PRIVACY, PARTICIPATION, CODE_OF_CONDUCT and
 * COMPANY_DISCLOSURE values and their old rows as history; the app never reads them.
 */
export const LEGAL_DOCUMENT_TYPES = ['TERMS'] as const;
export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

/** The single acceptance checkbox (Q1). Stored word for word in each acceptance record. */
export const TERMS_ACCEPTANCE_STATEMENT =
  "I'm 18 or older and I agree to the FootyFinder Terms of Service, including the Privacy Notice and the injury risk waiver in clause 9.";

/** Anchors on the Terms page (/legal/terms#clause-8), used by the footer and the checkbox links. */
export const TERMS_ANCHORS = { privacy: 'clause-8', riskWaiver: 'clause-9', cancellations: 'clause-14' } as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Enter a valid date');

export const isAtLeastAge = (dateOfBirth: string, years: number, today = new Date()) => {
  const [year, month, day] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate()));
  return new Date(Date.UTC(year, month - 1, day)) <= cutoff;
};

export const onboardingProfileSchema = z
  .object({
    dateOfBirth: isoDate,
    yearsExperience: z.number().int().min(0).max(60),
    cityId: z.string().uuid(),
    preferredPositions: z
      .array(z.enum(FOOTBALL_POSITIONS))
      .min(1)
      .max(4)
      .refine((values) => new Set(values).size === values.length, 'Positions must be unique'),
  })
  .refine((input) => isAtLeastAge(input.dateOfBirth, 18), {
    path: ['dateOfBirth'],
    message: 'You must be at least 18 years old',
  });

export const cityInterestSchema = z.object({
  cityId: z.string().uuid(),
  email: emailSchema,
  consent: z.literal(true, { message: 'Consent is required for city launch updates' }),
  source: z.string().trim().min(1).max(80).default('web'),
});

export const cityInterestStatusSchema = z.object({
  token: z.string().min(40).max(200).regex(/^[A-Za-z0-9_-]+$/),
});

export const legalAcceptanceSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(LEGAL_DOCUMENT_TYPES.length),
  source: z.enum(['REGISTRATION', 'PROFILE_COMPLETION', 'REACCEPTANCE']),
});

export const completeOnboardingSchema = z.object({ confirm: z.literal(true) });
export const photoCropSchema = z.object({
  left: z.coerce.number().int().min(0).optional(),
  top: z.coerce.number().int().min(0).optional(),
  size: z.coerce.number().int().positive().optional(),
}).strict();

export interface LegalDocumentSummary {
  id: string;
  type: LegalDocumentType;
  version: string;
  title: string;
  content: string;
  checksum: string;
  effectiveAt: string;
  material: boolean;
  reacceptanceRequired: boolean;
}

export interface OnboardingState {
  user: AuthenticatedUser;
  missing: string[];
  canComplete: boolean;
  legalDocumentsAvailable: boolean;
}

export interface CityInterestReceipt {
  id: string;
  city: CitySummary;
  status: 'SUBSCRIBED';
  managementToken: string;
}

export type OnboardingProfileInput = z.infer<typeof onboardingProfileSchema>;
export type CityInterestInput = z.infer<typeof cityInterestSchema>;
export type CityInterestStatusInput = z.infer<typeof cityInterestStatusSchema>;
export type LegalAcceptanceInput = z.infer<typeof legalAcceptanceSchema>;
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;
export type PhotoCropInput = z.infer<typeof photoCropSchema>;
