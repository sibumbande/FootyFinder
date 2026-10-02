import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../apps/api/src/database/test-database-safety.js';

// Gate 7 / TKT-712 (DEC-019): the full team-match journey in a real browser against the real API,
// database and sockets. Journey 1: team-page entry -> "Teams only" -> publishing blocked until the
// team wallet covers the fee -> publish -> another team "Load my team" -> both meters fill -> both
// lineups -> team chat. Journey 2: "Play as my team" in create-match -> "Open to both" -> a player
// joins for R80 -> "Load my team" is refused. No venue cost ever reaches the browser.
assertDisposableTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const marker = `e2e-team-${Date.now().toString(36)}`;
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
      lastName: 'Team Test',
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
  return { id: userId, name: `${firstName} Team Test` };
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

/** A kickoff on the 30-minute grid, `hours` from now (Johannesburg time keeps the grid). */
const kickoff = (hours: number) => {
  const startsAt = new Date(Date.now() + hours * 60 * 60_000);
  startsAt.setUTCSeconds(0, 0);
  startsAt.setUTCMinutes(startsAt.getUTCMinutes() < 30 ? 30 : 60);
  return startsAt;
};
const slotQuery = (slug: string, fieldId: string, startsAt: Date) =>
  `venue=${encodeURIComponent(slug)}&field=${fieldId}&format=FIVE_A_SIDE&startsAt=${encodeURIComponent(startsAt.toISOString())}`;

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

