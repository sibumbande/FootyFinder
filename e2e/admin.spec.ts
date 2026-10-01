import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createFixtures } from './support/fixtures.js';

// CEO touch-up batch 3.5, item 3: the admin app fits common desktop screens with Log out always on screen,
// nothing overflows (desktop and 360 px phones), and text meets WCAG AA contrast in light and dark.
const ADMIN = process.env.E2E_ADMIN_URL ?? 'http://localhost:5174';
const f = createFixtures('e2e-admin');
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

/** Every admin page checked for overflow and contrast. Collapsed panels are opened before measuring. */
const PAGES = ['/', '/waiting-list', '/matches', '/match-referees', '/results', '/venues', '/finance', '/settlement', '/support', '/moderation', '/disputes', '/referees', '/team-reviews', '/recruitment', '/test-data', '/audit'];

let adminEmail = '';
let adminId = '';

async function adminPage(browser: Browser, options: { theme?: Theme; width?: number; height?: number } = {}) {
  const { theme = 'dark', width = 1366, height = 768 } = options;
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce', ...(width < 500 && { hasTouch: true, isMobile: true }) });
  await context.addInitScript((value) => { if (!window.localStorage.getItem('ff-admin-theme')) window.localStorage.setItem('ff-admin-theme', value); }, theme);
  const page = await context.newPage();
  // Sign in through the API (the session cookie is shared by every localhost port), then verify the admin MFA.
  await page.goto(ADMIN);
  const login = await f.api(page, '/auth/login', { method: 'POST', body: { identifier: adminEmail, password: f.PASSWORD } });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  await f.verifyAdminSession(adminId);
  return { context, page };
}

async function open(page: Page, path: string) {
  await page.goto(`${ADMIN}${path}`);
  await page.locator('main.content').waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.querySelectorAll('details').forEach((item) => { item.open = true; }));
}

