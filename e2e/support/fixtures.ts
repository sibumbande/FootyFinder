import { expect, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../../apps/api/src/database/test-database-safety.js';

/**
 * Disposable browser-test fixtures (players, a published venue, a team) on the disposable test
 * database, plus a cleanup that removes everything created under the marker.
 */
export function createFixtures(prefix: string) {
  assertDisposableTestDatabase({ databaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const marker = `${prefix}-${Date.now().toString(36)}`;
  const PASSWORD = 'FootyFinder123!';
  const VENUE_PRICE_CENTS = 97_300; // admin-only; must never appear in any browser response
  let managedVenueId: string | undefined;
  let testBatchId: string | undefined;

  async function testBatch() {
    testBatchId ??= (await prisma.testDataBatch.create({ data: { label: marker } })).id;
    return testBatchId;
  }

  type ApiResult<T = Record<string, unknown>> = { status: number; body: { data?: T; code?: string; error?: string } };
  async function api<T = Record<string, unknown>>(
    page: Page,
    path: string,
    options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResult<T>> {
    return page.evaluate(
      async ({ path, options }) => {
        const response = await fetch(`http://localhost:3000${path}`, {
          method: options.method ?? 'GET',
          credentials: 'include',
          headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        return { status: response.status, body: await response.json() };
      },
      { path, options },
    );
  }

  async function register(page: Page, suffix: string, firstName: string) {
    const response = await api<{ id: string }>(page, '/auth/register', {
      method: 'POST',
      body: {
        email: `${marker}-${suffix}@test.invalid`,
        username: `${marker.replaceAll('-', '')}_${suffix}`.slice(0, 30),
        firstName,
        lastName: 'Mobile Test',
        password: PASSWORD,
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const userId = response.body.data!.id;
    const city = await prisma.city.findUniqueOrThrow({ where: { code: 'CAPE_TOWN' } });
    const batchId = await testBatch();
    await prisma.$transaction(async (tx) => {
      const profile = await tx.playerProfile.update({
        where: { userId },
        data: {
          dateOfBirth: new Date('1995-01-01T00:00:00Z'), yearsExperience: 5, cityId: city.id, onboardingStatus: 'COMPLETE',
          preferredPositions: { deleteMany: {}, create: [{ position: 'MIDFIELDER', sortOrder: 0 }] },
        },
      });
      await tx.playerPhoto.create({ data: { profileId: profile.id, fileKey: `${userId}.webp`, mimeType: 'image/webp', byteSize: 1, width: 512, height: 512 } });
      await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), isTestAccount: true, testDataBatchId: batchId },
      });
    });
    return { id: userId, name: `${firstName} Mobile Test` };
  }

  async function deposit(page: Page, key: string, amountCents = 200_000) {
    const response = await api(page, '/wallet/deposits/demo', {
      method: 'POST', body: { amountCents }, headers: { 'Idempotency-Key': `${marker}-${key}` },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }

  async function createTeam(page: Page, name: string) {
    const response = await api<{ id: string }>(page, '/teams', {
      method: 'POST', body: { name: `${marker} ${name}`, primaryFormat: 'FIVE_A_SIDE', formationKey: 'BALANCED_1_1_2_1' },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data!.id;
  }

  async function contribute(page: Page, teamId: string, amountCents: number, key: string) {
    const response = await api(page, `/teams/${teamId}/wallet/contributions`, {
      method: 'POST', body: { amountCents }, headers: { 'Idempotency-Key': `${marker}-${key}` },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  }

  /** A disposable published venue with one 5-a-side field open all week (dual-control approved). */
  async function createPublishedVenue(submitterId: string, approverId: string) {
    const venue = await prisma.managedVenue.create({
      data: {
        slug: `${marker}-venue`, name: `${marker} Park`,
        publicDescription: 'A complete disposable venue used only by the team-match browser test.',
        addressLine1: '7 Team Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA',
        latitude: -33.9249, longitude: 18.4241, timezone: 'Africa/Johannesburg', amenities: ['Changing rooms'],
        coverImageUrl: 'https://example.invalid/gate-7-cover.webp', coverImageAlt: 'Disposable football field fixture',
        coverImageAttribution: 'Footy Finder automated test fixture',
        publicationStatus: 'PUBLISHED', submittedByUserId: submitterId, submittedAt: new Date(), approvedByUserId: approverId, approvedAt: new Date(),
        media: { create: [1, 2, 3].map((sortOrder) => ({ sortOrder, url: `https://example.invalid/gate-7-${sortOrder}.webp`, altText: `Field view ${sortOrder}`, attribution: 'Footy Finder automated test fixture' })) },
        cancellationPolicies: { create: { effectiveFrom: new Date(Date.now() - 86_400_000), policyText: 'Full credit more than 24 hours before kickoff.' } },
        fields: {
          create: {
            name: 'Team Pitch',
            supportedFormats: { create: { format: 'FIVE_A_SIDE' } },
            availabilityPeriods: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) },
            prices: { create: { amountCents: VENUE_PRICE_CENTS, effectiveFrom: new Date(Date.now() - 86_400_000) } },
          },
        },
      },
      include: { fields: true },
    });
    managedVenueId = venue.id;
    return { slug: venue.slug, fieldId: venue.fields[0]!.id };
  }

  /** Records every API JSON body the page receives, for the venue-cost privacy check. */
  function recordResponses(page: Page) {
    const bodies: string[] = [];
    page.on('response', async (response) => {
      if (!response.url().startsWith('http://localhost:3000') || !(response.headers()['content-type'] ?? '').includes('json')) return;
      try {
        bodies.push(await response.text());
      } catch {
        // Navigation can discard a body; nothing to check then.
      }
    });
    return bodies;
  }

  async function cleanFixtures() {
    const users = await prisma.user.findMany({ where: { email: { startsWith: marker } }, select: { id: true } });
    const userIds = users.map(({ id }) => id);
    const teams = await prisma.team.findMany({ where: { name: { startsWith: marker } }, select: { id: true } });
    const teamIds = teams.map(({ id }) => id);
    const matches = await prisma.match.findMany({ where: { createdById: { in: userIds } }, select: { id: true, venueId: true } });
    const matchIds = matches.map(({ id }) => id);
    const accounts = await prisma.teamWalletAccount.findMany({ where: { teamId: { in: teamIds } }, select: { id: true } });
    const accountIds = accounts.map(({ id }) => id);
    const teamTransactionIds = (await prisma.teamWalletTransaction.findMany({ where: { teamWalletAccountId: { in: accountIds } }, select: { id: true } })).map(({ id }) => id);
    await prisma.$transaction(async (tx) => {
      if (matchIds.length) await tx.durableJob.deleteMany({ where: { OR: matchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
      await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
      await tx.teamMatchAuditEvent.deleteMany({ where: { OR: [{ matchId: { in: matchIds } }, { teamId: { in: teamIds } }] } });
      await tx.teamWalletAllocation.deleteMany({ where: { OR: [{ contributionTransactionId: { in: teamTransactionIds } }, { debitTransactionId: { in: teamTransactionIds } }] } });
      await tx.teamWalletHold.deleteMany({ where: { teamWalletAccountId: { in: accountIds } } });
      await tx.teamWalletTransaction.deleteMany({ where: { teamWalletAccountId: { in: accountIds } } });
      await tx.teamWalletAccount.deleteMany({ where: { id: { in: accountIds } } });
      await tx.teamMessage.deleteMany({ where: { teamId: { in: teamIds } } });
      await tx.venuePayable.deleteMany({ where: { matchId: { in: matchIds } } });
      await tx.fieldReservation.deleteMany({ where: { matchId: { in: matchIds } } });
      await tx.match.deleteMany({ where: { id: { in: matchIds } } });
      await tx.venue.deleteMany({ where: { id: { in: matches.map(({ venueId }) => venueId) } } });
      await tx.team.deleteMany({ where: { id: { in: teamIds } } });
      if (managedVenueId) {
        await tx.managedFieldPrice.deleteMany({ where: { field: { venueId: managedVenueId } } });
        await tx.venueCancellationPolicy.deleteMany({ where: { venueId: managedVenueId } });
        await tx.managedField.deleteMany({ where: { venueId: managedVenueId } });
        await tx.managedVenue.delete({ where: { id: managedVenueId } });
      }
      await tx.walletTransaction.deleteMany({ where: { walletAccount: { userId: { in: userIds } } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      if (testBatchId) await tx.testDataBatch.delete({ where: { id: testBatchId } });
    });
    expect(await prisma.user.count({ where: { email: { startsWith: marker } } })).toBe(0);
  }

  return { prisma, marker, PASSWORD, VENUE_PRICE_CENTS, api, register, deposit, createTeam, contribute, createPublishedVenue, recordResponses, cleanFixtures };
}
