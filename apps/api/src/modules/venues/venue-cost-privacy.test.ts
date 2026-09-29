import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// DEC-018 proof: venue costs (ManagedFieldPrice amounts, reservation price snapshots, funding
// totals) must never appear in any player- or host-facing API response. Every fixture below
// deliberately carries prices, and every serialised response is scanned for money keys.
const VENUE_COST_KEY =
  /price|amountCents|fromPrice|funded|remaining|guarantee|obligation|requiredCents/i;
const leakedKeys = (value: unknown, path = '$'): string[] => {
  if (Array.isArray(value)) return value.flatMap((item, index) => leakedKeys(item, `${path}[${index}]`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, child]) => [
      ...(VENUE_COST_KEY.test(key) ? [`${path}.${key}`] : []),
      ...leakedKeys(child, `${path}.${key}`),
    ]);
  return [];
};
const expectNoVenueCost = (payload: unknown) => {
  const json = JSON.parse(JSON.stringify(payload));
  expect(leakedKeys(json)).toEqual([]);
  // Belt and braces: the distinctive fixture amounts must not appear anywhere in the payload.
  expect(JSON.stringify(json)).not.toMatch(/50000|60000|80000|100000/);
};

const now = new Date();
const price = (id: string, amountCents: number, format: string | null) => ({
  id,
  fieldId: 'field-1',
  amountCents,
  currency: 'ZAR',
  format,
  dayOfWeek: null,
  startMinute: null,
  endMinute: null,
  effectiveFrom: new Date(now.getTime() - 86_400_000),
  effectiveTo: null,
  createdAt: now,
});
// Italian Club-style field: one physical pitch with a different admin-only price per format.
const venueRow = {
  id: 'venue-1',
  slug: 'italian-club',
  name: 'Italian Club',
  city: 'Cape Town',
  region: 'Western Cape',
  addressLine1: '1 Club Road',
  addressLine2: null,
  postalCode: null,
  countryCode: 'ZA',
  latitude: -33.9,
  longitude: 18.4,
  timezone: 'Africa/Johannesburg',
  amenities: ['Parking'],
  publicDescription: 'A complete venue used by the venue-cost privacy test.',
  coverImageUrl: 'https://example.invalid/cover.webp',
  coverImageAlt: 'Cover',
  coverImageAttribution: 'Test',
  media: [{ url: 'https://example.invalid/1.webp', altText: 'One', attribution: 'Test' }],
  cancellationPolicies: [
    {
      effectiveFrom: new Date(now.getTime() - 86_400_000),
      effectiveTo: null,
      fullCreditBeforeHours: 24,
      lateCreditPercent: 0,
      venueCancellationPercent: 100,
      policyText: 'Policy',
    },
  ],
  fields: [
    {
      id: 'field-1',
      name: 'Main Pitch',
      description: null,
      turnaroundBufferMinutes: 15,
      supportedFormats: [{ format: 'FIVE_A_SIDE' }, { format: 'SEVEN_A_SIDE' }, { format: 'ELEVEN_A_SIDE' }],
      prices: [
        price('p5', 50_000, 'FIVE_A_SIDE'),
        price('p7', 60_000, 'SEVEN_A_SIDE'),
        price('p11', 80_000, 'ELEVEN_A_SIDE'),
      ],
      availabilityPeriods: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        startMinute: 0,
        endMinute: 1440,
      })),
      exceptions: [],
    },
  ],
};

vi.mock('../../database/prisma.js', () => ({
  prisma: {
    managedVenue: {
      findMany: vi.fn(async () => [venueRow]),
      findFirst: vi.fn(async () => venueRow),
    },
    managedVenueSlugAlias: { findUnique: vi.fn(async () => null) },
    fieldReservation: { findMany: vi.fn(async () => []) },
    walletAccount: {
      findUnique: vi.fn(async () => ({ id: 'wallet-1', userId: 'payer', balanceCents: 8_000 })),
    },
    walletHold: { aggregate: vi.fn(async () => ({ _sum: { amountCents: null } })) },
    walletTransaction: {
      findMany: vi.fn(async () => [
        { id: '00000000-0000-4000-8000-000000000001', type: 'DEPOSIT_CREDIT', amountCents: 16_000, status: 'SUCCEEDED', referenceType: 'DEPOSIT', referenceId: null, createdAt: now },
        { id: '00000000-0000-4000-8000-000000000002', type: 'MATCH_ENTRY_DEBIT', amountCents: -8_000, status: 'SUCCEEDED', referenceType: 'MATCH', referenceId: '11111111-1111-4111-8111-111111111111', createdAt: now },
      ]),
    },
    matchPayment: { findMany: vi.fn(async () => []) },
    participantCancellation: { findMany: vi.fn(async () => []) },
    // The match row carries a reservation priced at R1000; the wallet DTO must only read its name.
    match: {
      findMany: vi.fn(async () => [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Privacy match', fieldReservation: { priceCentsSnapshot: 100_000 } },
      ]),
    },
  },
}));

