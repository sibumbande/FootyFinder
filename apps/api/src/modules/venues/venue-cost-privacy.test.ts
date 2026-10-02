import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

// DEC-018 proof: venue costs (ManagedFieldPrice amounts, reservation price snapshots, funding
// totals) must never appear in any player- or host-facing API response. Every fixture below
// deliberately carries prices, and every serialised response is scanned for money keys.
const VENUE_COST_KEY =
  /price|amountCents|fromPrice|funded|remaining|guarantee|obligation|requiredCents/i;
// CEO touch-up batch 2, item 7: the venue's own cancellation policy (an agreement between FootyFinder and the
// venue) is admin-only too. Players and guests only ever see the FootyFinder rules (ToS clause 14).
const VENUE_POLICY_KEY = /cancellationPolic|policyText|fullCreditBeforeHours|lateCreditPercent|venueCancellationPercent|closure/i;
const VENUE_POLICY_TEXT = 'VENUE-POLICY-SECRET full credit more than 24 hours before kickoff';
const leakedKeys = (value: unknown, pattern: RegExp, path = '$'): string[] => {
  if (Array.isArray(value)) return value.flatMap((item, index) => leakedKeys(item, pattern, `${path}[${index}]`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, child]) => [
      ...(pattern.test(key) ? [`${path}.${key}`] : []),
      ...leakedKeys(child, pattern, `${path}.${key}`),
    ]);
  return [];
};
const expectNoVenuePolicy = (json: unknown) => {
  expect(leakedKeys(json, VENUE_POLICY_KEY)).toEqual([]);
  expect(JSON.stringify(json)).not.toContain('VENUE-POLICY-SECRET');
  // CEO touch-up batch 3, item 3: field closures and their internal reasons are admin-only too.
  expect(JSON.stringify(json)).not.toContain('CLOSURE-SECRET');
};
const expectNoVenueCost = (payload: unknown) => {
  const json = JSON.parse(JSON.stringify(payload));
  expect(leakedKeys(json, VENUE_COST_KEY)).toEqual([]);
  // Belt and braces: the distinctive fixture amounts must not appear anywhere in the payload.
  expect(JSON.stringify(json)).not.toMatch(/50000|60000|80000|100000/);
  expectNoVenuePolicy(json);
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
  // CEO touch-up batch 3, item 2: public bio and links are fine to show.
  aboutText: 'A friendly community venue.',
  links: [{ type: 'WEBSITE', label: 'Website', url: 'https://example.invalid' }],
  cancellationPolicies: [
    {
      effectiveFrom: new Date(now.getTime() - 86_400_000),
      effectiveTo: null,
      fullCreditBeforeHours: 24,
      lateCreditPercent: 0,
      venueCancellationPercent: 100,
      policyText: VENUE_POLICY_TEXT,
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
      closures: [{ kind: 'ONE_OFF', startsAt: new Date('2099-01-01T08:00:00Z'), endsAt: new Date('2099-01-01T10:00:00Z'), dayOfWeek: null, startMinute: null, endMinute: null, startsOn: null, endsOn: null, reason: 'CLOSURE-SECRET club training' }],
    },
  ],
};

