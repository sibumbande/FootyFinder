import { z } from 'zod';
import { MATCH_FORMATS } from '../config/match-formats.js';
import { TEAM_ROLES } from '../types/team.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
    .optional();
export const teamShortNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(4)
  .regex(/^[A-Za-z0-9]+$/, 'Use letters and numbers only')
  .transform((value) => value.toUpperCase());
const color = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a six-digit hex color')
  .optional();

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(100),
  shortName: teamShortNameSchema.optional(),
  description: optionalText(1000),
  locationText: optionalText(160),
  primaryFormat: z.enum(MATCH_FORMATS),
  formationKey: z.string().trim().min(1).max(80),
  primaryColor: color,
  secondaryColor: color,
});

export const updateTeamSchema = createTeamSchema
  .omit({ primaryFormat: true, formationKey: true })
  .partial();

export const updateTeamMemberRoleSchema = z.object({
  role: z.enum(TEAM_ROLES).refine((role) => role !== 'OWNER', 'Ownership cannot be assigned here'),
});

export const saveTeamFormationSchema = z.object({
  formationKey: z.string().trim().min(1).max(80),
});

export const updateTeamFormationSlotSchema = z
  .object({
    membershipId: z.string().uuid().nullable().optional(),
    positionX: z.number().min(0).max(100).optional(),
    positionY: z.number().min(0).max(100).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type UpdateTeamMemberRoleInput = z.infer<typeof updateTeamMemberRoleSchema>;
export type SaveTeamFormationInput = z.infer<typeof saveTeamFormationSchema>;
export type UpdateTeamFormationSlotInput = z.infer<typeof updateTeamFormationSlotSchema>;
