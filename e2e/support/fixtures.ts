import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../../apps/api/src/database/test-database-safety.js';

/**
 * Disposable browser-test fixtures (players, a published venue, a team) on the disposable test
 * database, plus a cleanup that removes everything created under the marker.
 */
/** The API the browser tests talk to (override with E2E_API_URL to run against side-port servers). */
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * DEC-021: removes the match tickets of these matches and players (checkouts, payments, refunds, disputes, emails), so
 * the matches and players can be deleted. Specs that issue match credits keep those rows instead: the credit ledger
 * is append-only.
 */
export async function removeTickets(tx: Tx, matchIds: string[], userIds: string[]) {
  const checkouts = await tx.ticketCheckout.findMany({ where: { OR: [{ matchId: { in: matchIds } }, { payerId: { in: userIds } }] }, select: { id: true, providerPaymentId: true } });
  const paymentIds = checkouts.flatMap(({ providerPaymentId }) => (providerPaymentId ? [providerPaymentId] : []));
  await tx.ticketEmail.deleteMany({ where: { OR: [{ matchId: { in: matchIds } }, { checkoutId: { in: checkouts.map(({ id }) => id) } }, { userId: { in: userIds } }] } });
  await tx.providerRefund.deleteMany({ where: { providerPaymentId: { in: paymentIds } } });
  await tx.providerDispute.deleteMany({ where: { providerPaymentId: { in: paymentIds } } });
  await tx.matchTicket.deleteMany({ where: { OR: [{ matchId: { in: matchIds } }, { checkoutId: { in: checkouts.map(({ id }) => id) } }] } });
  await tx.ticketCheckout.deleteMany({ where: { id: { in: checkouts.map(({ id }) => id) } } });
  await tx.providerPayment.deleteMany({ where: { id: { in: paymentIds } } });
}

/**
 * DEC-021: a ticket purchase records the version of the Terms the player accepted the cancellation policy under, so
 * the disposable database needs the launch Terms published (docs/legal/legal-launch.json), as `legal:publish` does.
 * Versions are immutable: an existing row is left as it is.
 */
