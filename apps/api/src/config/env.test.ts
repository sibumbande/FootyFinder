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
      }).success,
    ).toBe(true);
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
});
