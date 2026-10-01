import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createFixtures } from './support/fixtures.js';

// CEO touch-up batch 2, item 1: all text on the main pages meets WCAG AA contrast (4.5:1 normal text,
// 3:1 large text) in both the light and the dark theme. axe cannot judge text drawn over a photo
// (it reports those as "incomplete", not as a failure); those few hero panels use fixed light-on-navy
// colours instead, checked by hand.
const f = createFixtures('e2e-a11y');
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

async function themedPage(browser: Browser, theme: Theme) {
  const context = await browser.newContext({ colorScheme: theme, reducedMotion: 'reduce' });
  await context.addInitScript((value) => window.localStorage.setItem('footy-finder-theme', value), theme);
  return { context, page: await context.newPage() };
}

async function contrastViolations(page: Page, path: string) {
  await page.goto(path);
  await page.locator('main').first().waitFor();
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${path}: ${node.target.join(' ')}: ${node.any.map(({ message }) => message).join('; ')}`),
  );
}

async function expectReadable(page: Page, theme: Theme, paths: string[]) {
  for (const path of paths) {
    const violations = await contrastViolations(page, path);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark')), `${path} renders the ${theme} theme`).toBe(theme === 'dark');
    expect.soft(violations, `${path} (${theme})`).toEqual([]);
  }
}

test.describe('text contrast meets WCAG AA in light and dark (CEO batch 2, item 1)', () => {
  let matchId = '';
  let publicSlug = '';
  let teamId = '';
  let userId = '';
  let venueSlug = '';

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    const approver = await f.register(page, 'approver', 'Approver');
    await context.clearCookies();
    const player = await f.register(page, 'player', 'Thandi');
    userId = player.id;
    const venue = await f.createPublishedVenue(player.id, approver.id);
    venueSlug = venue.slug;
    teamId = await f.createTeam(page, 'Contrast Rovers');
    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    startsAt.setUTCHours(16, 0, 0, 0);
    const created = await f.api<{ id: string }>(page, '/matches', {
      method: 'POST',
      body: { name: `${f.marker} contrast match`, format: 'FIVE_A_SIDE', visibility: 'PUBLIC', startsAt: startsAt.toISOString(), managedFieldId: venue.fieldId },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    matchId = created.body.data!.id;
    publicSlug = (await f.prisma.match.findUniqueOrThrow({ where: { id: matchId }, select: { publicSlug: true } })).publicSlug!;
    await context.close();
  });

  test.afterAll(async () => {
    await f.cleanFixtures();
    await f.prisma.$disconnect();
  });

  for (const theme of THEMES) {
    test(`guest pages (${theme})`, async ({ browser }) => {
      test.setTimeout(180_000);
      const { context, page } = await themedPage(browser, theme);
      await expectReadable(page, theme, ['/', '/matches', `/m/${publicSlug}`, `/matches/${matchId}`, `/venues/${venueSlug}`, '/social?tab=teams', '/social?tab=leaderboards', `/teams/${teamId}`, `/players/${userId}`, '/legal/terms', '/login', '/register']);
      await context.close();
    });

    test(`member pages (${theme})`, async ({ browser }) => {
      test.setTimeout(180_000);
      const { context, page } = await themedPage(browser, theme);
      await page.goto('/');
      const login = await f.api(page, '/auth/login', { method: 'POST', body: { identifier: `${f.marker}-player@test.invalid`, password: f.PASSWORD } });
      expect(login.status, JSON.stringify(login.body)).toBe(200);
      await expectReadable(page, theme, ['/', '/matches', `/matches/${matchId}`, `/venues/${venueSlug}`, '/teams', `/teams/${teamId}`, `/teams/${teamId}?tab=invites`, `/players/${userId}`, '/social', '/social?tab=leaderboards', '/wallet', '/matches/new', '/support']);
      await context.close();
    });

    test(`onboarding (${theme})`, async ({ browser }) => {
      test.setTimeout(120_000);
      const { context, page } = await themedPage(browser, theme);
      await page.goto('/');
      const suffix = `fresh${theme}`;
      const registered = await f.api<{ id: string }>(page, '/auth/register', {
        method: 'POST',
        body: { email: `${f.marker}-${suffix}@test.invalid`, username: `${f.marker.replaceAll('-', '')}_${suffix}`.slice(0, 30), firstName: 'Fresh', lastName: 'Player', password: f.PASSWORD },
      });
      expect(registered.status, JSON.stringify(registered.body)).toBe(201);
      await f.prisma.user.update({ where: { id: registered.body.data!.id }, data: { emailVerifiedAt: new Date() } });
      await expectReadable(page, theme, ['/onboarding']);
      await context.close();
    });
  }
});
