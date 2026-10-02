import { describe, expect, it } from 'vitest';
import { envSchema } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/footy_finder',
  JWT_SECRET: 'a-secure-test-secret-that-is-long-enough',
  NODE_ENV: 'development',
};

describe('environment contract', () => {
  it('requires NODE_ENV instead of silently selecting development cookie behavior', () => {
    expect(envSchema.safeParse({ ...valid, NODE_ENV: undefined }).success).toBe(false);
  });

  it('requires HTTPS origins and explicit proxy trust in production', () => {
    expect(
      envSchema.safeParse({
        ...valid,
        NODE_ENV: 'production',
        CLIENT_URL: 'http://player.example.test',
        ADMIN_CLIENT_URL: 'https://admin.example.test',
        PUBLIC_API_URL: 'https://api.example.test',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...valid,
        NODE_ENV: 'production',
        CLIENT_URL: 'https://player.example.test',
        ADMIN_CLIENT_URL: 'https://admin.example.test',
        PUBLIC_API_URL: 'https://api.example.test',
        TRUST_PROXY_HOPS: '1',
        ADMIN_MFA_ENCRYPTION_KEY: 'an-independent-production-mfa-key',
        EMAIL_PROVIDER: 'postmark',
        EMAIL_FROM: 'no-reply@footyfinder.co.za',
        POSTMARK_SERVER_TOKEN: 'production-postmark-token',
        PAYMENT_PROVIDER: 'paystack',
        PAYSTACK_SECRET_KEY: 'sk_live_fake-value-for-schema-test',
        VENUE_BENEFICIARY_ENCRYPTION_KEY: 'an-independent-beneficiary-encryption-key',
      }).success,
    ).toBe(true);
  });

  it('requires a separate venue beneficiary encryption key in production (TKT-607)', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      CLIENT_URL: 'https://player.example.test',
      ADMIN_CLIENT_URL: 'https://admin.example.test',
      PUBLIC_API_URL: 'https://api.example.test',
      TRUST_PROXY_HOPS: '1',
      ADMIN_MFA_ENCRYPTION_KEY: 'an-independent-production-mfa-key',
      EMAIL_PROVIDER: 'postmark',
      EMAIL_FROM: 'no-reply@footyfinder.co.za',
      POSTMARK_SERVER_TOKEN: 'production-postmark-token',
      PAYMENT_PROVIDER: 'paystack',
      PAYSTACK_SECRET_KEY: 'sk_live_fake-value-for-schema-test',
    };
    expect(envSchema.safeParse(production).success).toBe(false);
    expect(
      envSchema.safeParse({ ...production, VENUE_BENEFICIARY_ENCRYPTION_KEY: production.ADMIN_MFA_ENCRYPTION_KEY }).success,
    ).toBe(false);
  });

  it('accepts only test Paystack keys outside production and live keys in production (TKT-604)', () => {
    const fakeLive = 'sk_live_fake-value-for-schema-test';
    const devWithLive = envSchema.safeParse({ ...valid, PAYSTACK_SECRET_KEY: fakeLive });
    expect(devWithLive.success).toBe(false);
    // The error names the variable but never echoes its value.
    expect(JSON.stringify(devWithLive.error?.issues)).toContain('PAYSTACK_SECRET_KEY');
    expect(JSON.stringify(devWithLive.error?.issues)).not.toContain('fake-value');
    expect(envSchema.safeParse({ ...valid, PAYSTACK_PUBLIC_KEY: 'pk_live_fake' }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...valid, PAYMENT_PROVIDER: 'paystack', PAYSTACK_SECRET_KEY: 'sk_test_fake', PAYSTACK_PUBLIC_KEY: 'pk_test_fake' }).success,
    ).toBe(true);
    expect(envSchema.safeParse({ ...valid, PAYMENT_PROVIDER: 'paystack' }).success).toBe(false);
    // CEO touch-up batch 4, item 3 (D7): checkout channels default to card; only the four supported ones are allowed.
    expect(envSchema.parse(valid).PAYSTACK_CHANNELS).toEqual(['card']);
    expect(envSchema.parse({ ...valid, PAYSTACK_CHANNELS: 'card, capitec_pay,eft,card' }).PAYSTACK_CHANNELS).toEqual(['card', 'capitec_pay', 'eft']);
    for (const channels of ['card,qr', 'ussd', 'bank_transfer', ''])
      expect(envSchema.safeParse({ ...valid, PAYSTACK_CHANNELS: channels }).success).toBe(false);
    expect(envSchema.parse({ ...valid, PAYSTACK_SECRET_KEY: '', PAYSTACK_PUBLIC_KEY: '' }).PAYSTACK_SECRET_KEY).toBeUndefined();
    const production = {
      ...valid,
      NODE_ENV: 'production',
      CLIENT_URL: 'https://player.example.test',
      ADMIN_CLIENT_URL: 'https://admin.example.test',
      PUBLIC_API_URL: 'https://api.example.test',
      TRUST_PROXY_HOPS: '1',
      ADMIN_MFA_ENCRYPTION_KEY: 'an-independent-production-mfa-key',
      EMAIL_PROVIDER: 'postmark',
      EMAIL_FROM: 'no-reply@footyfinder.co.za',
      POSTMARK_SERVER_TOKEN: 'production-postmark-token',
      PAYMENT_PROVIDER: 'paystack',
    };
    expect(envSchema.safeParse({ ...production, PAYSTACK_SECRET_KEY: 'sk_test_fake' }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...production, PAYSTACK_SECRET_KEY: fakeLive, PAYSTACK_BASE_URL: 'http://localhost:9999' }).success,
    ).toBe(false);
  });

  it('keeps the demo payment operator out of production (TKT-603)', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      CLIENT_URL: 'https://player.example.test',
      ADMIN_CLIENT_URL: 'https://admin.example.test',
      PUBLIC_API_URL: 'https://api.example.test',
      TRUST_PROXY_HOPS: '1',
      ADMIN_MFA_ENCRYPTION_KEY: 'an-independent-production-mfa-key',
      EMAIL_PROVIDER: 'postmark',
      EMAIL_FROM: 'no-reply@footyfinder.co.za',
      POSTMARK_SERVER_TOKEN: 'production-postmark-token',
    };
    const demo = envSchema.safeParse(production);
    expect(demo.success).toBe(false);
    expect(JSON.stringify(demo.error?.issues)).toContain('PAYMENT_PROVIDER');
    expect(envSchema.parse(valid).PAYMENT_PROVIDER).toBe('demo');
  });

  it('fails closed when test-data tooling is enabled in production', () => {
    expect(
      envSchema.safeParse({
        ...valid,
        NODE_ENV: 'production',
        CLIENT_URL: 'https://player.example.test',
        ADMIN_CLIENT_URL: 'https://admin.example.test',
        PUBLIC_API_URL: 'https://api.example.test',
        TRUST_PROXY_HOPS: '1',
        ADMIN_MFA_ENCRYPTION_KEY: 'an-independent-production-mfa-key',
        ADMIN_TEST_DATA_ENABLED: 'true',
      }).success,
    ).toBe(false);
  });

  it('allows test-data tooling only on approved local disposable databases', () => {
    expect(
      envSchema.safeParse({
        ...valid,
        ADMIN_TEST_DATA_ENABLED: 'true',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/footy_finder_manual_qa',
      }).success,
    ).toBe(true);
    expect(
      envSchema.safeParse({
        ...valid,
        ADMIN_TEST_DATA_ENABLED: 'true',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/footy_finder',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...valid,
        ADMIN_TEST_DATA_ENABLED: 'true',
        DATABASE_URL: 'postgresql://postgres:postgres@db.example.test/footy_finder_test',
      }).success,
    ).toBe(false);
  });

  it('keeps private player media outside the public Team upload directory', () => {
    expect(envSchema.safeParse({ ...valid, TEAM_UPLOAD_DIR: 'uploads/shared', PLAYER_UPLOAD_DIR: 'uploads/shared' }).success).toBe(false);
  });
});
