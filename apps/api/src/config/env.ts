import 'dotenv/config';
import { z } from 'zod';
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3000),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(604800),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  MATCH_DURATION_FIVE_A_SIDE_MINUTES: z.coerce.number().int().positive().default(90),
  MATCH_DURATION_SEVEN_A_SIDE_MINUTES: z.coerce.number().int().positive().default(90),
  MATCH_DURATION_ELEVEN_A_SIDE_MINUTES: z.coerce.number().int().positive().default(90),
  POST_MATCH_CHAT_DURATION_MINUTES: z.coerce.number().int().positive().default(25),
  PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
  TEAM_UPLOAD_DIR: z.string().min(1).default('uploads/teams'),
});
export const env = envSchema.parse(process.env);