test.describe('team matches (Gate 7 / DEC-019)', () => {
  test.afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  test('two teams: publish, load, fill both meters, both lineups and team chat; then an "Open to both" match a player takes first', async ({ browser }) => {
    test.setTimeout(180_000);
    const contexts = await Promise.all([1, 2, 3, 4].map(() => browser.newContext()));
    const [homePage, memberPage, awayPage, playerPage] = await Promise.all(contexts.map((context) => context.newPage()));
    const homeResponses = recordResponses(homePage);
    const awayResponses = recordResponses(awayPage);
    await Promise.all([homePage, memberPage, awayPage, playerPage].map((page) => page.goto('/')));
    const home = await register(homePage, 'home', 'Home');
    const member = await register(memberPage, 'member', 'Member');
    const away = await register(awayPage, 'away', 'Away');
    await register(playerPage, 'player', 'Player');
    for (const [page, key] of [[homePage, 'home'], [awayPage, 'away'], [playerPage, 'player']] as const) await deposit(page, key);
    const { slug, fieldId } = await createPublishedVenue(home.id, away.id);

    const homeTeamId = await createTeam(homePage, 'Rondebosch');
    const invite = await api<{ inviteUrl: string }>(homePage, `/teams/${homeTeamId}/invites`, { method: 'POST' });
    const inviteToken = invite.body.data!.inviteUrl.split('/').pop()!;
    expect((await api(memberPage, `/team-invites/${inviteToken}/accept`, { method: 'POST' })).status).toBe(200);
    const awayTeamId = await createTeam(awayPage, 'Claremont');
    await contribute(awayPage, awayTeamId, 100_000, 'away-fund');

    // --- Journey 1: team page entry, "Teams only". ---
    await homePage.goto(`/teams/${homeTeamId}`);
    const entry = homePage.getByRole('link', { name: 'Create team match' }).first();
    await expect(entry).toHaveAttribute('href', `/matches/new?playAs=team:${homeTeamId}&lock=1`);
    await contribute(homePage, homeTeamId, 10_000, 'home-short'); // R100: not enough for R480
    const firstSlot = kickoff(72);
    await homePage.goto(`/matches/new?${slotQuery(slug, fieldId, firstSlot)}&playAs=team%3A${homeTeamId}&lock=1`);
    await expect(homePage.getByRole('button', { name: /Myself \(quick match\)/ })).toHaveCount(0);
    await homePage.getByLabel('Match name').fill(`${marker} derby`);
    for (let step = 0; step < 3; step += 1) await homePage.getByRole('button', { name: 'Continue' }).click();
    await homePage.getByRole('button', { name: /Teams only/ }).click();
    await homePage.getByRole('button', { name: 'Continue' }).click();
    await homePage.getByLabel('Subs your team brings').fill('1');
    await expect(homePage.getByTestId('team-fee-breakdown')).toHaveText('R400 (5 players) + R80 (1 sub) = R480');
    await homePage.getByRole('button', { name: 'Continue' }).click();
    await expect(homePage.getByTestId('team-wallet-check')).toContainText('Top up your team wallet to at least R480 to publish this match.');
    await expect(homePage.getByRole('button', { name: 'Publish team match' })).toBeDisabled();
    await contribute(homePage, homeTeamId, 50_000, 'home-top-up');
    await homePage.getByRole('button', { name: 'Check again' }).click();
    await expect(homePage.getByTestId('team-wallet-check')).toContainText('Team wallet available: R600');
    await homePage.getByRole('button', { name: 'Publish team match' }).click();
    await expect(homePage).toHaveURL(/\/matches\/[0-9a-f-]{36}#formation$/);
    const matchId = new URL(homePage.url()).pathname.split('/').pop()!;
    await expect(homePage.getByTestId('team-meter-inactive')).toBeVisible();
    expect(await prisma.teamWalletHold.count({ where: { matchId } })).toBe(0);

    // The other team takes the side instantly with "Load my team".
    await awayPage.goto(`/matches/${matchId}`);
    await awayPage.getByRole('button', { name: 'Load my team' }).click();
    await awayPage.getByLabel('Subs your team brings').fill('0');
    await expect(awayPage.getByTestId('load-team-fee')).toHaveText('R400 (5 players) + R0 (0 subs) = R400');
    await awayPage.getByRole('button', { name: 'Confirm and load my team' }).click();
    await expect(awayPage.getByTestId('team-meter')).toHaveText('R0 / R400');

    // Both meters fill from their own team wallets; the home meter wakes up over the socket.
    await expect(homePage.getByTestId('team-meter')).toHaveText('R0 / R480', { timeout: 5_000 });
    await homePage.getByRole('button', { name: 'Fill the rest (R480)' }).click();
    await expect(homePage.getByTestId('team-meter')).toHaveText('R480 / R480');
    await awayPage.getByRole('button', { name: 'Fill the rest (R400)' }).click();
    await expect(awayPage.getByTestId('team-meter')).toHaveText('R400 / R400');
    const holds = await prisma.teamWalletHold.findMany({ where: { matchId, status: 'ACTIVE' } });
    expect(holds.reduce((sum, hold) => sum + hold.amountCents, 0)).toBe(88_000);
    const homeWallet = await prisma.teamWalletAccount.findUniqueOrThrow({ where: { teamId: homeTeamId } });
    expect(homeWallet.balanceCents).toBe(60_000); // held, not spent: taken only if the match goes ahead

    // Both lineups load; each side is its own team.
    await expect(homePage.getByRole('button', { name: /Home: .*Rondebosch/ })).toBeVisible();
    await expect(homePage.getByRole('button', { name: /Away: .*Claremont/ })).toBeVisible();

    // Team chat: a member sees the captain's message arrive live.
    await memberPage.goto(`/teams/${homeTeamId}`);
    await memberPage.getByRole('tab', { name: 'chat' }).click();
    await homePage.goto(`/teams/${homeTeamId}`);
    await homePage.getByRole('tab', { name: 'chat' }).click();
    await homePage.getByPlaceholder('Message your team').fill('Meters are full, see you Saturday');
    await homePage.getByRole('button', { name: 'Send' }).click();
    await expect(memberPage.getByText('Meters are full, see you Saturday')).toBeVisible({ timeout: 5_000 });

    // --- Journey 2: "Play as my team" in the normal create-match flow, "Open to both". ---
    await contribute(homePage, homeTeamId, 50_000, 'home-second'); // R480 is held for journey 1
    const secondSlot = kickoff(76);
    await homePage.goto(`/matches/new?${slotQuery(slug, fieldId, secondSlot)}`);
    await homePage.getByRole('button', { name: /My team .*Rondebosch/ }).click();
    await homePage.getByRole('button', { name: 'Continue' }).click();
    await homePage.getByLabel('Match name').fill(`${marker} open night`);
    for (let step = 0; step < 3; step += 1) await homePage.getByRole('button', { name: 'Continue' }).click();
    await homePage.getByRole('button', { name: /Open to both/ }).click();
    await homePage.getByRole('button', { name: 'Continue' }).click();
    await homePage.getByLabel('Subs your team brings').fill('0');
    await homePage.getByRole('button', { name: 'Continue' }).click();
    await expect(homePage.getByTestId('team-wallet-check')).toContainText('Team wallet available');
    await homePage.getByRole('button', { name: 'Publish team match' }).click();
    await expect(homePage).toHaveURL(/\/matches\/[0-9a-f-]{36}#formation$/);
    const openMatchId = new URL(homePage.url()).pathname.split('/').pop()!;

    // A player takes the other side first and pays R80 from their own wallet.
    playerPage.on('dialog', (dialog) => void dialog.accept());
    await playerPage.goto(`/matches/${openMatchId}`);
    await playerPage.getByRole('button', { name: /Join as a player/ }).click();
    await expect.poll(() => prisma.matchPayment.count({ where: { matchId: openMatchId, status: 'SUCCEEDED', amountCents: 8_000 } })).toBe(1);
    // ...so a team can no longer load into that side.
    await awayPage.goto(`/matches/${openMatchId}`);
    await expect(awayPage.getByText('Players have already joined the other side, so a team can no longer load into it.')).toBeVisible();
    await expect(awayPage.getByRole('button', { name: 'Load my team' })).toHaveCount(0);

    // Privacy (DEC-018/DEC-019): no venue cost reached either team's browser.
    for (const body of [...homeResponses, ...awayResponses]) {
      expect(body).not.toContain(String(VENUE_PRICE_CENTS));
      expect(body).not.toMatch(/"priceCents|priceCentsSnapshot|"fromPriceCents/);
    }
    // Money reconciles: every team wallet equals its ledger and never holds more than its fees.
    for (const teamId of [homeTeamId, awayTeamId]) {
      const account = await prisma.teamWalletAccount.findUniqueOrThrow({ where: { teamId } });
      const ledger = await prisma.teamWalletTransaction.aggregate({ where: { teamWalletAccountId: account.id }, _sum: { amountCents: true } });
      expect(ledger._sum.amountCents).toBe(account.balanceCents);
      const held = await prisma.teamWalletHold.aggregate({ where: { teamWalletAccountId: account.id, status: 'ACTIVE' }, _sum: { amountCents: true } });
      expect(held._sum.amountCents ?? 0).toBeLessThanOrEqual(account.balanceCents);
    }
    await Promise.all(contexts.map((context) => context.close()));
  });
});
