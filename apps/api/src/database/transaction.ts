import { Prisma } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';

const SERIALIZATION_FAILURE = '40001';

/**
 * A serialization failure is safe to retry from the start of the transaction. Prisma reports it
 * as P2034 for ORM queries. For raw queries (for example the `SELECT ... FOR UPDATE` row locks)
 * it is P2010: older engines put the PostgreSQL code in `meta.code`, while Prisma 7 driver
 * adapters nest it under `meta.driverAdapterError.cause`. A conflict PostgreSQL detects only at
 * COMMIT reaches us as the driver adapter's own error (name DriverAdapterError, same cause); the
 * transaction has rolled back, so it is retried the same way.
 */
const isSerializationCause = (cause: { originalCode?: unknown; kind?: unknown } | undefined) =>
  cause?.originalCode === SERIALIZATION_FAILURE || cause?.kind === 'TransactionWriteConflict';

export const isRetryableSerializationError = (error: unknown) => {
  if (error instanceof Error && error.name === 'DriverAdapterError')
    return isSerializationCause((error as Error & { cause?: { originalCode?: unknown; kind?: unknown } }).cause);
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;
  const meta = error.meta as
    | {
        code?: unknown;
        driverAdapterError?: { cause?: { originalCode?: unknown; kind?: unknown } };
      }
    | undefined;
  const cause = meta?.driverAdapterError?.cause;
  return meta?.code === SERIALIZATION_FAILURE || isSerializationCause(cause);
};

export async function serializableTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableSerializationError(error) || attempt === 2) throw error;
    }
  }
  throw new Error('Transaction retry exhausted.');
}
