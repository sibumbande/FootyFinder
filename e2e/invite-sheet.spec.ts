import { expect, test, type Page } from '@playwright/test';
import { createFixtures } from './support/fixtures.js';

// A private match invite (/matches/invite/:token) opens the ticket sheet over the invitation card. The sheet used to
// be trapped inside the page's own box (the page-enter motion left a transform on it), so a tall sheet was centred
// on the short page and its title, close button and match details sat above the top of the screen, out of reach.
// The whole sheet must be on screen and scrollable on a desktop and a phone. Also: the home hero's "Find a match".
const f = createFixtures('e2e-invite-sheet');

const kickoff = () => {
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  startsAt.setUTCHours(13, 0, 0, 0);
  return startsAt;
};

/** The sheet's top edge is on screen, and its title, close button and first details are visible. */
async function expectWholeSheet(page: Page, height: number) {
  const sheet = page.getByTestId('ticket-confirm-sheet');
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  expect(box.y, 'sheet top is on screen').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'sheet bottom is on screen').toBeLessThanOrEqual(height + 1);
  await expect(sheet.getByRole('heading', { name: 'Buy your match ticket' })).toBeInViewport();
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeInViewport();
  await expect(sheet.getByText('Kick-off', { exact: true })).toBeInViewport();
  // Its bottom (the pay button) is reachable by scrolling inside the sheet.
  const pay = sheet.getByRole('button', { name: /^Pay R80/ });
  await pay.scrollIntoViewIfNeeded();
  await expect(pay).toBeInViewport();
}

test.describe('private match invite sheet', () => {
  let inviteToken = '';

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/');
    const approver = await f.register(page, 'ap', 'Approver');
    await context.clearCookies();
    const host = await f.register(page, 'h', 'Invite host');
    const venue = await f.createPublishedVenue(host.id, approver.id); // dual control: a second person approves
    const created = await f.api<{ id: string }>(page, '/matches', {
      method: 'POST',
      body: {
        name: `${f.marker} private match`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: true, rules: [],
        visibility: 'PRIVATE', startsAt: kickoff().toISOString(), managedFieldId: venue.fieldId,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const invite = await f.api<{ inviteToken: string }>(page, `/matches/${created.body.data!.id}/invite`, { method: 'POST' });
    expect(invite.status, JSON.stringify(invite.body)).toBe(200);
    inviteToken = invite.body.data!.inviteToken;
    await context.close();
  });

  test.afterAll(async () => {
    await f.cleanFixtures();
    await f.prisma.$disconnect();
  });

  for (const viewport of [{ width: 1910, height: 900 }, { width: 390, height: 844 }]) {
    test(`the whole sheet is on screen at ${viewport.width}px`, async ({ browser }) => {
      const phone = viewport.width < 500;
      const context = await browser.newContext({ viewport, ...(phone && { isMobile: true, hasTouch: true }) });
      const page = await context.newPage();
      await page.goto('/');
      await f.register(page, `p${viewport.width}`, 'Invitee');
      await page.goto(`/matches/invite/${inviteToken}`);
      await expectWholeSheet(page, viewport.height);
      await context.close();
    });
  }

  test('the home hero "Find a match" opens match discovery', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Find a match' }).click();
    await expect(page).toHaveURL(/\/matches$/);
  });
});
