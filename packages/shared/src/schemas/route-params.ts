import { z } from 'zod';
import { MATCH_FORMATS } from '../config/match-formats.js';
import { TEAM_SIDES } from '../types/match.js';

export const uuidRouteParamSchema = z.string().uuid();
export const matchFormatRouteParamSchema = z.enum(MATCH_FORMATS);
export const teamSideRouteParamSchema = z.enum(TEAM_SIDES);
