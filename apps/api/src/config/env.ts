import 'dotenv/config';
import { z } from 'zod';
const optionalDate = z
  .string()
  .datetime()
  .transform((value) => new Date(value))
  .optional();
export const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().positive().default(3000),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(604800),
    CLIENT_URL: z.string().url().default('http://localhost:5173'),
    ADMIN_CLIENT_URL: z.string().url().default('http://localhost:5174'),
    NODE_ENV: z.enum(['development', 'test', 'production']),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),
    LEGACY_JWT_GRACE_UNTIL: optionalDate,
    RATE_LIMIT_AUTH_PER_15_MINUTES: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_MESSAGES_PER_MINUTE: z.coerce.number().int().positive().default(30),
    RATE_LIMIT_COSTLY_MUTATIONS_PER_MINUTE: z.coerce.number().int().positive().default(20),
    ADMIN_MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
    ADMIN_MFA_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(720),
    ADMIN_TEST_DATA_ENABLED: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default('false'),
    DURABLE_JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(5000),
    DURABLE_JOB_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
    MATCH_DURATION_FIVE_A_SIDE_MINUTES: z.coerce.number().int().positive().default(90),
    MATCH_DURATION_SEVEN_A_SIDE_MINUTES: z.coerce.number().int().positive().default(90),
    MATCH_DURATION_ELEVEN_A_SIDE_MINUTES: z.coerce.number().int().positive().default(90),
    POST_MATCH_CHAT_DURATION_MINUTES: z.coerce.number().int().positive().default(25),
    PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
    TEAM_UPLOAD_DIR: z.string().min(1).default('uploads/teams'),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'production') return;
    for (const [name, url] of [
      ['CLIENT_URL', value.CLIENT_URL],
      ['ADMIN_CLIENT_URL', value.ADMIN_CLIENT_URL],
      ['PUBLIC_API_URL', value.PUBLIC_API_URL],
    ] as const)
      if (new URL(url).protocol !== 'https:')
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `${name} must use HTTPS in production`,
        });
    if (value.TRUST_PROXY_HOPS === undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TRUST_PROXY_HOPS'],
        message: 'TRUST_PROXY_HOPS must be explicitly configured in production',
      });
    if (!value.ADMIN_MFA_ENCRYPTION_KEY)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_MFA_ENCRYPTION_KEY'],
        message: 'ADMIN_MFA_ENCRYPTION_KEY is required in production',
      });
    if (value.ADMIN_TEST_DATA_ENABLED)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_TEST_DATA_ENABLED'],
        message: 'ADMIN_TEST_DATA_ENABLED cannot be enabled in production',
      });
  })
  .transform((value) => ({ ...value, TRUST_PROXY_HOPS: value.TRUST_PROXY_HOPS ?? 0 }));
export const env = envSchema.parse(process.env);
