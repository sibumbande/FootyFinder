import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../apps/api/src/database/test-database-safety.js';

// Gate 5 / TKT-506: shared public match -> sign in -> pay/join -> claim -> second-player conflict
// -> realtime convergence, in a real browser against the real API, database, and sockets.
assertDisposableTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const marker = `e2e-claim-${Date.now().toString(36)}`;
const PASSWORD = 'FootyFinder123!';
let managedVenueId: string | undefined;
let testBatchId: string | undefined;

/** Test accounts must belong to a TestDataBatch (User_test_batch_consistency). */
async function testBatch() {
  testBatchId ??= (await prisma.testDataBatch.create({ data: { label: marker } })).id;
  return testBatchId;
}

type ApiResult<T = Record<string, unknown>> = {
  status: number;
  body: { data?: T; error?: string; code?: string };
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

async function register(page: Page, suffix: 'host' | 'alpha' | 'bravo', firstName: string) {
  const response = await api<{ id: string }>(page, '/auth/register', {
    method: 'POST',
    body: {
      email: `${marker}-${suffix}@test.invalid`,
      username: `${marker.replaceAll('-', '')}_${suffix}`.slice(0, 30),
      firstName,
      lastName: 'Claim Test',
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
        dateOfBirth: new Date('1995-01-01T00:00:00Z'),
        yearsExperience: 5,
        cityId: city.id,
        onboardingStatus: 'COMPLETE',
        preferredPositions: { deleteMany: {}, create: [{ position: 'MIDFIELDER', sortOrder: 0 }] },
      },
    });
    await tx.playerPhoto.create({
      data: {
        profileId: profile.id,
        fileKey: `${userId}.webp`,
        mimeType: 'image/webp',
        byteSize: 1,
        width: 512,
        height: 512,
      },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        emailVerifiedAt: new Date(),
        onboardingCompletedAt: new Date(),
        isTestAccount: true,
        testDataBatchId: batchId,
      },
    });
  });
  return { id: userId, firstName };
}

async function fundWallet(page: Page, key: string) {
  const deposit = await api(page, '/wallet/deposits/demo', {
    method: 'POST',
    body: { amountCents: 50_000 },
    headers: { 'Idempotency-Key': `${marker}-${key}` },
  });
  expect(deposit.status, JSON.stringify(deposit.body)).toBe(200);
}