// Wallet, payment and payable DTOs legitimately carry the player's own amountCents, so they are
// checked with a venue-only key list plus the distinctive venue-cost fixture amounts.
const VENUE_ONLY_KEY =
  /price|venue|payable|beneficiary|bank|accountNumber|accountHolder|branch|settlement|obligation|guarantee|requiredCents|fundedCents/i;
const venueOnlyKeys = (value: unknown, path = '$'): string[] => {
  if (Array.isArray(value)) return value.flatMap((item, index) => venueOnlyKeys(item, `${path}[${index}]`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, child]) => [
      ...(VENUE_ONLY_KEY.test(key) ? [`${path}.${key}`] : []),
      ...venueOnlyKeys(child, `${path}.${key}`),
    ]);
  return [];
};
const expectNoVenueCostInMoneyDto = (payload: unknown) => {
  const json = JSON.parse(JSON.stringify(payload));
  expect(venueOnlyKeys(json)).toEqual([]);
  expect(JSON.stringify(json)).not.toMatch(/50000|60000|80000|100000/);
};

const { VenuesService } = await import('./venues.service.js');
const { playerBookingDto, adminBookingDto } = await import('../bookings/bookings.service.js');
const { toMatch } = await import('../matches/match.mapper.js');
const { bookingsRouter } = await import('../bookings/bookings.routes.js');
const { errorHandler } = await import('../../middleware/error-handler.js');
const { WalletHistoryService } = await import('../wallet/wallet-history.service.js');
const { toTopUpStatus } = await import('../payments/top-up.service.js');
const { toAdminBeneficiary, toAdminPayable } = await import('../settlement/venue-settlement.service.js');

const user = (id: string) => ({
  id,
  email: `${id}@private.invalid`,
  username: id,
  passwordHash: 'private',
  createdAt: now,
  updatedAt: now,
  profile: null,
  walletAccount: null,
  teamMemberships: [],
});
const matchRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  publicSlug: 'm-0123456789abcdef01234567',
  name: 'Privacy match',
  description: null,
  createdById: 'host',
  venueId: 'venue',
  mode: 'QUICK_GAME',
  format: 'FIVE_A_SIDE',
  substituteCapacityPerTeam: 5,
  rollingSubstitutes: false,
  rules: [],
  visibility: 'PUBLIC',
  inviteToken: null,
  inviteTokenHash: null,
  startsAt: new Date('2099-01-01T18:00:00.000Z'),
  durationMinutes: 60,
  feeCents: 8_000,
  currency: 'ZAR',
  status: 'OPEN',
  formationVersion: 0,
  cancelledAt: null,
  createdAt: now,
  updatedAt: now,
  createdBy: user('host'),
  venue: {
    id: 'venue',
    name: 'Italian Club — Main Pitch',
    addressLine1: '1 Club Road',
    addressLine2: null,
    city: 'Cape Town',
    region: 'Western Cape',
    postalCode: null,
    countryCode: 'ZA',
    latitude: null,
    longitude: null,
    createdAt: now,
    updatedAt: now,
  },
  participants: [],
  formationSlots: [],
  result: null,
  teamSides: [],
};
const reservation = {
  id: 'reservation-1',
  source: 'PLAYER_BOOKING',
  status: 'CONFIRMED',
  startsAt: new Date('2099-01-01T18:00:00.000Z'),
  endsAt: new Date('2099-01-01T19:00:00.000Z'),
  fundingDeadline: null,
  priceCentsSnapshot: 100_000,
  currencySnapshot: 'ZAR',
  organizerGuaranteeCents: 100_000,
  venueNameSnapshot: 'Italian Club',
  fieldNameSnapshot: 'Main Pitch',
  addressSnapshot: '1 Club Road',
  citySnapshot: 'Cape Town',
  createdAt: now,
  match: matchRecord,
  obligations: [
    {
      requiredCents: 100_000,
      contributions: [
        { id: 'c1', amountCents: 60_000, status: 'CAPTURED', createdAt: now, user: user('payer') },
      ],
    },
  ],
};

afterEach(() => vi.clearAllMocks());

