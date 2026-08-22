import { z } from 'zod';
import {
  DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
  MATCH_FORMATS,
  MAX_SUBSTITUTES_PER_TEAM,
} from '../config/match-formats.js';
import {
  MATCH_RULES,
  MATCH_VISIBILITIES,
  TEAM_MATCH_AVAILABILITY_STATUSES,
  TEAM_SIDES,
} from '../types/match.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
    .optional();
export const venueInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    addressLine1: z.string().trim().min(2).max(200),
    addressLine2: optionalText(200),
    locality: optionalText(100),
    city: z.string().trim().min(2).max(100),
    region: z.string().trim().min(2).max(100),
    postalCode: optionalText(20),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase()),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    externalPlaceId: optionalText(200),
  })
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: 'Latitude and longitude must be supplied together.',
  });

export const createMatchSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: optionalText(1000),
  format: z.enum(MATCH_FORMATS),
  substituteCapacityPerTeam: z
    .number()
    .int()
    .min(0)
    .max(MAX_SUBSTITUTES_PER_TEAM)
    .default(DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM),
  rollingSubstitutes: z.boolean().default(false),
  rules: z
    .array(z.enum(MATCH_RULES))
    .max(MATCH_RULES.length)
    .refine((rules) => new Set(rules).size === rules.length, 'Match rules must be unique')
    .default([]),
  visibility: z.enum(MATCH_VISIBILITIES),
  venue: venueInputSchema,
  startsAt: z
    .string()
    .datetime()
    .refine((value) => new Date(value).getTime() > Date.now(), 'Choose a future date and time'),
  feeCents: z.number().int().min(0).max(1_000_000),
});
export const createTeamMatchSchema = createMatchSchema
  .omit({ visibility: true, feeCents: true })
  .extend({ formationKey: z.string().trim().min(1).max(80) });
export const updateMatchSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: optionalText(1000),
  startsAt: z.string().datetime().optional(),
});
export const joinMatchSchema = z.object({ team: z.enum(TEAM_SIDES) });
export const changeParticipantTeamSchema = z.object({ team: z.enum(TEAM_SIDES) });
export const teamMatchSideSchema = z.enum(TEAM_SIDES);
export const teamMatchAvailabilityQuerySchema = z.object({
  availability: z.enum(TEAM_MATCH_AVAILABILITY_STATUSES).optional(),
  selected: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export const updateMyTeamMatchAvailabilitySchema = z.object({
  status: z.enum(TEAM_MATCH_AVAILABILITY_STATUSES),
});
export const formationSlotUpdateSchema = z
  .object({
    participantId: z.string().uuid().nullable().optional(),
    positionX: z.number().min(0).max(100).optional(),
    positionY: z.number().min(0).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const resultInputSchema = z.object({
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
  scorers: z
    .array(
      z.object({ participantId: z.string().uuid(), goals: z.number().int().positive().max(99) }),
    )
    .max(64),
});
export const discoveryQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(500).default(50),
    format: z.enum(MATCH_FORMATS).optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    maxPriceCents: z.coerce.number().int().min(0).optional(),
    availableOnly: z.coerce.boolean().default(false),
    sort: z.enum(['nearest', 'soonest', 'lowest-price']).optional(),
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: 'Latitude and longitude must be supplied together.',
  });

export type CreateMatchInput = z.infer<typeof createMatchSchema>;
export type CreateTeamMatchInput = z.infer<typeof createTeamMatchSchema>;
export type UpdateMatchInput = z.infer<typeof updateMatchSchema>;
export type JoinMatchInput = z.infer<typeof joinMatchSchema>;
export type ChangeParticipantTeamInput = z.infer<typeof changeParticipantTeamSchema>;
export type FormationSlotUpdateInput = z.infer<typeof formationSlotUpdateSchema>;
export type ResultInput = z.infer<typeof resultInputSchema>;
export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>;
export type TeamMatchAvailabilityQuery = z.infer<typeof teamMatchAvailabilityQuerySchema>;
export type UpdateMyTeamMatchAvailabilityInput = z.infer<
  typeof updateMyTeamMatchAvailabilitySchema
>;
