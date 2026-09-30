import { z } from 'zod';
import { MATCH_FORMATS } from '../config/match-formats.js';
import { FOOTBALL_POSITIONS } from '../types/user.js';
import { RECRUITMENT_LEVELS, RECRUITMENT_NOTE_MAX, TIMES_OF_DAY } from '../types/recruitment.js';

const unique = <T>(values: T[]) => new Set(values).size === values.length;
const positions = z.array(z.enum(FOOTBALL_POSITIONS)).min(1).max(4).refine(unique, 'Positions must be unique');
const days = z.array(z.number().int().min(0).max(6)).max(7).refine(unique, 'Days must be unique').default([]);
const times = z.array(z.enum(TIMES_OF_DAY)).max(3).refine(unique, 'Times must be unique').default([]);
const area = z.string().trim().min(2, 'Enter an area').max(80);
const note = z
  .string()
  .trim()
  .max(RECRUITMENT_NOTE_MAX, `Keep the note to ${RECRUITMENT_NOTE_MAX} characters`)
  .optional()
  .transform((value) => value || undefined);

/** Gate 9 / TKT-909: a team's recruitment post (any number of positions, players and posts). */
export const recruitmentPostSchema = z.object({
  positions,
  playersWanted: z.number().int().min(1).max(99),
  format: z.enum(MATCH_FORMATS),
  level: z.enum(RECRUITMENT_LEVELS),
  days,
  times,
  area,
  note,
});
export type RecruitmentPostInput = z.infer<typeof recruitmentPostSchema>;

/** The player's own "Looking for a team" card; positions are needed only while it is on. */
export const lookingCardSchema = z
  .object({
    enabled: z.boolean(),
    positions: z.array(z.enum(FOOTBALL_POSITIONS)).max(4).refine(unique, 'Positions must be unique').default([]),
    area: area.optional(),
    days,
    times,
    note,
  })
  .refine((card) => !card.enabled || card.positions.length > 0, { path: ['positions'], message: 'Choose at least one position' });
export type LookingCardInput = z.infer<typeof lookingCardSchema>;

export const recruitmentQuerySchema = z.object({
  format: z.enum(MATCH_FORMATS).optional(),
  level: z.enum(RECRUITMENT_LEVELS).optional(),
  position: z.enum(FOOTBALL_POSITIONS).optional(),
  area: z.string().trim().max(80).optional().transform((value) => value || undefined),
  q: z.string().trim().max(80).optional().transform((value) => value || undefined),
});
export type RecruitmentQuery = z.infer<typeof recruitmentQuerySchema>;

export const adminRemoveRecruitmentSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const adminRecruitmentQuerySchema = z.object({
  kind: z.enum(['POST', 'CARD']).optional(),
  queue: z.enum(['reported', 'all']).default('reported'),
});