export async function ensureLaunchTerms(prisma: PrismaClient) {
  if (await prisma.legalDocument.findFirst({ where: { type: 'TERMS' }, select: { id: true } })) return;
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/legal/legal-launch.json');
  const [row] = JSON.parse(readFileSync(file, 'utf8')) as Array<{ type: 'TERMS'; version: string; title: string; contentFile: string; material: boolean; reacceptanceRequired: boolean }>;
  const content = readFileSync(resolve(dirname(file), row!.contentFile), 'utf8').trim();
  const now = new Date();
  await prisma.legalDocument.create({
    data: {
      type: row!.type, version: row!.version, title: row!.title, material: row!.material, reacceptanceRequired: row!.reacceptanceRequired,
      content, checksum: createHash('sha256').update(content, 'utf8').digest('hex'), effectiveAt: now, publishedAt: now,
    },
  }).catch(() => undefined); // another spec published it at the same moment
}

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
      async ({ path, options, base }) => {
        const response = await fetch(`${base}${path}`, {
          method: options.method ?? 'GET',
          credentials: 'include',
          headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        return { status: response.status, body: await response.json() };
      },
      { path, options, base: API_URL },
    );
  }

  async function register(page: Page, suffix: string, firstName: string, email = `${marker}-${suffix}@test.invalid`) {
    await ensureLaunchTerms(prisma);
    const response = await api<{ id: string }>(page, '/auth/register', {
      method: 'POST',
      body: {
        email,
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
          gender: 'MALE', dateOfBirth: new Date('1995-01-01T00:00:00Z'), yearsExperience: 5, cityId: city.id, onboardingStatus: 'COMPLETE',
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

  type TicketPlace = { seat: 'POSITION'; side: 'HOME' | 'AWAY'; slotId: string } | { seat: 'SUBSTITUTE'; side: 'HOME' | 'AWAY' };
  /**
   * DEC-021: buys a match ticket through the API as the signed-in player, with the cancellation-policy tick. The
   * test API runs the demo payment operator, so the ticket is confirmed straight away (no Paystack).
   */
  async function buyTicket(page: Page, matchId: string, place: TicketPlace, key: string) {
    const response = await api<{ state: string }>(page, `/matches/${matchId}/tickets/checkout`, {
      method: 'POST', body: { ...place, method: 'PAYMENT', acceptPolicy: true }, headers: { 'Idempotency-Key': `${marker}-${key}` },
    });
    expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
    expect(response.body.data?.state, JSON.stringify(response.body)).toBe('CONFIRMED');
  }

  /** DEC-021 A5: pays for named teammates' places on a team side (one demo payment). */
  async function payForTeammates(page: Page, matchId: string, side: 'HOME' | 'AWAY', playerIds: string[], key: string) {
    const response = await api<{ state: string }>(page, `/matches/${matchId}/team-sides/${side}/tickets/checkout`, {
      method: 'POST', body: { playerIds, method: 'PAYMENT', acceptPolicy: true }, headers: { 'Idempotency-Key': `${marker}-${key}` },
    });
    expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
    expect(response.body.data?.state, JSON.stringify(response.body)).toBe('CONFIRMED');
  }

  async function createTeam(page: Page, name: string) {
    const response = await api<{ id: string }>(page, '/teams', {
      method: 'POST', body: { name: `${marker} ${name}`, primaryFormat: 'FIVE_A_SIDE', formationKey: 'BALANCED_1_1_2_1' },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data!.id;
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
      if (!response.url().startsWith(API_URL) || !(response.headers()['content-type'] ?? '').includes('json')) return;
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
    // Includes matches an admin created on the fixture venue (CEO batch 3.5, item 5: their creator is the admin, who stays).
    const matches = await prisma.match.findMany({
      where: { OR: [{ createdById: { in: userIds } }, ...(managedVenueId ? [{ fieldReservation: { field: { venueId: managedVenueId } } }] : [])] },
      select: { id: true, venueId: true },
    });
    const matchIds = matches.map(({ id }) => id);
    await prisma.$transaction(async (tx) => {
      if (matchIds.length) await tx.durableJob.deleteMany({ where: { OR: matchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
      await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
      await tx.teamMatchAuditEvent.deleteMany({ where: { OR: [{ matchId: { in: matchIds } }, { teamId: { in: teamIds } }] } });
      await removeTickets(tx, matchIds, userIds);
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
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
      if (testBatchId) await tx.testDataBatch.delete({ where: { id: testBatchId } });
    });
    expect(await prisma.user.count({ where: { email: { startsWith: marker } } })).toBe(0);
  }

  /**
   * CEO touch-up batch 3.5, item 3: a platform admin whose session has passed the admin MFA check just now.
   * Its email does not start with the marker: admins write permanent audit rows, so they are never deleted.
   */
  async function registerAdmin(page: Page, suffix = 'adm') {
    const email = `admin-${suffix}-${marker}@test.invalid`;
    const { id } = await register(page, suffix, 'Admin', email);
    // Detached from the disposable test batch, which is deleted at clean-up while the admin stays.
    await prisma.user.update({ where: { id }, data: { platformRole: 'ADMIN', isTestAccount: false, testDataBatchId: null } });
    await verifyAdminSession(id);
    return { id, email };
  }

  /** Marks the admin's sessions as MFA-verified at the given time (now = fresh enough for fresh-MFA actions). */
  async function verifyAdminSession(userId: string, at = new Date()) {
    await prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { adminVerifiedAt: at } });
  }

  return { prisma, marker, PASSWORD, VENUE_PRICE_CENTS, api, register, registerAdmin, verifyAdminSession, buyTicket, payForTeammates, createTeam, createPublishedVenue, recordResponses, cleanFixtures };
}
