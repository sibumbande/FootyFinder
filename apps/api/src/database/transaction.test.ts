import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { isRetryableSerializationError } from './transaction.js';

const knownError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: 'test', meta });

describe('serializable transaction retry classification', () => {
  it('retries ORM serialization conflicts', () => {
    expect(isRetryableSerializationError(knownError('P2034'))).toBe(true);
  });

  it('retries raw-query serialization failures reported with a top-level PostgreSQL code', () => {
    expect(isRetryableSerializationError(knownError('P2010', { code: '40001' }))).toBe(true);
  });

  it('retries raw-query serialization failures reported by the Prisma 7 driver adapter', () => {
    expect(
      isRetryableSerializationError(
        knownError('P2010', {
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              originalCode: '40001',
              originalMessage: 'could not serialize access due to concurrent update',
              kind: 'TransactionWriteConflict',
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it('does not retry other raw-query or domain failures', () => {
    expect(
      isRetryableSerializationError(
        knownError('P2010', {
          driverAdapterError: { cause: { originalCode: '23505', kind: 'UniqueConstraintViolation' } },
        }),
      ),
    ).toBe(false);
    expect(isRetryableSerializationError(knownError('P2002'))).toBe(false);
    expect(isRetryableSerializationError(new Error('domain failure'))).toBe(false);
  });
});
