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

async function expectHeaderAligned(page: Page) {
  await page.goto('/');
  const header = page.locator('header').first();
  await expect(header.getByRole('link', { name: 'Top up wallet' })).toHaveCount(0);
  const controls = [
    header.getByRole('link', { name: 'FootyFinder home' }),
    header.getByRole('button', { name: /Switch to (dark|light) mode/ }),
    header.getByRole('link', { name: /^Wallet balance/ }),
    header.getByRole('button', { name: /^Notifications/ }),
    header.locator('button[aria-haspopup="menu"]'),
  ];
  const centres: number[] = [];
  for (const control of controls) {
    const box = (await control.boundingBox())!;
    expect.soft(box.height, 'header control height').toBeGreaterThanOrEqual(40);
    centres.push(box.y + box.height / 2);
  }
  expect(Math.max(...centres) - Math.min(...centres), 'header controls share one centre line').toBeLessThanOrEqual(3);
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

  test('the signed-in header lines up on desktop (CEO batch 3.5, item 2)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto('/');
    const login = await f.api(page, '/auth/login', { method: 'POST', body: { identifier: `${f.marker}-player@test.invalid`, password: f.PASSWORD } });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    await expectHeaderAligned(page);
    await context.close();
  });

  for (const width of WIDTHS) {
    test(`guest pages fit at ${width}px`, async ({ browser }) => {
      test.setTimeout(120_000);
      const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      for (const path of ['/', '/matches', `/m/${publicSlug}`, `/matches/${matchId}`, `/venues/${venueSlug}`, '/social?tab=teams', `/teams/${teamId}`, `/players/${userId}`, '/legal/terms', '/login', '/register', '/forgot-password', '/waiting-list'])
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
      // CEO touch-up batch 3, item 11: plus the pages the 390 px audit found broken (team create/invites/settings,
      // onboarding, bookings, disputes).
      for (const path of ['/', '/matches', '/social', '/social?tab=friends', '/social?tab=teams', '/social?tab=dms', '/wallet', '/teams', '/teams/create', `/teams/${teamId}`, `/teams/${teamId}?tab=invites`, `/teams/${teamId}?tab=settings`, `/matches/${matchId}`, '/matches/new', `/players/${userId}`, '/support', '/bookings', '/disputes', '/onboarding'])
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

      // CEO touch-up batch 3.5, item 2: no separate "+" top-up button; the header controls share one centre line.
      await expectHeaderAligned(page);

      // The account menu fits too.
      await page.goto('/');
      await page.locator('header button[aria-haspopup="menu"]').click();
      const menu = page.getByRole('menu');
      const menuBox = (await menu.boundingBox())!;
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);

      // CEO touch-up batch 3, items 8-10: the Social section drop-down replaces the pills on phones; the team tabs
      // are 44 px tall with an arrow to the hidden ones; the home venue carousel scrolls sideways inside the page.
      await page.goto('/social?tab=friends');
      await expect(page.getByTestId('social-section-select')).toBeVisible();
      await expect(page.getByRole('tablist', { name: 'Social' })).toBeHidden();
      await page.getByTestId('social-section-select').selectOption('teams');
      await expect(page).toHaveURL(/tab=teams/);
      await page.goto(`/teams/${teamId}`);
      const firstTab = (await page.getByRole('tab', { name: 'overview' }).boundingBox())!;
      expect(firstTab.height).toBeGreaterThanOrEqual(43.5); // 44 px (2.75rem), allowing sub-pixel layout
      await expect(page.getByRole('button', { name: 'Show more team sections' })).toBeVisible();
      await page.goto(`/teams/${teamId}?tab=settings`);
      const settingsTab = (await page.getByRole('tab', { name: 'settings' }).boundingBox())!;
      expect(settingsTab.x + settingsTab.width).toBeLessThanOrEqual(width);
      expect(await offscreen(page)).toEqual([]);
      // The carousel bleeds to the screen edges by design; measure once the page transition has settled.
      await expectFits(page, '/');
      await expect(page.getByTestId('venue-carousel')).toBeVisible();
      // CEO touch-up batch 3.5, item 1: upcoming matches use the Matches page cards, stacked one per row on phones.
      const cards = page.getByTestId('upcoming-matches').locator('article');
      await expect(cards.first()).toBeVisible();
      const boxes = await cards.evaluateAll((items) => items.map((item) => item.getBoundingClientRect()).map(({ left, width: w }) => ({ left, w })));
      expect(boxes.length).toBeLessThanOrEqual(5);
      for (const box of boxes) {
        expect(Math.abs(box.left - boxes[0]!.left)).toBeLessThanOrEqual(1);
        expect(box.w).toBeGreaterThan(width * 0.8);
      }

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