/** Elements wider than the screen, or poking out past its right edge, that nothing clips or scrolls. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clippedInside = (element: HTMLElement) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement)
        if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) return true;
      return false;
    };
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1 || getComputedStyle(element).visibility === 'hidden') return false;
        return (rect.right > width + 1 || rect.left < -1) && !clippedInside(element);
      })
      .slice(0, 5)
      .map((element) => `<${element.tagName.toLowerCase()} class="${String(element.className).slice(0, 60)}"> "${(element.textContent ?? '').trim().slice(0, 40)}"`);
    if (document.documentElement.scrollWidth > width + 1) offenders.unshift(`page scrolls sideways (${document.documentElement.scrollWidth} > ${width})`);
    return offenders;
  });
}

test.describe('admin app layout and contrast (CEO batch 3.5, item 3)', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    const approver = await f.register(page, 'approver', 'Approver');
    await context.clearCookies();
    const admin = await f.registerAdmin(page);
    adminEmail = admin.email;
    adminId = admin.id;
    // A published venue with a content change waiting for approval (the cream notice panel).
    const venue = await f.createPublishedVenue(approver.id, admin.id);
    const field = await f.prisma.managedField.findUniqueOrThrow({ where: { id: venue.fieldId }, select: { venueId: true } });
    await f.prisma.venueContentChange.create({
      data: {
        venueId: field.venueId,
        submittedByUserId: approver.id,
        payload: { photos: [1, 2, 3].map((n) => ({ url: `https://example.invalid/p${n}.webp`, altText: `Photo ${n}`, attribution: 'Test' })), coverIndex: 0, aboutText: 'A pending about text.', links: [] },
      },
    });
    await context.close();
  });

  test.afterAll(async () => {
    await f.cleanFixtures();
    await f.prisma.$disconnect();
  });

  for (const [width, height] of [[1366, 768], [1920, 1080]] as const) {
    test(`Log out is on screen and nothing overflows at ${width}x${height}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const { context, page } = await adminPage(browser, { width, height });
      for (const path of PAGES) {
        await open(page, path);
        const logout = page.getByRole('button', { name: 'Log out' });
        await expect(logout).toBeInViewport({ ratio: 1 });
        const heading = (await page.getByRole('heading', { name: 'Operations' }).boundingBox())!;
        const aside = (await page.locator('aside').boundingBox())!;
        expect(heading.x + heading.width, '"Operations" stays inside the sidebar').toBeLessThanOrEqual(aside.x + aside.width);
        expect.soft(await overflow(page), `${path} at ${width}px`).toEqual([]);
      }
      // The menu scrolls on its own when the window is short; Log out stays put.
      await page.setViewportSize({ width, height: 520 });
      await expect(page.getByRole('button', { name: 'Log out' })).toBeInViewport({ ratio: 1 });
      await context.close();
    });
  }

  test('fits a 360 px phone, with Log out in the Menu', async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await adminPage(browser, { width: 360, height: 780 });
    for (const path of PAGES) {
      await open(page, path);
      expect.soft(await overflow(page), `${path} at 360px`).toEqual([]);
    }
    await open(page, '/');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeHidden();
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
    await page.getByRole('link', { name: 'Finance' }).click();
    await expect(page).toHaveURL(/\/finance$/);
    await expect(page.getByRole('button', { name: 'Log out' })).toBeHidden();
    await context.close();
  });

  // CEO touch-up batch 3.5, item 4.
  test('waiting list: per-city counts, the list, and a CSV of subscribed people behind a fresh MFA check', async ({ browser }) => {
    const city = await f.prisma.city.findUniqueOrThrow({ where: { code: 'EAST_LONDON' } });
    const on = `${f.marker}-wl-on@test.invalid`;
    const off = `${f.marker}-wl-off@test.invalid`;
    await f.prisma.cityInterest.createMany({
      data: [on, off].map((email) => ({
        cityId: city.id, email, dedupeKey: `${email}-key`, manageTokenHash: `${email}-hash`, consentedAt: new Date(), source: 'WAITING_LIST_PAGE',
        ...(email === off && { unsubscribedAt: new Date() }),
      })),
    });
    try {
      const { context, page } = await adminPage(browser);
      await open(page, '/waiting-list');
      await expect(page.getByTestId('waiting-list-total')).toBeVisible();
      await page.getByRole('combobox', { name: 'City' }).selectOption({ label: 'East London (KuGompo)' });
      await expect(page.getByRole('row', { name: new RegExp(`${on}.*Yes`) })).toBeVisible();
      await expect(page.getByRole('row', { name: new RegExp(`${off}.*No`) })).toBeVisible();

      // An admin session verified 30 minutes ago must check the authenticator again before downloading.
      await f.verifyAdminSession(adminId, new Date(Date.now() - 30 * 60_000));
      await page.getByRole('button', { name: /Download CSV/ }).click();
      await expect(page.getByText('This action needs a fresh authenticator check.')).toBeVisible();
      await f.verifyAdminSession(adminId);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download CSV/ }).click()]);
      expect(download.suggestedFilename()).toMatch(/^waiting-list-east-london-\d{4}-\d{2}-\d{2}\.csv$/);
      const csv = readFileSync((await download.path())!, 'utf8');
      expect(csv).toContain('"Email","City","Signed up","Source"');
      expect(csv).toContain(on);
      expect(csv).not.toContain(off);
      const audit = await f.prisma.adminAuditLog.findFirstOrThrow({ where: { actorUserId: adminId, action: 'WAITING_LIST_EXPORTED' }, orderBy: { createdAt: 'desc' } });
      expect(audit.metadata).toMatchObject({ city: 'East London (KuGompo)' });
      expect(JSON.stringify(audit)).not.toContain(on);
      await context.close();
    } finally {
      await f.prisma.cityInterest.deleteMany({ where: { email: { startsWith: f.marker } } });
    }
  });

  for (const theme of THEMES) {
    test(`text meets WCAG AA contrast in the ${theme} theme`, async ({ browser }) => {
      test.setTimeout(240_000);
      const { context, page } = await adminPage(browser, { theme });
      for (const path of PAGES) {
        await open(page, path);
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
        const { violations, incomplete, passes } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
        const found = violations.flatMap((violation) => violation.nodes.map((node) => `${node.target.join(' ')}: ${node.any.map(({ message }) => message).join('; ')}`));
        expect.soft(found.slice(0, 10), `${path} (${theme})`).toEqual([]);
        // axe cannot measure text on a gradient and silently skips it, so text must sit on solid colours.
        const unmeasured = incomplete.flatMap((item) => item.nodes).filter((node) => node.any.some(({ message }) => /gradient/i.test(message)));
        expect.soft(unmeasured.map((node) => node.target.join(' ')).slice(0, 5), `${path} (${theme}) text on a gradient`).toEqual([]);
        expect(passes.length, `${path} (${theme}) contrast was actually measured`).toBeGreaterThan(0);
      }
      // The pending-change panel on the venues page was the worst offender; make sure it was on the page.
      await open(page, '/venues');
      await expect(page.getByText('Content change waiting for approval').first()).toBeVisible();
      // The theme toggle switches and remembers.
      await page.getByRole('button', { name: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` }).click();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme === 'dark' ? 'light' : 'dark');
      await page.reload();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme === 'dark' ? 'light' : 'dark');
      await context.close();
    });
  }
});
