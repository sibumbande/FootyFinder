import { z } from 'zod';
import {
  DEFAULT_SUBSTITUTE_CAPACITY_PER_TEAM,
  MATCH_FORMATS,
  MAX_SUBSTITUTES_PER_TEAM,
} from '../config/match-formats.js';
import {
  DEFAULT_QUICK_GAME_FEE_CENTS,
  MAX_QUICK_GAME_FEE_CENTS,
  MIN_QUICK_GAME_FEE_CENTS,
} from '../types/wallet.js';
import {
  MATCH_RULES,
  MATCH_VISIBILITIES,
  DISPLACED_PLAYER_ACTIONS,
  LINEUP_PLAYER_ACTIONS,
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

const matchDetailsSchema = z.object({
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
  startsAt: z
    .string()
    .datetime()
    .refine((value) => new Date(value).getTime() > Date.now(), 'Choose a future date and time'),
});
export const createMatchSchema = matchDetailsSchema.extend({
  managedFieldId: z.string().uuid(),
  feeCents: z
    .number()
    .int()
    .min(MIN_QUICK_GAME_FEE_CENTS)
    .max(MAX_QUICK_GAME_FEE_CENTS)
    .refine((value) => value % 100 === 0, 'Player fee must be a whole-rand amount')
    .default(DEFAULT_QUICK_GAME_FEE_CENTS),
});
export const createTeamMatchSchema = matchDetailsSchema
  .omit({ visibility: true })
  .extend({ venue: venueInputSchema, formationKey: z.string().trim().min(1).max(80) });
export const updateMatchSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: optionalText(1000),
  startsAt: z.string().datetime().optional(),
});
export const joinMatchSchema = z.object({ team: z.enum(TEAM_SIDES) });
export const publicMatchSlugSchema = z.string().regex(/^m-[a-f0-9]{24}$/);
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
export const assignTeamMatchStarterSchema = z.object({
  userId: z.string().uuid(),
  displacedPlayerAction: z.enum(DISPLACED_PLAYER_ACTIONS).optional(),
});
export const removeTeamMatchStarterSchema = z.object({
  playerAction: z.enum(LINEUP_PLAYER_ACTIONS),
});
export const openTeamMatchLineupSlotSchema = z.object({
  occupiedPlayerAction: z.enum(LINEUP_PLAYER_ACTIONS).optional(),
});
export const updateTeamMatchLineupSlotPositionSchema = z.object({
  positionX: z.number().min(0).max(100),
  positionY: z.number().min(0).max(100),
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
    format: z.enum(MATCH_FORMATS).optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    availableOnly: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default('false'),
    limit: z.coerce.number().int().min(1).max(200).default(200),
  })
  .strict();

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
export type AssignTeamMatchStarterInput = z.infer<typeof assignTeamMatchStarterSchema>;
export type RemoveTeamMatchStarterInput = z.infer<typeof removeTeamMatchStarterSchema>;
export type OpenTeamMatchLineupSlotInput = z.infer<typeof openTeamMatchLineupSlotSchema>;
export type UpdateTeamMatchLineupSlotPositionInput = z.infer<
  typeof updateTeamMatchLineupSlotPositionSchema
>;
