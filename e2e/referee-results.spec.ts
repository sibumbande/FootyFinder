import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../apps/api/src/database/test-database-safety.js';
import { ensureLaunchTerms, removeTickets } from './support/fixtures.js';

// Gate 8 / TKT-811 (DEC-020): the referee journey in a real browser against the real API, database,
// lifecycle scheduler and sockets. An admin grants the referee role and assigns the referee; a team
// publishes an "Open to both" match and two players take the other side; the match kicks off (the
// scheduler records the lineup); the home captain sends their own version; the referee records the
// final result on the Referee page; stats update; a player reviews the home team; the captain
// reports a problem; the admin corrects the result. Admin steps use the admin API (the admin app is
// not started here) with a fresh MFA session. No venue cost ever reaches the browser.
assertDisposableTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const marker = `e2e-ref-${Date.now().toString(36)}`;
const PASSWORD = 'FootyFinder123!';
const VENUE_PRICE_CENTS = 97_700; // admin-only; must never appear in any browser response
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

/** Registers and onboards a player. The admin's email does not start with the marker (kept: audit rows are permanent). */
async function register(page: Page, suffix: string, firstName: string, email = `${marker}-${suffix}@test.invalid`) {
  const response = await api<{ id: string }>(page, '/auth/register', {
    method: 'POST',
    body: { email, username: `${marker.replaceAll('-', '')}_${suffix}`.slice(0, 30), firstName, lastName: 'Ref Test', password: PASSWORD },
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
        preferredPositions: { deleteMany: {}, create: [{ position: 'FORWARD', sortOrder: 0 }] },
      },
    });
    await tx.playerPhoto.create({ data: { profileId: profile.id, fileKey: `${userId}.webp`, mimeType: 'image/webp', byteSize: 1, width: 512, height: 512 } });
    await tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), isTestAccount: true, testDataBatchId: batchId },
    });
  });
  return { id: userId, name: `${firstName} Ref Test` };
}

async function createPublishedVenue(submitterId: string, approverId: string) {
  const venue = await prisma.managedVenue.create({
    data: {
      slug: `${marker}-venue`, name: `${marker} Park`,
      publicDescription: 'A complete disposable venue used only by the referee browser test.',
      addressLine1: '8 Referee Road', city: 'Cape Town', region: 'Western Cape', countryCode: 'ZA',
      latitude: -33.9249, longitude: 18.4241, timezone: 'Africa/Johannesburg', amenities: ['Changing rooms'],
      coverImageUrl: 'https://example.invalid/gate-8-cover.webp', coverImageAlt: 'Disposable football field fixture',
      coverImageAttribution: 'Footy Finder automated test fixture',
      publicationStatus: 'PUBLISHED', submittedByUserId: submitterId, submittedAt: new Date(), approvedByUserId: approverId, approvedAt: new Date(),
      media: { create: [1, 2, 3].map((sortOrder) => ({ sortOrder, url: `https://example.invalid/gate-8-${sortOrder}.webp`, altText: `Field view ${sortOrder}`, attribution: 'Footy Finder automated test fixture' })) },
      cancellationPolicies: { create: { effectiveFrom: new Date(Date.now() - 86_400_000), policyText: 'Full credit more than 24 hours before kickoff.' } },
      fields: {
        create: {
          name: 'Referee Pitch',
          supportedFormats: { create: { format: 'FIVE_A_SIDE' } },
          availabilityPeriods: { create: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 })) },
          prices: { create: { amountCents: VENUE_PRICE_CENTS, effectiveFrom: new Date(Date.now() - 86_400_000) } },
        },
      },
    },
    include: { fields: true },
  });
  managedVenueId = venue.id;
  return venue.fields[0]!.id;
}

