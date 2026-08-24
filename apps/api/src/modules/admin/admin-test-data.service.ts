import type { AdminTestDataBatch, CreateAdminTestDataBatchInput } from '@footy-finder/shared';
import { Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from './admin-audit.js';

export const isAdminTestDataEnabled = (enabled: boolean, environment: string) =>
  enabled && environment !== 'production';
const assertEnabled = () => {
  if (!isAdminTestDataEnabled(env.ADMIN_TEST_DATA_ENABLED, env.NODE_ENV))
    throw new AppError(404, 'Test-data tools are not enabled.', 'TEST_DATA_DISABLED');
};
const batchDto = (batch: any): AdminTestDataBatch => ({
  id: batch.id,
  label: batch.label,
  createdAt: batch.createdAt.toISOString(),
  accountCount: batch.users.length,
  ...(batch.users.length ? {
    accounts: batch.users.map((user: any) => ({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.profile?.displayName ?? user.username,
    })),
  } : {}),
});

export class AdminTestDataService {
  status() {
    return { enabled: isAdminTestDataEnabled(env.ADMIN_TEST_DATA_ENABLED, env.NODE_ENV), environment: env.NODE_ENV };
  }

  async list() {
    assertEnabled();
    return (await prisma.testDataBatch.findMany({
      include: { users: { include: { profile: true }, orderBy: { username: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })).map(batchDto);
  }

  async create(input: CreateAdminTestDataBatchInput, adminUserId: string, requestId?: string) {
    assertEnabled();
    const suffix = randomBytes(5).toString('hex');
    const temporaryPassword = `FootyTest!${randomBytes(6).toString('base64url')}9`;
    const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
    const batch = await serializableTransaction(async (tx) => {
      const created = await tx.testDataBatch.create({ data: { label: input.label, createdByAdminUserId: adminUserId } });
      for (let index = 1; index <= input.accountCount; index += 1) {
        const sequence = String(index).padStart(2, '0');
        await tx.user.create({
          data: {
            email: `ff-test-${suffix}-${sequence}@test.invalid`,
            username: `ff_test_${suffix}_${sequence}`,
            passwordHash,
            isTestAccount: true,
            testDataBatchId: created.id,
            profile: { create: { displayName: `Test Player ${sequence}` } },
            walletAccount: { create: { currency: 'ZAR' } },
          },
        });
      }
      await appendAdminAudit(tx, { actorUserId: adminUserId, action: 'TEST_DATA_BATCH_CREATED', entityType: 'TEST_DATA_BATCH', entityId: created.id, requestId, metadata: { label: input.label, accountCount: input.accountCount } });
      return tx.testDataBatch.findUniqueOrThrow({ where: { id: created.id }, include: { users: { include: { profile: true }, orderBy: { username: 'asc' } } } });
    });
    return { ...batchDto(batch), temporaryPassword };
  }

  async remove(batchId: string, adminUserId: string, requestId?: string) {
    assertEnabled();
    try {
      return await serializableTransaction(async (tx) => {
        const batch = await tx.testDataBatch.findUnique({ where: { id: batchId }, include: { users: { select: { id: true, isTestAccount: true, testDataBatchId: true } } } });
        if (!batch) throw new AppError(404, 'Test-data batch not found.', 'TEST_DATA_BATCH_NOT_FOUND');
        if (batch.users.some((user) => !user.isTestAccount || user.testDataBatchId !== batchId))
          throw new AppError(409, 'The batch contains an account outside its deletion boundary.', 'TEST_DATA_BOUNDARY_VIOLATION');
        await tx.user.deleteMany({ where: { testDataBatchId: batchId, isTestAccount: true } });
        await tx.testDataBatch.delete({ where: { id: batchId } });
        await appendAdminAudit(tx, { actorUserId: adminUserId, action: 'TEST_DATA_BATCH_DELETED', entityType: 'TEST_DATA_BATCH', entityId: batchId, requestId, metadata: { label: batch.label, accountCount: batch.users.length } });
        return { success: true, deletedAccounts: batch.users.length };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2003', 'P2014'].includes(error.code))
        throw new AppError(409, 'This test batch has linked domain activity and cannot be safely removed.', 'TEST_DATA_IN_USE');
      throw error;
    }
  }
}
