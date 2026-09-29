import { MATCH_FEE_CENTS } from '@footy-finder/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinancialRepository } from '../wallet/financial.repository.js';

// Run the service's transactional work against an in-memory transaction client so the test can
// capture exactly what each create path writes, without a database.
const captured = {
  match: [] as Array<Record<string, unknown>>,
  reservation: [] as Array<Record<string, unknown>>,
  jobs: [] as Array<Record<string, unknown>>,
};
const STOP = new Error('STOP_AFTER_WRITES');

const kickoff = (() => {
  const date = new Date(Date.now() + 3 * 86_400_000);
  date.setUTCHours(12, 0, 0, 0);
  return date;
})();

const field = {
  id: 'field-1',
  name: 'Pitch One',
  status: 'ACTIVE',
  turnaroundBufferMinutes: 15,
  venue: {
    name: 'Italian Club',
    isActive: true,
    publicationStatus: 'PUBLISHED',
    timezone: 'Africa/Johannesburg',
    addressLine1: '1 Test Road',
    addressLine2: null,
    city: 'Cape Town',
    region: 'Western Cape',
    postalCode: null,
    countryCode: 'ZA',
    latitude: -33.9,
    longitude: 18.4,
    cancellationPolicies: [
      {
        id: 'policy-1',
        fullCreditBeforeHours: 24,
        lateCreditPercent: 0,
        venueCancellationPercent: 100,
        policyText: 'policy',
      },
    ],
  },
  supportedFormats: [{ format: 'FIVE_A_SIDE' }],
  availabilityPeriods: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    startMinute: 0,
    endMinute: 1440,
  })),
  exceptions: [],
  prices: [
    {
      id: 'price-1',
      amountCents: 50_000,
      currency: 'ZAR',
      format: null,
      dayOfWeek: null,
      startMinute: null,
      endMinute: null,
    },
  ],
};

const tx = {
  managedField: { findUnique: vi.fn(async () => field) },
  match: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      captured.match.push(data);
      return { id: 'match-1' };
    }),
    findUniqueOrThrow: vi.fn(async () => {
      throw STOP;
    }),
  },
  fieldReservation: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      captured.reservation.push(data);
      return { id: 'reservation-1' };
    }),
    findUniqueOrThrow: vi.fn(async () => {
      throw STOP;
    }),
  },
  durableJob: {
    upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
      captured.jobs.push(create);
      return create;
    }),
  },
  adminAuditLog: { create: vi.fn(async () => ({})) },
};

vi.mock('../../database/transaction.js', () => ({
  serializableTransaction: (work: (client: unknown) => Promise<unknown>) => work(tx),
}));

const { BookingsService } = await import('./bookings.service.js');

const input = {
  managedFieldId: 'field-1',
  name: 'Fixed fee match',
  format: 'FIVE_A_SIDE' as const,
  substituteCapacityPerTeam: 5,
  rollingSubstitutes: false,
  rules: [],
  visibility: 'PUBLIC' as const,
  startsAt: kickoff.toISOString(),
};

const financial = () =>
  ({
    createHold: vi.fn(async () => ({ hold: { id: 'hold-1' }, replayed: false })),
  }) as unknown as FinancialRepository & { createHold: ReturnType<typeof vi.fn> };

beforeEach(() => {
  captured.match.length = 0;
  captured.reservation.length = 0;
  captured.jobs.length = 0;
});

describe('Quick Match creation fee (DEC-018)', () => {
  it('sets the platform-fixed R80 fee on a host-created match, ignoring any host-sent fee', async () => {
    const service = new BookingsService(financial());
    await expect(
      service.createQuickMatch({ ...input, feeCents: 45_000 } as typeof input, 'host-1'),
    ).rejects.toBe(STOP);
    expect(captured.match[0]).toMatchObject({ feeCents: MATCH_FEE_CENTS });
    expect(MATCH_FEE_CENTS).toBe(8_000);
  });

  it('sets the platform-fixed R80 fee on an admin-loaded match (previously free)', async () => {
    const service = new BookingsService(financial());
    await expect(service.createAdmin(input, 'admin-1', 'request-1')).rejects.toBe(STOP);
    expect(captured.match[0]).toMatchObject({ feeCents: MATCH_FEE_CENTS });
  });
});
