import 'dotenv/config';
import { resolve } from 'node:path';
import { z } from 'zod';
import { PAYMENT_CHANNELS } from '@footy-finder/shared';
import { assertDisposableDevelopmentOrTestDatabase } from '../database/test-database-safety.js';
const optionalDate = z
  .string()
  .datetime()
  .transform((value) => new Date(value))
  .optional();
// An empty value (e.g. 'PAYSTACK_SECRET_KEY=' copied from .env.example) means not configured.
const optionalSecret = z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());
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
    RATE_LIMIT_PUBLIC_PREVIEWS_PER_MINUTE: z.coerce.number().int().positive().default(120),
    ADMIN_MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
    ADMIN_MFA_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(720),
    ADMIN_SETTLEMENT_MFA_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    // TKT-607: encrypts venue bank details at rest. Separate from every other key.
    VENUE_BENEFICIARY_ENCRYPTION_KEY: z.string().min(32).optional(),
    ADMIN_TEST_DATA_ENABLED: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default('false'),
    DURABLE_JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(5000),
    DURABLE_JOB_LOCK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
    BOOKING_FUNDING_MINUTES: z.coerce.number().int().min(5).max(1440).default(15),
    POST_MATCH_CHAT_DURATION_MINUTES: z.coerce.number().int().positive().default(25),
    PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
    TEAM_UPLOAD_DIR: z.string().min(1).default('uploads/teams'),
    PLAYER_UPLOAD_DIR: z.string().min(1).default('uploads/players'),
    // CEO touch-up batch 3, item 1: public venue photos (local disk today; R2 before launch, see D2).
    VENUE_UPLOAD_DIR: z.string().min(1).default('uploads/venues'),
    EMAIL_PROVIDER: z.enum(['console', 'test', 'postmark']).default('console'),
    EMAIL_FROM: z.string().email().default('no-reply@footyfinder.test'),
    POSTMARK_SERVER_TOKEN: z.string().min(1).optional(),
    // DEC-011 / TKT-603: 'demo' auto-succeeds and exists only in development/test.
    PAYMENT_PROVIDER: z.enum(['demo', 'paystack']).default('demo'),
    // TKT-604: Paystack credentials are owned by Platform Operations. Never log or echo them.
    PAYSTACK_SECRET_KEY: optionalSecret,
    PAYSTACK_PUBLIC_KEY: optionalSecret,
    PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),
    // CEO touch-up batch 4, item 3 (D7): the checkout channels to offer, comma-separated Paystack codes. Only card,
    // apple_pay, capitec_pay and eft are allowed (anything else stops the server); checkout shows exactly these.
    PAYSTACK_CHANNELS: z
      .string()
      .default('card')
      .transform((value) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))])
      .pipe(z.array(z.enum(PAYMENT_CHANNELS)).min(1, 'PAYSTACK_CHANNELS needs at least one channel')),
    // TKT-605: optional comma-separated Paystack webhook source IPs (the signature is always checked).
    PAYSTACK_WEBHOOK_IP_ALLOWLIST: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((value, context) => {
    if (resolve(value.PLAYER_UPLOAD_DIR) === resolve(value.TEAM_UPLOAD_DIR))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PLAYER_UPLOAD_DIR'],
        message: 'PLAYER_UPLOAD_DIR must be separate from the public Team upload directory',
      });
    if (resolve(value.PLAYER_UPLOAD_DIR) === resolve(value.VENUE_UPLOAD_DIR))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PLAYER_UPLOAD_DIR'],
        message: 'PLAYER_UPLOAD_DIR must be separate from the public venue upload directory',
      });
    if (value.ADMIN_TEST_DATA_ENABLED) {
      try {
        assertDisposableDevelopmentOrTestDatabase({
          databaseUrl: value.DATABASE_URL,
          nodeEnv: value.NODE_ENV,
        });
      } catch (error) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ADMIN_TEST_DATA_ENABLED'],
          message: error instanceof Error ? error.message : 'Unsafe test-data configuration.',
        });
      }
    }
    // Test keys outside production, live keys only in production (messages never include the key).
    const secretPrefix = value.NODE_ENV === 'production' ? 'sk_live_' : 'sk_test_';
    const publicPrefix = value.NODE_ENV === 'production' ? 'pk_live_' : 'pk_test_';
    if (value.PAYSTACK_SECRET_KEY && !value.PAYSTACK_SECRET_KEY.startsWith(secretPrefix))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYSTACK_SECRET_KEY'],
        message: `PAYSTACK_SECRET_KEY must be a ${secretPrefix} key in ${value.NODE_ENV}`,
      });
    if (value.PAYSTACK_PUBLIC_KEY && !value.PAYSTACK_PUBLIC_KEY.startsWith(publicPrefix))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYSTACK_PUBLIC_KEY'],
        message: `PAYSTACK_PUBLIC_KEY must be a ${publicPrefix} key in ${value.NODE_ENV}`,
      });
    if (value.PAYMENT_PROVIDER === 'paystack' && !value.PAYSTACK_SECRET_KEY)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYSTACK_SECRET_KEY'],
        message: 'PAYSTACK_SECRET_KEY is required when PAYMENT_PROVIDER is paystack',
      });
    if (value.NODE_ENV !== 'production') return;
    if (value.PAYSTACK_BASE_URL !== 'https://api.paystack.co')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYSTACK_BASE_URL'],
        message: 'PAYSTACK_BASE_URL must be https://api.paystack.co in production',
      });
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
    if (!value.VENUE_BENEFICIARY_ENCRYPTION_KEY)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VENUE_BENEFICIARY_ENCRYPTION_KEY'],
        message: 'VENUE_BENEFICIARY_ENCRYPTION_KEY is required in production',
      });
    else if (value.VENUE_BENEFICIARY_ENCRYPTION_KEY === value.ADMIN_MFA_ENCRYPTION_KEY)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['VENUE_BENEFICIARY_ENCRYPTION_KEY'],
        message: 'VENUE_BENEFICIARY_ENCRYPTION_KEY must differ from ADMIN_MFA_ENCRYPTION_KEY',
      });
    if (value.ADMIN_TEST_DATA_ENABLED)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_TEST_DATA_ENABLED'],
        message: 'ADMIN_TEST_DATA_ENABLED cannot be enabled in production',
      });
    if (value.EMAIL_PROVIDER !== 'postmark')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_PROVIDER'],
        message: 'EMAIL_PROVIDER must be postmark in production',
      });
    if (!value.POSTMARK_SERVER_TOKEN)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['POSTMARK_SERVER_TOKEN'],
        message: 'POSTMARK_SERVER_TOKEN is required in production',
      });
    if (value.PAYMENT_PROVIDER !== 'paystack')
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_PROVIDER'],
        message: 'PAYMENT_PROVIDER must be paystack in production; the demo operator is development/test only',
      });
    if (value.EMAIL_FROM.toLowerCase() === 'no-reply@footyfinder.test' || value.EMAIL_FROM.toLowerCase().endsWith('.test'))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_FROM'],
        message: 'EMAIL_FROM must be an explicitly configured verified production sender',
      });
  })
  .transform((value) => ({ ...value, TRUST_PROXY_HOPS: value.TRUST_PROXY_HOPS ?? 0 }));
export const env = envSchema.parse(process.env);