const kickoff = (hours: number) => {
  const startsAt = new Date(Date.now() + hours * 60 * 60_000);
  startsAt.setUTCSeconds(0, 0);
  startsAt.setUTCMinutes(startsAt.getUTCMinutes() < 30 ? 30 : 60);
  return startsAt;
};

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
  await prisma.$transaction(async (tx) => {
    if (matchIds.length) await tx.durableJob.deleteMany({ where: { OR: matchIds.map((id) => ({ dedupeKey: { contains: id } })) } });
    await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
    await tx.teamMatchAuditEvent.deleteMany({ where: { OR: [{ matchId: { in: matchIds } }, { teamId: { in: teamIds } }] } });
    await tx.venuePayable.deleteMany({ where: { matchId: { in: matchIds } } });
    await tx.fieldReservation.deleteMany({ where: { matchId: { in: matchIds } } });
    await removeTickets(tx, matchIds, userIds);
    await tx.matchPayment.deleteMany({ where: { matchId: { in: matchIds } } });
    await tx.match.deleteMany({ where: { id: { in: matchIds } } });
    await tx.venue.deleteMany({ where: { id: { in: matches.map(({ venueId }) => venueId) } } });
    await tx.team.deleteMany({ where: { id: { in: teamIds } } });
    if (managedVenueId) {
      await tx.managedFieldPrice.deleteMany({ where: { field: { venueId: managedVenueId } } });
      await tx.venueCancellationPolicy.deleteMany({ where: { venueId: managedVenueId } });
      await tx.managedField.deleteMany({ where: { venueId: managedVenueId } });
      await tx.managedVenue.delete({ where: { id: managedVenueId } });
    }
    await tx.refereeGrant.deleteMany({ where: { userId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
  expect(await prisma.user.count({ where: { email: { startsWith: marker } } })).toBe(0);
}

test.describe('referees and final results (Gate 8 / DEC-020)', () => {
  test.afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  test('admin assigns a referee; the referee records the final result; stats, review, problem report and correction follow', async ({ browser }) => {
    test.setTimeout(240_000);
    const contexts = await Promise.all([1, 2, 3, 4, 5].map(() => browser.newContext()));
    const [adminPage, refPage, ownerPage, playerPage, secondPage] = await Promise.all(contexts.map((context) => context.newPage()));
    const refResponses = recordResponses(refPage);
    const playerResponses = recordResponses(playerPage);
    await Promise.all([adminPage, refPage, ownerPage, playerPage, secondPage].map((page) => page.goto('/')));
    const admin = await register(adminPage, 'admin', 'Admin', `admin-${marker}@test.invalid`);
    const ref = await register(refPage, 'ref', 'Referee');
    const owner = await register(ownerPage, 'owner', 'Owner');
    const player = await register(playerPage, 'player', 'Striker');
    const second = await register(secondPage, 'second', 'Winger');
    await ensureLaunchTerms(prisma);
    const fieldId = await createPublishedVenue(owner.id, player.id);

    // The admin (with a fresh MFA check) makes the referee.
    await prisma.user.update({ where: { id: admin.id }, data: { platformRole: 'ADMIN' } });
    await prisma.authSession.updateMany({ where: { userId: admin.id, revokedAt: null }, data: { adminVerifiedAt: new Date() } });
    expect((await api(adminPage, `/admin/referees/${ref.id}`, { method: 'POST', body: { reason: 'Qualified referee' } })).status).toBe(201);
    await refPage.goto('/');
    await expect(refPage.getByRole('link', { name: 'Referee', exact: true })).toBeVisible();

    // A team publishes an "Open to both" match; no default referee, so the admin assigns one.
    const team = await api<{ id: string }>(ownerPage, '/teams', { method: 'POST', body: { name: `${marker} Lions`, primaryFormat: 'FIVE_A_SIDE', formationKey: 'BALANCED_1_1_2_1' } });
    const teamId = team.body.data!.id;
    const published = await api<{ id: string }>(ownerPage, '/matches', {
      method: 'POST',
      body: {
        managedFieldId: fieldId, name: `${marker} final`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 0, rollingSubstitutes: false, rules: [],
        visibility: 'PUBLIC', startsAt: kickoff(72).toISOString(), playAsTeamId: teamId, otherSideMode: 'OPEN', teamSubstituteCount: 0,
      },
    });
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    const matchId = published.body.data!.id;
    const assigned = await api(adminPage, `/admin/matches/${matchId}/referee`, { method: 'PUT', body: { refereeUserId: ref.id } });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    await playerPage.goto(`/matches/${matchId}`);
    await expect(playerPage.getByTestId('match-referee')).toHaveText('FootyFinder referee: Referee Ref Test');

    // Two players take the other side with R80 match tickets (DEC-021; the demo operator confirms them).
    for (const page of [playerPage, secondPage]) {
      const joined = await api<{ state: string }>(page, `/matches/${matchId}/tickets/checkout`, {
        method: 'POST', body: { seat: 'SUBSTITUTE', side: 'AWAY', method: 'PAYMENT', acceptPolicy: true },
        headers: { 'Idempotency-Key': `${marker}-${page === playerPage ? 'p' : 's'}-join` },
      });
      expect(joined.status, JSON.stringify(joined.body)).toBeLessThan(300);
      expect(joined.body.data?.state, JSON.stringify(joined.body)).toBe('CONFIRMED');
    }

    // The referee sees the match and its lineups on the Referee page.
    await refPage.goto('/referee');
    await refPage.getByTestId('referee-match-card').filter({ hasText: `${marker} final` }).click();
    await expect(refPage.getByText('You can record the result from kickoff.')).toBeVisible();
    await expect(refPage.getByTestId('referee-lineup').filter({ hasText: 'Striker Ref Test' })).toBeVisible();

    // Kickoff: the match was confirmed at T-30 (fixture) and the real lifecycle scheduler starts it,
    // records the lineup and, once the scheduled end passes, waits for the result.
    const startsAt = new Date(Date.now() - 61 * 60_000);
    await prisma.match.update({ where: { id: matchId }, data: { startsAt, goNoGoAt: new Date(startsAt.getTime() - 30 * 60_000), confirmedAt: new Date() } });
    await expect.poll(async () => (await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).status, { timeout: 60_000 }).toBe('AWAITING_RESULT');
    expect(await prisma.matchLineupEntry.count({ where: { matchId } })).toBe(2);

    // The home captain sends their own version (evidence only).
    await ownerPage.goto(`/matches/${matchId}`);
    await ownerPage.getByRole('button', { name: 'Send your version (optional)' }).click();
    await ownerPage.getByRole('button', { name: 'Add a Individual players goal' }).click();
    await ownerPage.getByRole('button', { name: 'Review result' }).click();
    await ownerPage.getByRole('button', { name: 'Send my version' }).click();
    await expect(ownerPage.getByText('Thanks. Your version has been sent to FootyFinder.')).toBeVisible();

    // The referee records the final result: a goal by the striker, assisted by the winger.
    await refPage.reload();
    await refPage.getByRole('button', { name: 'Add a Individual players goal' }).click();
    await refPage.getByLabel('Scorer').selectOption({ label: 'Striker Ref Test' });
    await refPage.getByLabel('Assist (optional)').selectOption({ label: 'Winger Ref Test' });
    await expect(refPage.getByTestId('referee-score')).toContainText('0 - 1 Individual players');
    await refPage.getByRole('button', { name: 'Review result' }).click();
    await expect(refPage.getByRole('alertdialog')).toContainText('This result is final.');
    await refPage.getByRole('button', { name: 'Submit final result' }).click();
    // After submitting, the page refreshes to the final result card (the brief "Result recorded"
    // message may already be gone).
    await expect(refPage.getByRole('status').filter({ hasText: 'Final result' })).toContainText(`${marker} Lions 0 - 1 Individual players`);
    await expect(refPage.getByRole('status').filter({ hasText: 'Final result' })).toContainText('Striker Ref Test (assist Winger Ref Test)');
    const result = await prisma.matchResult.findUniqueOrThrow({ where: { matchId } });
    expect(result).toMatchObject({ finalSource: 'REFEREE', homeScore: 0, awayScore: 1 });

    // Players see the final result; stats count the goal and the assist.
    await playerPage.goto(`/matches/${matchId}`);
    await expect(playerPage.getByTestId('final-result')).toContainText('Individual players: Striker Ref Test (assist Winger Ref Test)');
    const stats = async (page: Page, userId: string) => (await api<{ statistics: { goals: number; assists: number; wins: number } }>(page, `/players/${userId}`)).body.data!.statistics;
    expect(await stats(playerPage, player.id)).toMatchObject({ goals: 1, assists: 0, wins: 1 });
    expect(await stats(playerPage, second.id)).toMatchObject({ goals: 0, assists: 1 });

    // The striker rates the home team (anonymous; the comment waits for approval).
    await playerPage.getByRole('radio', { name: '4 out of 5' }).check({ force: true });
    await playerPage.getByLabel('Comment (optional)').fill('Fair game, good hosts.');
    await playerPage.getByRole('button', { name: 'Send review' }).click();
    await expect(playerPage.getByTestId('my-team-review')).toContainText('4 out of 5');
    await expect(playerPage.getByTestId('my-team-review')).toContainText('comment waiting for approval');

    // The home captain reports a problem within 24 hours.
    await ownerPage.reload();
    await ownerPage.getByLabel('Report a problem with the result').fill('The winger scored, not the striker.');
    await ownerPage.getByRole('button', { name: 'Send report' }).click();
    await expect(ownerPage.getByText(/Your report \(being reviewed\)/)).toBeVisible();

    // The admin corrects the clear recording error (fresh MFA, written reason); stats follow.
    const correction = await api(adminPage, `/admin/results/${matchId}/correction`, {
      method: 'POST',
      body: {
        result: { outcome: 'PLAYED', homeScore: 0, awayScore: 1, goals: [{ side: 'AWAY', scorerUserId: second.id, ownGoal: false }], didNotPlayUserIds: [] },
        reason: 'Video shows the winger scored',
      },
    });
    expect(correction.status, JSON.stringify(correction.body)).toBe(200);
    expect(await stats(playerPage, player.id)).toMatchObject({ goals: 0, assists: 0 });
    expect(await stats(playerPage, second.id)).toMatchObject({ goals: 1, assists: 0 });
    await playerPage.reload();
    await expect(playerPage.getByTestId('final-result')).toContainText('Individual players: Winger Ref Test');
    await expect(playerPage.getByTestId('final-result')).toContainText('Recorded by FootyFinder.');

    // Privacy: no venue cost reached the referee's or a player's browser; the referee saw no contact details.
    for (const body of [...refResponses, ...playerResponses]) {
      expect(body).not.toContain(String(VENUE_PRICE_CENTS));
      expect(body).not.toMatch(/"priceCents|priceCentsSnapshot|"fromPriceCents/);
    }
    for (const body of refResponses.filter((item) => item.includes('"lineup"'))) expect(body).not.toContain('@test.invalid');
    await Promise.all(contexts.map((context) => context.close()));
  });
});
