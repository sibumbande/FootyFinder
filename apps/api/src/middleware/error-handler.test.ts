import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { mapPrismaError } from './error-handler.js';

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('private database detail', {
    code,
    clientVersion: 'test',
    meta: { target: ['privateField'] },
  });

describe('Prisma error mapping', () => {
  it('maps missing records to a safe stable 404', () => {
    expect(mapPrismaError(prismaError('P2025'))).toEqual({
      statusCode: 404,
      error: 'The requested resource was not found.',
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it.each(['P2002', 'P2003', 'P2014', 'P2034'])(
    'maps expected conflict %s without exposing Prisma metadata',
    (code) => {
      const response = mapPrismaError(prismaError(code));
      expect(response).toMatchObject({ statusCode: 409, code: 'RESOURCE_CONFLICT' });
      expect(JSON.stringify(response)).not.toContain('privateField');
      expect(JSON.stringify(response)).not.toContain('private database detail');
    },
  );

  it('does not hide unexpected Prisma errors behind a misleading client response', () => {
    expect(mapPrismaError(prismaError('P1001'))).toBeUndefined();
  });
});
