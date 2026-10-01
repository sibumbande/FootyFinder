import { expect, test, type Page } from '@playwright/test';
import { createFixtures } from './support/fixtures.js';

// CEO touch-up batch 1, item 4: every main page at common phone widths (360, 390, 414 px) must fit
// the screen: nothing cut off at either edge, and the notifications panel fully on screen.
const f = createFixtures('e2e-mobile');
const WIDTHS = [360, 390, 414] as const;

/**
 * Visible elements that stick out past either edge of the screen. The app hides sideways overflow on
 * html/body, so a too-wide element is silently cut off rather than scrollable; this finds it.
 * Content clipped or scrolled by its own container (a tab strip, the pitch, truncated text) is fine.
 */
async function offscreen(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clippedInside = (element: HTMLElement) => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement)
        if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) return true;
      return false;
    };
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (rect.width <= 1 || rect.height <= 1 || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (rect.right <= width + 1 && rect.left >= -1) return false;
        return !clippedInside(element);
      })
      .slice(0, 6)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return `<${element.tagName.toLowerCase()} class="${String(element.className).slice(0, 90)}"> ${Math.round(rect.left)}..${Math.round(rect.right)} "${(element.textContent ?? '').trim().slice(0, 40)}"`;
      });
  });
}

async function expectFits(page: Page, path: string, label = path) {
  await page.goto(path);
  await page.locator('main').waitFor();
  await page.waitForLoadState('networkidle');
  expect.soft(await offscreen(page), `${label} is cut off at the screen edge`).toEqual([]);
}

// CEO touch-up batch 3, item 7: on every auth screen the logo and the theme toggle share one header row, and there
// is no decorative ring over the heading.
test.describe('auth screen header (CEO batch 3, item 7)', () => {
  for (const path of ['/login', '/register', '/forgot-password', '/reset-password?token=x', '/verify-email', '/waiting-list']) {
    test(`logo and theme toggle on one row at 390px: ${path}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const header = page.getByTestId('auth-header');
      const logo = (await header.getByRole('link', { name: 'FootyFinder home' }).boundingBox())!;
      const toggle = (await header.getByRole('button', { name: /Switch to (dark|light) mode/ }).boundingBox())!;
      expect(Math.abs(logo.y + logo.height / 2 - (toggle.y + toggle.height / 2))).toBeLessThanOrEqual(4);
      expect(logo.x).toBeLessThan(toggle.x);
      expect(toggle.x + toggle.width).toBeLessThanOrEqual(390);
      expect(await page.locator('.rounded-full.border-\\[2\\.5rem\\]').count()).toBe(0);
      expect(await offscreen(page)).toEqual([]);
      await context.close();
    });
  }
});

test.describe('phone widths (CEO batch 1, item 4)', () => {
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
    const player = await f.register(page, 'player', 'Lungelo Extraordinarily-Longsurname');
    userId = player.id;
    const venue = await f.createPublishedVenue(player.id, approver.id);
    venueSlug = venue.slug;
    teamId = await f.createTeam(page, 'Woodstock Wanderers With A Long Name');
    const startsAt = new Date(Date.now() + 3 * 86_400_000);
    startsAt.setUTCHours(16, 0, 0, 0);
    const created = await f.api<{ id: string }>(page, '/matches', {
      method: 'POST',
      body: { name: `${f.marker} phone match`, format: 'FIVE_A_SIDE', visibility: 'PUBLIC', startsAt: startsAt.toISOString(), managedFieldId: venue.fieldId },
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

  for (const width of WIDTHS) {
    test(`guest pages fit at ${width}px`, async ({ browser }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      for (const path of ['/', '/matches', `/m/${publicSlug}`, `/venues/${venueSlug}`, '/social?tab=teams', `/teams/${teamId}`, `/players/${userId}`, '/legal/terms', '/login', '/register'])
        await expectFits(page, path);
      await context.close();
    });

    test(`signed-in pages and the notifications panel fit at ${width}px`, async ({ browser }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      await page.goto('/');
      const login = await f.api(page, '/auth/login', { method: 'POST', body: { identifier: `${f.marker}-player@test.invalid`, password: f.PASSWORD } });
      expect(login.status, JSON.stringify(login.body)).toBe(200);
      for (const path of ['/', '/matches', '/social', '/social?tab=friends', '/social?tab=teams', '/social?tab=dms', '/wallet', '/teams', `/teams/${teamId}`, `/matches/${matchId}`, '/matches/new', `/players/${userId}`, '/support'])
        await expectFits(page, path);

      // The notifications panel opens fully on screen, under the header.
      await page.goto('/');
      await page.getByRole('button', { name: /^Notifications/ }).click();
      const panel = page.getByTestId('notifications-panel');
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await offscreen(page)).toEqual([]);
      await page.keyboard.press('Escape');

      // The account menu fits too.
      await page.goto('/');
      await page.locator('header button[aria-haspopup="menu"]').click();
      const menu = page.getByRole('menu');
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);

      // The formation shows one pitch at a time, with Home/Away tabs, and fits.
      await page.goto(`/matches/${matchId}#formation`);
      await expect(page.getByRole('tab', { name: /Home/ })).toBeVisible();
      await expect(page.getByTestId('pitch-home')).toBeVisible();
      await expect(page.getByTestId('pitch-away')).toBeHidden();
      await page.getByRole('tab', { name: /Away/ }).click();
      await expect(page.getByTestId('pitch-away')).toBeVisible();
      expect(await offscreen(page)).toEqual([]);
      await context.close();
    });
  }
});