vi.mock('../../database/prisma.js', () => {
  const prisma: Record<string, unknown> = {
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
    providerPayment: { findMany: vi.fn(async () => [{ walletTransactionId: '00000000-0000-4000-8000-000000000001', channel: 'capitec_pay', refunds: [] }]) },
    walletTransaction: {
      findMany: vi.fn(async () => [
        { id: '00000000-0000-4000-8000-000000000001', type: 'DEPOSIT_CREDIT', amountCents: 16_000, status: 'SUCCEEDED', referenceType: 'DEPOSIT', referenceId: null, createdAt: now },
        { id: '00000000-0000-4000-8000-000000000002', type: 'MATCH_ENTRY_DEBIT', amountCents: -8_000, status: 'SUCCEEDED', referenceType: 'MATCH', referenceId: '11111111-1111-4111-8111-111111111111', createdAt: now },
      ]),
    },
    matchPayment: { findMany: vi.fn(async () => []) },
    participantCancellation: { findMany: vi.fn(async () => []) },
    // Gate 7: team wallet rows. The hold's match carries a R1000 reservation it must not expose.
    team: { findUnique: vi.fn(async () => ({ name: 'Privacy FC', archivedAt: null })) },
    teamMembership: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
    teamWalletAccount: { findUnique: vi.fn(async () => ({ id: 'team-wallet-1', teamId: 'team-1', balanceCents: 112_000 })) },
    teamWalletHold: {
      aggregate: vi.fn(async () => ({ _sum: { amountCents: 88_000 } })),
      findMany: vi.fn(async () => [
        { id: 'hold-1', side: 'HOME', amountCents: 88_000, createdAt: now, match: { id: '11111111-1111-4111-8111-111111111111', name: 'Privacy match', startsAt: now, fieldReservation: { priceCentsSnapshot: 100_000 } } },
      ]),
    },
    teamWalletTransaction: {
      findMany: vi.fn(async () => [
        { id: '00000000-0000-4000-8000-000000000011', type: 'CONTRIBUTION_CREDIT', amountCents: 200_000, createdAt: now, contributorUserId: 'payer', referenceType: 'TEAM', referenceId: 'team-1', contributor: { username: 'payer', profile: { displayName: 'Payer' } }, spentBy: [{ amountCents: 88_000 }] },
        { id: '00000000-0000-4000-8000-000000000012', type: 'TEAM_MATCH_FEE_DEBIT', amountCents: -88_000, createdAt: now, contributorUserId: null, referenceType: 'MATCH', referenceId: '11111111-1111-4111-8111-111111111111', contributor: null, spentBy: [] },
      ]),
    },
    // Gate 9 / TKT-910 guest views.
    matchTeam: { findMany: vi.fn(async () => []) },
    teamReview: { findMany: vi.fn(async () => []) },
    teamRecruitmentPost: {
      findMany: vi.fn(async () => [{
        id: 'post-1', teamId: 'team-1', createdById: 'u1', positions: ['GOALKEEPER'], playersWanted: 1, format: 'FIVE_A_SIDE', level: 'CASUAL',
        days: [], times: [], area: 'Woodstock', note: null, status: 'OPEN', expiresAt: new Date('2099-01-01T00:00:00.000Z'), createdAt: now,
        team: { id: 'team-1', name: 'Privacy FC', profileImageUrl: null, archivedAt: null, memberships: [{ userId: 'u1', role: 'OWNER' }], walletAccount: { balanceCents: 100_000 } },
        _count: { joinRequests: 0 },
      }]),
    },
    playerLookingCard: {
      findMany: vi.fn(async () => [{
        id: 'card-1', userId: 'u2', positions: ['FORWARD'], area: 'Salt River', days: [6], times: ['MORNING'], note: 'Keen', updatedAt: now,
        user: { id: 'u2', username: 'lwazi', accountStatus: 'ACTIVE', onboardingCompletedAt: now, friendRequestsEnabled: true, email: 'lwazi@example.invalid', profile: { displayName: 'Lwazi', avatarUrl: null, homeArea: null, city: { name: 'Cape Town' }, photo: null, preferredPositions: [{ position: 'FORWARD' }] } },
      }]),
    },
    // The match row carries a reservation priced at R1000; the wallet DTO must only read its name.
    match: {
      findMany: vi.fn(async () => [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Privacy match', fieldReservation: { priceCentsSnapshot: 100_000 } },
      ]),
    },
  };
  prisma.$transaction = vi.fn(async (work: (tx: unknown) => unknown) => work(prisma));
  return { prisma };
});

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

  it("the venue's own cancellation policy is admin-only: never in the public venue detail (CEO batch 2, item 7)", async () => {
    const detail = await new VenuesService().get('italian-club');
    expect(detail.venue).not.toHaveProperty('cancellationPolicy');
    expectNoVenuePolicy(JSON.parse(JSON.stringify(detail)));
    // Negative control: the detector catches the policy wherever it would appear.
    expect(() => expectNoVenueCost({ ...detail, venue: { ...detail.venue, cancellationPolicy: { policyText: VENUE_POLICY_TEXT } } })).toThrow();
    expect(() => expectNoVenueCost({ note: VENUE_POLICY_TEXT })).toThrow();
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
    expect(leakedKeys(JSON.parse(JSON.stringify(admin)), VENUE_COST_KEY)).toEqual(
      expect.arrayContaining(['$.priceCents', '$.fundedCents', '$.remainingCents']),
    );
  });

  it('match DTOs expose only the fixed player fee', () => {
    const match = toMatch(matchRecord as never, { viewerCanManage: true });
    expectNoVenueCost(match);
    expect(match.feeCents).toBe(8_000);
  });

  it('team match DTOs show the DEC-019 team fee but never the venue cost (Gate 7)', () => {
    const teamMatch = toMatch({
      ...matchRecord,
      mode: 'TEAM_MATCH',
      goNoGoAt: new Date('2099-01-01T17:30:00.000Z'),
      confirmedAt: null,
      cancellationReason: null,
      otherSideMode: 'OPEN',
      otherSideTakenBy: null,
      fieldReservation: reservation,
      teamSides: [{
        id: 'side-1', matchId: matchRecord.id, teamId: 'team-1', side: 'HOME', organisingUserId: 'host', formationKey: 'x',
        teamNameSnapshot: 'Privacy FC', teamImageUrlSnapshot: null, primaryColorSnapshot: null, secondaryColorSnapshot: null,
        availabilityRequestedAt: null, lineupFinalizedAt: null, starterCount: 11, substituteCount: 3, placeFeeCents: 8_000, teamFeeCents: 112_000,
      }],
    } as never, { viewerCanManage: true });
    expectNoVenueCost(teamMatch);
    expect(teamMatch.teamSides[0]).toMatchObject({ teamFeeCents: 112_000, starterCount: 11, substituteCount: 3 });
    expect(teamMatch).toMatchObject({ otherSideMode: 'OPEN', otherSideTakenBy: null });
    // Negative control: the same record with its reservation spread in would be caught.
    expect(() => expectNoVenueCost({ ...teamMatch, reservation })).toThrow();
  });

  it('the referee shown on a match is a display name only, with no venue cost or contact details (Gate 8 / D18)', () => {
    const match = toMatch({
      ...matchRecord,
      goNoGoAt: new Date('2099-01-01T17:30:00.000Z'),
      fieldReservation: reservation,
      referee: { id: 'referee-1', username: 'ref_user', email: 'ref@example.invalid', profile: { displayName: 'Sam Ref', avatarUrl: null } },
    } as never, { viewerCanManage: true });
    expectNoVenueCost(match);
    expect(match.referee).toEqual({ id: 'referee-1', displayName: 'Sam Ref', avatarUrl: null });
    expect(JSON.stringify(match)).not.toMatch(/ref@example|ref_user/);
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

  it('team wallet summary, history and hold DTOs carry no venue cost (Gate 7, TKT-702)', async () => {
    const { TeamWalletService } = await import('../team-wallet/team-wallet.service.js');
    const service = new TeamWalletService();
    const summary = await service.summary('team-1', 'payer');
    const history = await service.history('team-1', 'payer', { limit: 20 });
    const holds = await service.holds('team-1', 'payer');
    for (const dto of [summary, history, holds]) expectNoVenueCostInMoneyDto(dto);
    expect(summary).toMatchObject({ balanceCents: 112_000, heldCents: 88_000, availableCents: 24_000, viewerUnspentCents: 112_000 });
    expect(history.entries[1]).toMatchObject({ kind: 'TEAM_MATCH_FEE', related: { name: 'Privacy match' } });
    expect(holds[0]).toMatchObject({ amountCents: 88_000, match: { name: 'Privacy match' } });
    expect(JSON.stringify(holds)).not.toContain('fieldReservation');
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

  describe('guest browsing: what anyone can see without an account (Gate 9 / TKT-910)', () => {
    // CEO touch-up batch 4, item 1: gender is private too (key or value).
    const PRIVATE = /email|dateOfBirth|gender|"(FE)?MALE"|balance|wallet|payment|conversation|friend|password/i;
    const guestSafe = (payload: unknown) => {
      expectNoVenueCost(payload);
      expect(JSON.stringify(payload)).not.toMatch(PRIVATE);
    };
    // Rows carry a R1000 reservation and contact details the guest views must never pass on.
    const previewRow = {
      publicSlug: 'm-0123456789abcdef01234567', name: 'Privacy match', description: null, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2,
      rules: [], status: 'OPEN', startsAt: new Date('2099-01-01T18:00:00.000Z'), durationMinutes: 60, feeCents: 8_000,
      venue: { name: 'Italian Club', city: 'Cape Town', region: 'Western Cape' }, participants: [{ id: 'p1' }], goNoGoAt: new Date('2099-01-01T17:30:00.000Z'),
      confirmedAt: null, cancellationReason: null, formationSlots: [{ participantId: 'p1', team: 'HOME' }], otherSideMode: null, otherSideTakenBy: null,
      teamSides: [], result: null, fieldReservation: { priceCentsSnapshot: 100_000 }, createdBy: { email: 'host@example.invalid' },
    };

    it('the public match list and a played match show the fixed fee, counts and scorers only', async () => {
      const { MatchesService } = await import('../matches/matches.service.js');
      const { prisma } = await import('../../database/prisma.js');
      const findMany = (prisma as unknown as { match: { findMany: ReturnType<typeof vi.fn> } }).match.findMany;
      findMany.mockResolvedValueOnce([previewRow]);
      const list = await new MatchesService().publicList();
      guestSafe(list);
      expect(list[0]).toMatchObject({ feeCents: 8_000, capacity: { filled: 1 } });
      expect(JSON.stringify(list)).not.toMatch(/"p1"|host@example/);
      findMany.mockResolvedValueOnce([{
        ...previewRow, status: 'COMPLETED',
        teamSides: [{ side: 'HOME', teamNameSnapshot: 'Privacy FC' }, { side: 'AWAY', teamNameSnapshot: 'Guest FC' }],
        result: { homeScore: 1, awayScore: 0, outcomeType: 'PLAYED', forfeitWinner: null, finalSource: 'REFEREE', goals: [{ side: 'HOME', ownGoal: false, scorer: { displayNameSnapshot: 'Thabo', user: { accountStatus: 'ACTIVE' } }, assist: null }] },
      }]);
      const [played] = await new MatchesService().publicList();
      guestSafe(played);
      expect(played!.result).toEqual({ homeName: 'Privacy FC', awayName: 'Guest FC', homeScore: 1, awayScore: 0, outcome: 'PLAYED', forfeitWinner: null, goals: [{ side: 'HOME', ownGoal: false, scorer: 'Thabo', assister: null }] });
    });

    it('a public team page shows members, record and review average but no money or contact details', async () => {
      const { PublicBrowseService } = await import('../public/public-browse.service.js');
      const { prisma } = await import('../../database/prisma.js');
      const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
      db.team!.findUnique!.mockResolvedValueOnce({
        id: 'team-1', name: 'Privacy FC', shortName: 'PFC', profileImageUrl: null, primaryFormat: 'FIVE_A_SIDE', locationText: 'Woodstock', description: null,
        primaryColor: null, secondaryColor: null, archivedAt: null,
        memberships: [{ role: 'OWNER', user: { id: 'u1', username: 'thabo', accountStatus: 'ACTIVE', email: 'thabo@example.invalid', profile: { displayName: 'Thabo', gender: 'FEMALE', avatarUrl: null, photo: null, preferredPositions: [{ position: 'GOALKEEPER' }] } } }],
        walletAccount: { balanceCents: 100_000 },
      });
      const team = await new PublicBrowseService().team('team-1');
      guestSafe(team);
      expect(team.members).toEqual([{ userId: 'u1', username: 'thabo', displayName: 'Thabo', avatarUrl: null, role: 'OWNER', positions: ['GOALKEEPER'] }]);
      expect(team.stats).toEqual({ played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, lastFive: [] });
    });

    it('the guest recruitment board and looking cards carry no private data', async () => {
      const { RecruitmentService } = await import('../social/recruitment.service.js');
      const posts = await new RecruitmentService().listPosts(null, {});
      const cards = await new RecruitmentService().listLooking(null, {});
      guestSafe(posts);
      guestSafe(cards);
      expect(posts[0]).toMatchObject({ team: { name: 'Privacy FC' }, viewerCanManage: false, viewerRequest: null });
      expect(cards[0]!.player).toMatchObject({ displayName: 'Lwazi', relationship: { state: 'UNAVAILABLE' } });
    });
  });
});