/** A disposable published venue with one 5-a-side field open all week (dual-control approved). */
async function createPublishedVenue(submitterId: string, approverId: string) {
  const startsAt = new Date(Date.now() + 72 * 60 * 60_000);
  startsAt.setUTCSeconds(0, 0);
  startsAt.setUTCMinutes(startsAt.getUTCMinutes() < 30 ? 30 : 60);
  const venue = await prisma.managedVenue.create({
    data: {
      slug: `${marker}-venue`,
      name: `${marker} Claim Venue`,
      publicDescription: 'A complete disposable venue used only by the position-claim browser test.',
      addressLine1: '5 Claim Road',
      city: 'Cape Town',
      region: 'Western Cape',
      countryCode: 'ZA',
      latitude: -33.9249,
      longitude: 18.4241,
      timezone: 'Africa/Johannesburg',
      amenities: ['Changing rooms'],
      coverImageUrl: 'https://example.invalid/gate-5-cover.webp',
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
          url: `https://example.invalid/gate-5-${sortOrder}.webp`,
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
          name: 'Claim Pitch',
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
  return { field: venue.fields[0]!, startsAt };
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
  await prisma.$transaction(async (tx) => {
    await tx.durableJob.deleteMany({
      where: {
        OR: reservations.map(({ id }) => ({ dedupeKey: `quick-match-guarantee-settle:${id}` })),
      },
    });
    await tx.fieldReservation.deleteMany({
      where: { id: { in: reservations.map(({ id }) => id) } },
    });
    await tx.walletHold.deleteMany({
      where: {
        id: {
          in: reservations.flatMap(({ organizerGuaranteeHoldId }) =>
            organizerGuaranteeHoldId ? [organizerGuaranteeHoldId] : [],
          ),
        },
      },
    });
    await tx.match.deleteMany({ where: { id: { in: matches.map(({ id }) => id) } } });
    await tx.venue.deleteMany({ where: { id: { in: matches.map(({ venueId }) => venueId) } } });
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

const claimButton = (page: Page, position: number) =>
  page.getByRole('button', { name: `Team A position ${position}, open, claim it` });
const occupiedBy = (page: Page, position: number, name: string) =>
  page.getByRole('button', {
    name: new RegExp(`^Team A position ${position}, occupied by ${name}`),
  });

test.describe('public join and position claim', () => {
  test.afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  test('two joined players race for one position; one wins and every board converges', async ({
    browser,
  }) => {
    const [hostContext, alphaContext, bravoContext] = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext(),
    ]);
    const [hostPage, alphaPage, bravoPage] = await Promise.all([
      hostContext.newPage(),
      alphaContext.newPage(),
      bravoContext.newPage(),
    ]);
    await Promise.all([hostPage.goto('/'), alphaPage.goto('/'), bravoPage.goto('/')]);

    const host = await register(hostPage, 'host', 'Hosting');
    const alpha = await register(alphaPage, 'alpha', 'Alpha');
    const bravo = await register(bravoPage, 'bravo', 'Bravo');
    await fundWallet(hostPage, 'host');

    // Host publishes a public Quick Match on a managed field.
    const { field, startsAt } = await createPublishedVenue(host.id, alpha.id);
    const created = await api<{ id: string; publicSlug: string }>(hostPage, '/matches', {
      method: 'POST',
      body: {
        name: `${marker} claim match`,
        format: 'FIVE_A_SIDE',
        substituteCapacityPerTeam: 5,
        rollingSubstitutes: false,
        rules: [],
        visibility: 'PUBLIC',
        startsAt: startsAt.toISOString(),
        managedFieldId: field.id,
        feeCents: 2_000, // a host-sent fee must be ignored (DEC-018)
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { id: matchId, publicSlug } = created.body.data!;
    expect(publicSlug).toMatch(/^m-[a-f0-9]{24}$/);

    // Alpha arrives anonymously through the shared link, signs in, and returns to the match.
    await alphaPage.evaluate(() =>
      fetch('http://localhost:3000/auth/logout', { method: 'POST', credentials: 'include' }),
    );
    await alphaPage.goto(`/m/${publicSlug}`);
    await expect(alphaPage.getByRole('heading', { name: `${marker} claim match` })).toBeVisible();
    await alphaPage.getByRole('link', { name: 'Sign in to join' }).click();
    await alphaPage.getByLabel('Email or username').fill(`${marker}-alpha@test.invalid`);
    await alphaPage.getByLabel('Password').fill(PASSWORD);
    await alphaPage.getByRole('button', { name: 'Sign in' }).click();
    await expect(alphaPage).toHaveURL(`/m/${publicSlug}`);

    // Both players fund through the environment-gated demo deposit and pay to join Team A.
    await bravoPage.goto(`/m/${publicSlug}`);
    for (const [page, key] of [
      [alphaPage, 'alpha'],
      [bravoPage, 'bravo'],
    ] as const) {
      await fundWallet(page, key);
      await page.getByRole('button', { name: 'Join this match' }).click();
      await page.getByRole('button', { name: 'Pay & join Team A' }).click();
      await expect(page.getByText('Place confirmed')).toBeVisible();
    }
    const payments = await prisma.matchPayment.findMany({ where: { matchId } });
    expect(payments.map(({ amountCents }) => amountCents)).toEqual([8_000, 8_000]);

    // Everyone opens the lobby. Joined players see claimable open positions on their side.
    await Promise.all(
      [hostPage, alphaPage, bravoPage].map((page) => page.goto(`/matches/${matchId}`)),
    );
    await expect(claimButton(alphaPage, 1)).toBeVisible();
    await expect(claimButton(bravoPage, 1)).toBeVisible();
    await expect(hostPage.getByRole('button', { name: 'Team A position 1, open' })).toBeVisible();

    // Race: both players claim position 1 at the same moment.
    await Promise.all([claimButton(alphaPage, 1).click(), claimButton(bravoPage, 1).click()]);

    await expect
      .poll(async () =>
        (
          await prisma.formationSlot.findFirst({
            where: { matchId, team: 'HOME', slotIndex: 1 },
            include: { participant: true },
          })
        )?.participant?.userId,
      )
      .toBeTruthy();
    const slot = await prisma.formationSlot.findFirstOrThrow({
      where: { matchId, team: 'HOME', slotIndex: 1 },
      include: { participant: true },
    });
    const winner = slot.participant!.userId === alpha.id ? alpha : bravo;
    const loser = winner === alpha ? bravo : alpha;
    const winnerPage = winner === alpha ? alphaPage : bravoPage;
    const loserPage = winner === alpha ? bravoPage : alphaPage;
    const winnerName = `${winner.firstName} Claim Test`;
    const loserName = `${loser.firstName} Claim Test`;

    await expect(winnerPage.getByText('Position claimed')).toBeVisible();
    await expect(loserPage.getByText('Position taken')).toBeVisible();
    expect(
      await prisma.matchFormationEvent.count({ where: { matchId, action: 'SELF_CLAIM' } }),
    ).toBe(1);

    // All three boards converge on the single committed owner, without reloading.
    for (const page of [hostPage, winnerPage, loserPage])
      await expect(occupiedBy(page, 1, winnerName)).toBeVisible({ timeout: 3_000 });
    await expect(occupiedBy(winnerPage, 1, `${winnerName} \\(you\\)`)).toBeVisible();

    // The loser claims another open position, and the others see it arrive over the socket.
    await claimButton(loserPage, 2).click();
    await expect(loserPage.getByText('Position claimed')).toBeVisible();
    for (const page of [hostPage, winnerPage])
      await expect(occupiedBy(page, 2, loserName)).toBeVisible({ timeout: 3_000 });

    // DEC-018 messaging: the T-30 rule is explained and the live count follows the socket updates.
    await expect(
      hostPage.getByText(/This match goes ahead only if all positions are filled by .* your R80 is refunded to your wallet\./),
    ).toBeVisible();
    for (const page of [hostPage, winnerPage, loserPage])
      await expect(page.getByTestId('positions-filled')).toHaveText('2 of 10 positions filled', {
        timeout: 3_000,
      });

    // DEC-013 interaction budget, measured in this real browser.
    const timings = await loserPage.evaluate(() => ({
      feedback: window.__footyFormationTimings?.summary('pointer-to-render'),
      confirm: window.__footyFormationTimings?.summary('drop-to-confirm'),
    }));
    test.info().annotations.push({
      type: 'formation-timings',
      description: JSON.stringify(timings),
    });
    expect(timings.feedback?.count).toBeGreaterThan(0);
    expect(timings.feedback?.p95).toBeLessThan(100);
    expect(timings.confirm?.p95).toBeLessThan(2_000);

    await Promise.all([hostContext.close(), alphaContext.close(), bravoContext.close()]);
  });
});
