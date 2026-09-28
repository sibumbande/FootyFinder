import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { getMaxMatchParticipants } from '@footy-finder/shared';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../apps/api/src/database/test-database-safety.js';

assertDisposableTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const marker = `e2e-${Date.now().toString(36)}`;
let managedVenueId: string | undefined;

type ApiResult<T = Record<string, unknown>> = {
  status: number;
  body: { data?: T; error?: { code?: string; message?: string } };
};

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
        headers: {
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, options },
  );
}

async function register(page: Page, suffix: 'captain' | 'player') {
  const response = await api<{ id: string }>(page, '/auth/register', {
    method: 'POST',
    body: {
      email: `${marker}-${suffix}@test.invalid`,
      username: `${marker.replaceAll('-', '')}_${suffix}`.slice(0, 30),
      firstName: suffix === 'captain' ? 'Casey' : 'Parker',
      lastName: 'Browser Test',
      password: 'FootyFinder123!',
    },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  await activateDisposableTestUser(response.body.data!.id);
  return response.body.data!;
}

async function activateDisposableTestUser(userId: string) {
  const city = await prisma.city.findUniqueOrThrow({ where: { code: 'CAPE_TOWN' } });
  await prisma.$transaction(async (tx) => {
    const profile = await tx.playerProfile.update({
      where: { userId },
      data: {
        dateOfBirth: new Date('1995-01-01T00:00:00Z'),
        yearsExperience: 5,
        cityId: city.id,
        onboardingStatus: 'COMPLETE',
        preferredPositions: { deleteMany: {}, create: [{ position: 'MIDFIELDER', sortOrder: 0 }] },
      },
    });
    await tx.playerPhoto.create({
      data: { profileId: profile.id, fileKey: `${userId}.webp`, mimeType: 'image/webp', byteSize: 1, width: 512, height: 512 },
    });
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), isTestAccount: true } });
  });
}

async function createPublishedVenue(submitterId: string, approverId: string) {
  const startsAt = new Date(Date.now() + 48 * 60 * 60_000);
  startsAt.setUTCSeconds(0, 0);
  startsAt.setUTCMinutes(startsAt.getUTCMinutes() < 30 ? 30 : 60);
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(startsAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    localParts.find((part) => part.type === type)?.value ?? '';
  const localDate = `${value('year')}-${value('month')}-${value('day')}`;
  const localTime = `${value('hour')}:${value('minute')}`;
  const venue = await prisma.managedVenue.create({
    data: {
      slug: `${marker}-venue`,
      name: `${marker} Gate 3 Venue`,
      publicDescription: 'A complete disposable venue used only by the browser critical-path test.',
      addressLine1: '3 Browser Road',
      city: 'Cape Town',
      region: 'Western Cape',
      countryCode: 'ZA',
      latitude: -33.9249,
      longitude: 18.4241,
      timezone: 'Africa/Johannesburg',
      amenities: ['Changing rooms'],
      coverImageUrl: 'https://example.invalid/gate-3-cover.webp',
      coverImageAlt: 'Disposable football field fixture',
      coverImageAttribution: 'Footy Finder automated test fixture',
      publicationStatus: 'PUBLISHED',
      submittedByUserId: submitterId,
      submittedAt: new Date(),
      approvedByUserId: approverId,
      approvedAt: new Date(),
      media: {
        create: [1, 2, 3].map((sortOrder) => ({
          sortOrder,
          url: `https://example.invalid/gate-3-${sortOrder}.webp`,
          altText: `Disposable field view ${sortOrder}`,
          attribution: 'Footy Finder automated test fixture',
        })),
      },
      cancellationPolicies: {
        create: {
          effectiveFrom: new Date(Date.now() - 86_400_000),
          policyText: 'Full credit more than 24 hours before kickoff; no late credit.',
        },
      },
      fields: {
        create: {
          name: 'E2E Pitch',
          supportedFormats: { create: { format: 'FIVE_A_SIDE' } },
          availabilityPeriods: {
            create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
              dayOfWeek,
              startMinute: 0,
              endMinute: 1440,
            })),
          },
          prices: {
            create: { amountCents: 40_000, effectiveFrom: new Date(Date.now() - 86_400_000) },
          },
        },
      },
    },
    include: { fields: true },
  });
  managedVenueId = venue.id;
  return { venue, field: venue.fields[0]!, startsAt, localDate, localTime };
}

