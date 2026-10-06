import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../apps/api/src/database/test-database-safety.js';
import { removeTickets } from './support/fixtures.js';

// CEO touch-up batch 1, item 1: the whole create-match wizard in a real browser. The venue and slot
// are picked inside the wizard, nothing entered earlier is lost (also across a refresh), the last
// step is "Finalise match", and publishing opens the new match at its formation. Covers a quick
// match and "Play as my team". No venue cost ever reaches the browser.
assertDisposableTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const marker = `e2e-create-${Date.now().toString(36)}`;
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
      lastName: 'Create Test',
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
  return { id: userId, name: `${firstName} Create Test` };
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
    await tx.teamMessage.deleteMany({ where: { teamId: { in: teamIds } } });
    await removeTickets(tx, matchIds, userIds);
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

/** The venue's local date `days` from now (YYYY-MM-DD in Johannesburg), for the wizard's date picker. */
const localDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date(Date.now() + days * 86_400_000));

/** The Venue step: choose the venue, a date and a time without leaving the wizard. */
async function pickSlot(page: Page, venueName: string, date: string, time: string) {
  await expect(page.getByRole('heading', { name: 'Select a venue and time' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Browse venues|Choose a venue and slot/ })).toHaveCount(0);
  await page.getByRole('button', { name: new RegExp(venueName) }).click();
  await page.getByLabel('Date').fill(date);
  await page.getByRole('button', { name: time, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(page).toHaveURL(/\/matches\/new\?.*startsAt=/);
}

test.describe('create a match: every step through to the formation (CEO batch 1)', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  test('quick match: details are kept through the venue step, Finalise match publishes, the formation opens', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    const responses = recordResponses(page);
    await page.goto('/');
    const approverContext = await browser.newContext();
    const approverPage = await approverContext.newPage();
    await approverPage.goto('/');
    const approver = await register(approverPage, 'approver', 'Approver');
    await approverContext.close();
    const host = await register(page, 'host', 'Host');
    const venue = await createPublishedVenue(host.id, approver.id);
    const venueName = `${marker} Park`;

    await page.goto('/matches/new');
    await page.getByRole('button', { name: 'Continue' }).click(); // format: 5-a-side
    await page.getByRole('spinbutton', { name: /Substitutes per team/ }).fill('4');
    await page.getByRole('checkbox', { name: /Rolling substitutions/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click(); // visibility: public
    await page.getByLabel('Match name').fill(`${marker} friday`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await pickSlot(page, venueName, localDate(3), '18:00');

    // A refresh mid-flow loses nothing either (the draft is kept for this tab).
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    await page.getByRole('button', { name: 'Previous' }).click();
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.getByLabel('Match name')).toHaveValue(`${marker} friday`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByTestId('fixed-fee-notice')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Finalise match' })).toBeVisible();
    await page.getByRole('button', { name: 'Create match' }).click();
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]{36}#formation$/);
    await expect(page.locator('#formation')).toBeInViewport();
    const matchId = new URL(page.url()).pathname.split('/').pop()!;
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { name: true, substituteCapacityPerTeam: true, rollingSubstitutes: true, format: true } });
    expect(match).toEqual({ name: `${marker} friday`, substituteCapacityPerTeam: 4, rollingSubstitutes: true, format: 'FIVE_A_SIDE' });
    // The draft is gone once published: a new match starts from the first step.
    await page.goto('/matches/new');
    await expect(page.getByText('Step 1 of', { exact: false })).toBeVisible();

    // The venue page too (CEO batch 2, item 7: no venue cancellation policy, only the FootyFinder rules).
    await page.goto(`/venues/${venue.slug}`);
    await expect(page.getByRole('link', { name: 'Terms clause 14' })).toBeVisible();
    await expect(page.getByText('Full credit more than 24 hours')).toHaveCount(0);

    // Venue costs never reach a player's browser.
    for (const body of responses) {
      expect(body).not.toContain(String(VENUE_PRICE_CENTS));
      expect(body).not.toMatch(/"priceCents|priceCentsSnapshot|"fromPriceCents/);
      // CEO touch-up batch 2, item 7: nor does the venue's own cancellation policy.
      expect(body).not.toMatch(/Full credit more than 24 hours|"cancellationPolic|"policyText/);
    }
    await context.close();
  });

  test('"Play as my team": the same flow publishes with nothing paid up front and opens the lineup', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    await register(page, 'captain', 'Captain');
    await createTeam(page, 'Wanderers');
    const venueName = `${marker} Park`;

    await page.goto('/matches/new');
    await page.getByRole('button', { name: /My team .*Wanderers/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Match name').fill(`${marker} derby`);
    await page.getByRole('button', { name: 'Continue' }).click();
    await pickSlot(page, venueName, localDate(3), '20:00');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Teams only/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Subs your team brings').fill('1');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Finalise match' })).toBeVisible();
    await expect(page.getByTestId('team-payment-note')).toContainText('Nothing is paid to publish');
    await page.getByRole('button', { name: 'Publish team match' }).click();
    await expect(page).toHaveURL(/\/matches\/[0-9a-f-]{36}#formation$/);
    await expect(page.locator('#formation')).toBeInViewport();
    const matchId = new URL(page.url()).pathname.split('/').pop()!;
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { name: true, mode: true } });
    expect(match).toEqual({ name: `${marker} derby`, mode: 'TEAM_MATCH' });
    await context.close();
  });
});
