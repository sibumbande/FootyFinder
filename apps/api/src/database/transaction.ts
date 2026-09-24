import { Prisma } from '../generated/prisma/client.js';
import { prisma } from './prisma.js';

export async function serializableTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' &&
            typeof error.meta?.code === 'string' &&
            error.meta.code === '40001'));
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error('Transaction retry exhausted.');
}