async function cleanFixtures() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: marker } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (!userIds.length) return;
  const matches = await prisma.match.findMany({
    where: { createdById: { in: userIds } },
    select: { id: true, venueId: true },
  });
  const reservations = await prisma.fieldReservation.findMany({
    where: { matchId: { in: matches.map(({ id }) => id) } },
    select: { id: true, organizerGuaranteeHoldId: true },
  });
  const conversations = await prisma.conversation.findMany({
    where: { participants: { some: { userId: { in: userIds } } } },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.conversation.deleteMany({ where: { id: { in: conversations.map(({ id }) => id) } } });
    await tx.durableJob.deleteMany({ where: { OR: reservations.map(({ id }) => ({ dedupeKey: `quick-match-guarantee-settle:${id}` })) } });
    await tx.fieldReservation.deleteMany({ where: { id: { in: reservations.map(({ id }) => id) } } });
    await tx.walletHold.deleteMany({ where: { id: { in: reservations.flatMap(({ organizerGuaranteeHoldId }) => organizerGuaranteeHoldId ? [organizerGuaranteeHoldId] : []) } } });
    await tx.match.deleteMany({ where: { id: { in: matches.map(({ id }) => id) } } });
    await tx.team.deleteMany({ where: { ownerUserId: { in: userIds } } });
    await tx.venue.deleteMany({ where: { id: { in: matches.map(({ venueId }) => venueId) } } });
    if (managedVenueId) {
      await tx.managedFieldPrice.deleteMany({ where: { field: { venueId: managedVenueId } } });
      await tx.venueCancellationPolicy.deleteMany({ where: { venueId: managedVenueId } });
      await tx.managedField.deleteMany({ where: { venueId: managedVenueId } });
      await tx.managedVenue.delete({ where: { id: managedVenueId } });
    }
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
  expect(await prisma.user.count({ where: { email: { startsWith: marker } } })).toBe(0);
}

test.describe('browser critical path', () => {
  test.afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  test('covers auth, paid joining, CORS PUT, Team selection, messaging, and notifications', async ({
    browser,
  }) => {
    const captainContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const captainPage = await captainContext.newPage();
    const playerPage = await playerContext.newPage();
    const protectedDestination = '/matches?format=FIVE_A_SIDE#available';
    await Promise.all([captainPage.goto(protectedDestination), playerPage.goto('/')]);
    await expect(captainPage).toHaveURL(
      `/login?returnTo=${encodeURIComponent(protectedDestination)}`,
    );

    const ready = await api<{ status: string; database: string }>(captainPage, '/ready');
    expect(ready).toMatchObject({
      status: 200,
      body: { data: { status: 'ready', database: 'ready' } },
    });

    const captain = await register(captainPage, 'captain');
    const player = await register(playerPage, 'player');
    await captainPage.reload();
    await expect(captainPage).toHaveURL(protectedDestination);

    await captainPage.goto(`/login?returnTo=${encodeURIComponent('/\\attacker.invalid/steal')}`);
    await expect(captainPage).toHaveURL('/');

    const captainDeposit = await api(captainPage, '/wallet/deposits/demo', {
      method: 'POST',
      headers: { 'Idempotency-Key': `${marker}-deposit-captain` },
    });
    expect(captainDeposit.status, JSON.stringify(captainDeposit.body)).toBe(200);

    const venueFixture = await createPublishedVenue(captain.id, player.id);
    await captainPage.goto('/');
    await captainPage.getByRole('link', { name: new RegExp(venueFixture.venue.name) }).click();
    await captainPage.getByLabel('Date').fill(venueFixture.localDate);
    await captainPage.getByRole('link', { name: new RegExp(venueFixture.localTime) }).click();
    await captainPage.getByRole('button', { name: 'Continue' }).click();
    await captainPage.getByRole('button', { name: 'Continue' }).click();
    await captainPage.getByRole('button', { name: 'Continue' }).click();
    await captainPage.getByLabel('Match name').fill(`${marker} paid match`);
    await captainPage.getByRole('button', { name: 'Continue' }).click();
    await captainPage.getByRole('button', { name: 'Continue' }).click();
    await captainPage.getByLabel('Entry fee (rands)').fill('20');
    await captainPage.getByRole('button', { name: 'Continue' }).click();
    await captainPage.getByRole('button', { name: 'Create match' }).click();
    await expect(captainPage).toHaveURL(/\/matches\/[0-9a-f-]+$/);
    const quickId = captainPage.url().split('/').at(-1)!;
    const quickMatch = await prisma.match.findUniqueOrThrow({
      where: { id: quickId },
      select: { publicSlug: true, format: true, substituteCapacityPerTeam: true },
    });
    expect(quickMatch.publicSlug).toMatch(/^m-[a-f0-9]{24}$/);
    await captainPage.goto('/');
    await expect(captainPage.getByText(`${marker} paid match`)).toBeVisible();

    await playerPage.evaluate(async () => {
      await fetch('http://localhost:3000/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    });
    await playerPage.goto(`/m/${quickMatch.publicSlug}`);
    await expect(playerPage.getByRole('heading', { name: `${marker} paid match` })).toBeVisible();
    await playerPage.getByRole('link', { name: 'Sign in to join' }).click();
    await playerPage.getByLabel('Email or username').fill(`${marker}-player@test.invalid`);
    await playerPage.getByLabel('Password').fill('FootyFinder123!');
    await playerPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(playerPage).toHaveURL(`/m/${quickMatch.publicSlug}`);

    const playerDeposit = await api(playerPage, '/wallet/deposits/demo', {
      method: 'POST',
      headers: { 'Idempotency-Key': `${marker}-share-deposit-player` },
    });
    expect(playerDeposit.status, JSON.stringify(playerDeposit.body)).toBe(200);
    await playerPage.getByRole('button', { name: 'Join this match' }).click();
    await playerPage.getByRole('button', { name: 'Pay & join Team A' }).click();
    await expect(playerPage.getByText('Place confirmed')).toBeVisible();
    expect(
      await prisma.matchParticipant.count({ where: { matchId: quickId, userId: player.id } }),
    ).toBe(1);

    const team = await api<{ id: string }>(captainPage, '/teams', {
      method: 'POST',
      body: {
        name: `${marker} FC`,
        primaryFormat: 'FIVE_A_SIDE',
        formationKey: 'BALANCED_1_1_2_1',
      },
    });
    expect(team.status, JSON.stringify(team.body)).toBe(201);
    const invite = await api<{ inviteUrl: string }>(
      captainPage,
      `/teams/${team.body.data!.id}/invites`,
      { method: 'POST' },
    );
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    const inviteToken = invite.body.data!.inviteUrl.split('/').at(-1)!;
    const accepted = await api(playerPage, `/team-invites/${inviteToken}/accept`, {
      method: 'POST',
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

    const fixture = await api<{ id: string }>(captainPage, `/teams/${team.body.data!.id}/matches`, {
      method: 'POST',
      body: {
        name: `${marker} team fixture`,
        format: 'FIVE_A_SIDE',
        substituteCapacityPerTeam: 5,
        rollingSubstitutes: true,
        rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
        formationKey: 'BALANCED_1_1_2_1',
        venue: {
          name: `${marker} team pitch`,
          addressLine1: '2 Browser Road',
          city: 'Cape Town',
          region: 'Western Cape',
          countryCode: 'ZA',
        },
        startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
      },
    });
    expect(fixture.status, JSON.stringify(fixture.body)).toBe(201);
    const fixtureId = fixture.body.data!.id;
    expect(
      (
        await api(captainPage, `/matches/${fixtureId}/team-sides/HOME/availability/request`, {
          method: 'POST',
        })
      ).status,
    ).toBe(200);
    const availability = await api(
      playerPage,
      `/matches/${fixtureId}/team-sides/HOME/availability/me`,
      { method: 'PUT', body: { status: 'AVAILABLE' } },
    );
    expect(availability.status, JSON.stringify(availability.body)).toBe(200);

    const lineup = await api<{ slots: Array<{ id: string }> }>(
      captainPage,
      `/matches/${fixtureId}/team-sides/HOME/lineup`,
    );
    expect(lineup.status, JSON.stringify(lineup.body)).toBe(200);
    const slotId = lineup.body.data!.slots[0].id;
    expect(
      (
        await api(
          captainPage,
          `/matches/${fixtureId}/team-sides/HOME/lineup/slots/${slotId}/open`,
          { method: 'POST', body: {} },
        )
      ).status,
    ).toBe(200);
    const claim = await api(
      playerPage,
      `/matches/${fixtureId}/team-sides/HOME/lineup/slots/${slotId}/claim`,
      { method: 'POST' },
    );
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);

    const conversation = await api<{ id: string }>(captainPage, '/conversations', {
      method: 'POST',
      body: { userId: player.id },
    });
    expect(conversation.status, JSON.stringify(conversation.body)).toBe(201);
    const message = await api(
      captainPage,
      `/conversations/${conversation.body.data!.id}/messages`,
      { method: 'POST', body: { content: `${marker} hello` } },
    );
    expect(message.status, JSON.stringify(message.body)).toBe(201);
    const received = await api<{ messages: Array<{ content: string }> }>(
      playerPage,
      `/conversations/${conversation.body.data!.id}`,
    );
    expect(received.body.data!.messages.some(({ content }) => content === `${marker} hello`)).toBe(
      true,
    );
    const notifications = await api<Array<{ type: string }>>(playerPage, '/notifications');
    expect(notifications.body.data!.some(({ type }) => type === 'DIRECT_MESSAGE')).toBe(true);

    const capacityUsers = await Promise.all(
      Array.from(
        {
          length:
            getMaxMatchParticipants(quickMatch.format, quickMatch.substituteCapacityPerTeam) - 1,
        },
        (_, index) =>
        prisma.user.create({
          data: {
            email: `${marker}-capacity-${index}@test.invalid`,
            username: `${marker.replaceAll('-', '')}_c${index}`.slice(0, 30),
            passwordHash: 'browser-test-only',
            isTestAccount: true,
          },
        }),
      ),
    );
    await prisma.matchParticipant.createMany({
      data: capacityUsers.map((user, index) => ({
        matchId: quickId,
        userId: user.id,
        team: index % 2 ? 'HOME' : 'AWAY',
      })),
    });
    await playerPage.reload();
    await expect(playerPage.getByText('This match is full. The page remains available for match details.')).toBeVisible();
    await prisma.match.update({ where: { id: quickId }, data: { status: 'CANCELLED' } });
    await playerPage.reload();
    await expect(playerPage.getByText('This match has been cancelled and cannot be joined.')).toBeVisible();

    const privateMatch = await prisma.match.create({
      data: {
        name: `${marker} private match`,
        createdById: captain.id,
        venueId: (await prisma.match.findUniqueOrThrow({ where: { id: quickId } })).venueId,
        format: 'FIVE_A_SIDE',
        visibility: 'PRIVATE',
        startsAt: new Date(Date.now() + 96 * 60 * 60_000),
        durationMinutes: 60,
        feeCents: 0,
      },
    });
    expect(privateMatch.publicSlug).toBeNull();
    await playerPage.goto('/m/m-ffffffffffffffffffffffff');
    await expect(playerPage.getByRole('heading', { name: 'Match unavailable' })).toBeVisible();

    await captainContext.close();
    await playerContext.close();
  });
});
