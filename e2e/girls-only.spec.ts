import { expect, test } from '@playwright/test';
import { createFixtures } from './support/fixtures.js';

// CEO touch-up batch 4, item 1: gender is asked once (existing players at their next sign-in), and girls-only
// matches carry a badge and refuse male players.
const f = createFixtures('e2e-girls');
let matchId = '';
let publicSlug = '';
let maleEmail = '';
let femaleEmail = '';
let maleId = '';

test.describe('gender and girls-only matches (CEO batch 4, item 1)', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    const approver = await f.register(page, 'approver', 'Approver');
    await context.clearCookies();
    const male = await f.register(page, 'male', 'Sipho');
    maleId = male.id;
    maleEmail = `${f.marker}-male@test.invalid`;
    await context.clearCookies();
    const female = await f.register(page, 'female', 'Anele');
    femaleEmail = `${f.marker}-female@test.invalid`;
    await f.prisma.playerProfile.update({ where: { userId: female.id }, data: { gender: 'FEMALE' } });
    const venue = await f.createPublishedVenue(female.id, approver.id);
    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    startsAt.setUTCHours(16, 0, 0, 0);
    const created = await f.api<{ id: string; publicSlug: string }>(page, '/matches', {
      method: 'POST',
      body: { name: `${f.marker} girls night`, format: 'FIVE_A_SIDE', visibility: 'PUBLIC', girlsOnly: true, startsAt: startsAt.toISOString(), managedFieldId: venue.fieldId },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    matchId = created.body.data!.id;
    publicSlug = created.body.data!.publicSlug;
    await context.close();
  });

  test.afterAll(async () => {
    await f.cleanFixtures();
    await f.prisma.$disconnect();
  });

  test('an existing player without a gender is asked once, then carries on', async ({ browser }) => {
    await f.prisma.playerProfile.update({ where: { userId: maleId }, data: { gender: null } });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto('/');
    expect((await f.api(page, '/auth/login', { method: 'POST', body: { identifier: maleEmail, password: f.PASSWORD } })).status).toBe(200);
    await page.goto('/matches');
    await expect(page).toHaveURL(/\/gender\?returnTo=%2Fmatches/);
    await expect(page.getByTestId('gender-choice')).toContainText('Never shown to other players');
    await page.getByLabel('Male', { exact: true }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page).toHaveURL(/\/matches$/);
    expect((await f.prisma.playerProfile.findUniqueOrThrow({ where: { userId: maleId } })).gender).toBe('MALE');
    // Saved once: the onboarding card now shows it locked.
    await page.goto('/onboarding');
    await expect(page.getByTestId('gender-choice').getByRole('radio', { name: 'Male', exact: true })).toBeDisabled();
    await context.close();
  });

  test('girls-only matches show a badge and refuse male players', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/m/${publicSlug}`);
    await expect(page.getByTestId('girls-only-badge')).toBeVisible();
    expect(await page.content()).not.toMatch(/"(FE)?MALE"/);
    expect((await f.api(page, '/auth/login', { method: 'POST', body: { identifier: maleEmail, password: f.PASSWORD } })).status).toBe(200);
    await page.goto('/matches');
    await expect(page.getByRole('article').filter({ hasText: `${f.marker} girls night` }).getByTestId('girls-only-badge')).toBeVisible();
    await page.goto(`/matches/${matchId}`);
    await expect(page.getByTestId('girls-only-badge')).toBeVisible();
    const refused = await f.api(page, `/matches/${matchId}/join`, { method: 'POST', body: { team: 'HOME' }, headers: { 'Idempotency-Key': `${f.marker}-male-join` } });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('GIRLS_ONLY');
    await context.clearCookies();
    expect((await f.api(page, '/auth/login', { method: 'POST', body: { identifier: femaleEmail, password: f.PASSWORD } })).status).toBe(200);
    await f.deposit(page, 'female-funds');
    const joined = await f.api(page, `/matches/${matchId}/join`, { method: 'POST', body: { team: 'HOME' }, headers: { 'Idempotency-Key': `${f.marker}-female-join` } });
    expect(joined.status, JSON.stringify(joined.body)).toBeLessThan(300);
    await context.close();
  });
});