describe('venue costs never reach players or hosts (DEC-018)', () => {
  it('public venue list and detail carry no price, even for a multi-format priced field', async () => {
    const service = new VenuesService();
    const list = await service.list();
    const detail = await service.get('italian-club');
    expectNoVenueCost(list);
    expectNoVenueCost(detail);
    expect(detail.venue.fields[0]!.supportedFormats).toEqual([
      'FIVE_A_SIDE',
      'SEVEN_A_SIDE',
      'ELEVEN_A_SIDE',
    ]);
  });

  it('calculated slots are offered (a price exists) but never expose it', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(
      new Date(Date.now() + 86_400_000),
    );
    const slots = await new VenuesService().slots('italian-club', {
      fieldId: 'field-1',
      format: 'ELEVEN_A_SIDE',
      dateFrom: today,
      dateTo: today,
    });
    expect(slots.length).toBeGreaterThan(0);
    expectNoVenueCost(slots);
  });

  it('player/host booking history carries no venue cost, funding totals, or contribution amounts', () => {
    expectNoVenueCost(playerBookingDto(reservation, 'host'));
  });

  it('the admin booking view is the only one that keeps the venue cost', () => {
    const admin = adminBookingDto(reservation);
    expect(admin).toMatchObject({ priceCents: 100_000, fundedCents: 60_000 });
    expect(admin.contributions[0]).toMatchObject({ amountCents: 60_000 });
    // Negative control: the detector used above really does catch venue-cost keys.
    expect(leakedKeys(JSON.parse(JSON.stringify(admin)))).toEqual(
      expect.arrayContaining(['$.priceCents', '$.fundedCents', '$.remainingCents']),
    );
  });

  it('match DTOs expose only the fixed player fee', () => {
    const match = toMatch(matchRecord as never, { viewerCanManage: true });
    expectNoVenueCost(match);
    expect(match.feeCents).toBe(8_000);
  });

  it('retired player funding routes answer 410 PLAYER_FIELD_BOOKING_RETIRED', async () => {
    const app = express().use(express.json()).use('/bookings', bookingsRouter).use(errorHandler);
    for (const call of [
      request(app).get('/bookings/fields'),
      request(app).post('/bookings').send({}),
      request(app).post('/bookings/11111111-1111-4111-8111-111111111111/contributions').send({ amountCents: 100 }),
    ]) {
      const response = await call;
      expect(response.status).toBe(410);
      expect(response.body).toMatchObject({ code: 'PLAYER_FIELD_BOOKING_RETIRED' });
    }
  });

  it('wallet summary and history DTOs carry no venue cost (Gate 6)', async () => {
    const service = new WalletHistoryService();
    const summary = await service.summary('payer');
    const history = await service.history('payer', { limit: 20 });
    expectNoVenueCostInMoneyDto(summary);
    expectNoVenueCostInMoneyDto(history);
    expect(history.entries[1]).toMatchObject({ amountCents: -8_000, related: { name: 'Privacy match' } });
    // Negative control for the money-DTO detector.
    expect(() => expectNoVenueCostInMoneyDto({ entries: [{ priceCentsSnapshot: 1 }] })).toThrow();
  });

  it('venue payables and bank details stay admin-only (Gate 6, TKT-607)', () => {
    // A match row that has a payable attached still maps to a player DTO without it.
    const withPayable = { ...matchRecord, venuePayable: { amountCents: 100_000, status: 'DUE' } };
    expectNoVenueCost(toMatch(withPayable as never, { viewerCanManage: true }));
    const payable = toAdminPayable({
      id: 'payable-1',
      reservationId: 'reservation-1',
      matchId: matchRecord.id,
      venueId: 'venue-1',
      amountCents: 100_000,
      currency: 'ZAR',
      status: 'DUE',
      dueAt: now,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
      match: { name: 'Privacy match', startsAt: now },
      venue: { id: 'venue-1', name: 'Italian Club' },
      adjustments: [],
    } as never);
    // Negative control: the admin payable is exactly what the player-facing detectors reject.
    expect(() => expectNoVenueCostInMoneyDto(payable)).toThrow();
    const beneficiary = toAdminBeneficiary({
      id: 'beneficiary-1',
      venueId: 'venue-1',
      displayName: 'Test Venue Trust (fake)',
      encryptedDetails: 'v1.fake.fake.fake',
      keyVersion: 1,
      accountLast4: '0001',
      linkedUserId: null,
      status: 'APPROVED',
      createdByUserId: 'admin-a',
      approvedByUserId: 'admin-b',
      approvedAt: now,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(Object.keys(beneficiary)).not.toEqual(expect.arrayContaining(['encryptedDetails']));
    expect(JSON.stringify(beneficiary)).not.toMatch(/accountNumber|branchCode|accountHolder|v1\.fake/);
  });

  it('card top-up DTOs carry no venue cost or provider internals (Gate 6)', () => {
    const topUp = toTopUpStatus({
      id: 'payment-1',
      userId: 'payer',
      walletTransactionId: 'tx-1',
      provider: 'paystack',
      reference: 'ff_topup_0123456789abcdef0123456789abcdef',
      amountCents: 16_000,
      currency: 'ZAR',
      status: 'REVIEW',
      authorizationUrl: 'https://checkout.paystack.com/x',
      initializeStartedAt: now,
      providerTransactionId: '42',
      providerStatus: 'success',
      channel: 'card',
      lastVerifiedAt: now,
      verifiedAt: null,
      creditedBy: null,
      failureReason: null,
      reviewReason: 'amount_mismatch',
      createdAt: now,
      updatedAt: now,
    });
    expectNoVenueCostInMoneyDto(topUp);
    expect(JSON.stringify(topUp)).not.toMatch(/amount_mismatch|providerTransactionId|walletTransactionId/);
  });
});
