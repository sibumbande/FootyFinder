import { describe, expect, it } from 'vitest';
import { assertDisposableTestDatabase } from './test-database-safety.js';

describe('assertDisposableTestDatabase', () => {
  it.each([
    'postgresql://postgres:postgres@localhost:5433/footy_finder_test?schema=public',
    'postgres://postgres:postgres@127.0.0.1:5432/footy_finder_manual_qa',
    'postgresql://postgres:postgres@postgres:5432/footy_finder_ci_worker-1',
  ])('accepts an explicitly disposable test database: %s', (databaseUrl) => {
    expect(() => assertDisposableTestDatabase({ databaseUrl, nodeEnv: 'test' })).not.toThrow();
  });

  it.each([
    {
      databaseUrl: 'postgresql://postgres:secret@localhost:5432/footy_finder_test',
      nodeEnv: 'production',
      message: 'NODE_ENV=test',
    },
    {
      databaseUrl: 'postgresql://postgres:secret@db.example.com:5432/footy_finder_test',
      nodeEnv: 'test',
      message: 'approved local or CI database host',
    },
    {
      databaseUrl: 'postgresql://postgres:secret@localhost:5432/footy_finder',
      nodeEnv: 'test',
      message: 'disposable database named',
    },
    {
      databaseUrl: 'mysql://root:secret@localhost/footy_finder_test',
      nodeEnv: 'test',
      message: 'PostgreSQL',
    },
  ])(
    'rejects unsafe configuration without echoing credentials',
    ({ databaseUrl, nodeEnv, message }) => {
      expect(() => assertDisposableTestDatabase({ databaseUrl, nodeEnv })).toThrow(message);
      try {
        assertDisposableTestDatabase({ databaseUrl, nodeEnv });
      } catch (error) {
        expect(String(error)).not.toContain('secret');
      }
    },
  );

  it('rejects a missing or invalid URL', () => {
    expect(() => assertDisposableTestDatabase({ databaseUrl: undefined, nodeEnv: 'test' })).toThrow(
      'requires DATABASE_URL',
    );
    expect(() =>
      assertDisposableTestDatabase({ databaseUrl: 'not-a-url', nodeEnv: 'test' }),
    ).toThrow('valid PostgreSQL');
  });
});
