import { expect, test, type Page } from '@playwright/test';
import { createFixtures } from './support/fixtures.js';

// DEC-021 Match Ticketing in a real browser against the real API and database: tap an open position -> the confirm
// sheet (match, venue, kick-off, place, R80, the cancellation policy and the required tick) -> pay (the test API's
// demo operator confirms straight away; Paystack checkout is covered by smoke:tickets) -> Tickets & credits ->
// leave more than 24 hours before kick-off for 1 match credit -> pay for a place with the credit. Plus the confirm
// and leave sheets on a 390px phone.
// The credit ledger is append-only, so this spec's players, matches, tickets and credits stay (marked) in the
// disposable database; only jobs and notifications are cleaned up.
const f = createFixtures('e2e-tickets');

async function quickMatch(page: Page, fieldId: string, startsAt: Date, name: string) {
  const created = await f.api<{ id: string }>(page, '/matches', {
    method: 'POST',
    body: {
      name: `${f.marker} ${name}`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: true, rules: [],
      visibility: 'PUBLIC', startsAt: startsAt.toISOString(), managedFieldId: fieldId,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.data!.id;
}

/** 12:00 Johannesburg, `days` days from now: on the 30-minute grid and well over 24 hours away. */
const kickoffIn = (days: number) => {
  const day = new Date(Date.now() + days * 86_400_000);
  day.setUTCHours(10, 0, 0, 0);
  return day;
};

const openPosition = (page: Page) => page.getByRole('button', { name: /position \d+, open, buy a ticket for it/ }).first();

test.describe('match tickets (DEC-021)', () => {
  test.afterAll(async () => {
    const users = await f.prisma.user.findMany({ where: { email: { startsWith: f.marker } }, select: { id: true } });
    const matches = await f.prisma.match.findMany({ where: { name: { startsWith: f.marker } }, select: { id: true } });
    if (matches.length) await f.prisma.durableJob.deleteMany({ where: { OR: matches.map(({ id }) => ({ dedupeKey: { contains: id } })) } });
    await f.prisma.notification.deleteMany({ where: { userId: { in: users.map(({ id }) => id) } } });
    await f.prisma.$disconnect();
  });

  test('buy a ticket with the policy tick, see it in Tickets & credits, leave for a credit and pay with it', async ({ browser }) => {
    const hostPage = await (await browser.newContext()).newPage();
    const page = await (await browser.newContext()).newPage();
    await Promise.all([hostPage.goto('/'), page.goto('/')]);
    const host = await f.register(hostPage, 'host', 'Host');
    const player = await f.register(page, 'player', 'Ticket');
    const venue = await f.createPublishedVenue(host.id, player.id);
    const matchId = await quickMatch(hostPage, venue.fieldId, kickoffIn(3), 'ticket match');

    // 1. The confirm sheet: nothing can be paid before the policy is ticked.
    await page.goto(`/matches/${matchId}`);
    await openPosition(page).click();
    const sheet = page.getByTestId('ticket-confirm-sheet');
    await expect(sheet).toContainText(`${f.marker} ticket match`);
    await expect(sheet).toContainText('R80');
    await expect(sheet.getByTestId('ticket-policy')).toContainText('Leave more than 24 hours before kick-off');
    const pay = sheet.getByRole('button', { name: 'Pay R80 · Card / Instant EFT' });
    await expect(pay).toBeDisabled();
    await sheet.getByLabel('I understand the cancellation policy').check();
    await pay.click();
    await expect(page.getByText('Your match ticket is confirmed.')).toBeVisible();
    const checkout = await f.prisma.ticketCheckout.findFirstOrThrow({ where: { matchId, payerId: player.id }, include: { providerPayment: true } });
    expect(checkout.policyText).toContain('24 hours');
    expect(checkout.providerPayment?.purpose).toBe('TICKETS');

    // 2. Tickets & credits, from the account menu.
    await page.locator('header button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Tickets & credits' }).click();
    await expect(page).toHaveURL('/tickets');
    await expect(page.getByTestId('match-credits')).toContainText('No match credits');
    await expect(page.getByTestId('ticket-row').filter({ hasText: 'ticket match' })).toContainText('Paid R80');
    await expect(page.getByText(/\b(wallet|balance|top.?up)\b/i)).toHaveCount(0);

    // 3. Leaving more than 24 hours before kick-off: 1 match credit (recommended) or a refund.
    await page.goto(`/matches/${matchId}`);
    await page.getByRole('button', { name: 'Leave match' }).click();
    const leave = page.getByTestId('ticket-leave-sheet');
    await expect(leave.getByRole('button', { name: 'Refund R80 to my card / bank' })).toBeVisible();
    await leave.getByRole('button', { name: /Get 1 match credit/ }).click();
    await expect(page.getByText('You left the match').first()).toBeVisible();
    await page.goto('/tickets');
    await expect(page.getByTestId('match-credits')).toContainText('You have 1 match credit');
    await expect(page.getByTestId('match-credits')).toContainText('Valid until');

    // 4. The credit is the main button now; paying is the alternative.
    await page.goto(`/matches/${matchId}`);
    await openPosition(page).click();
    await expect(sheet.getByRole('button', { name: 'Pay R80 instead' })).toBeVisible();
    await sheet.getByLabel('I understand the cancellation policy').check();
    await sheet.getByRole('button', { name: 'Use 1 match credit' }).click();
    await expect(page.getByText('Your match ticket is confirmed.')).toBeVisible();
    await page.goto('/tickets');
    await expect(page.getByTestId('match-credits')).toContainText('No match credits');
    await expect(page.getByTestId('ticket-row').filter({ hasText: 'Paid with 1 match credit' })).toHaveCount(1);
    const credit = await f.prisma.matchCredit.findFirstOrThrow({ where: { userId: player.id } });
    expect(credit.status).toBe('USED');
  });

  test('the confirm and leave sheets fit a 390px phone (batch 5 mobile checks)', async ({ browser }) => {
    const hostPage = await (await browser.newContext()).newPage();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await Promise.all([hostPage.goto('/'), page.goto('/')]);
    const host = await f.register(hostPage, 'mhost', 'Phone host');
    const player = await f.register(page, 'mplayer', 'Phone');
    const venue = await f.createPublishedVenue(host.id, player.id).catch(() => null);
    const fieldId = venue?.fieldId ?? (await f.prisma.managedField.findFirstOrThrow({ where: { venue: { slug: `${f.marker}-venue` } } })).id;
    const matchId = await quickMatch(hostPage, fieldId, kickoffIn(4), 'phone match');

    await page.goto(`/matches/${matchId}`);
    await openPosition(page).click();
    const sheet = page.getByTestId('ticket-confirm-sheet');
    await expect(sheet).toBeVisible();
    const fits = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    const tick = sheet.getByLabel('I understand the cancellation policy');
    await tick.scrollIntoViewIfNeeded();
    await tick.check();
    const pay = sheet.getByRole('button', { name: 'Pay R80 · Card / Instant EFT' });
    await pay.scrollIntoViewIfNeeded();
    expect((await pay.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(390);
    await pay.click();
    await expect(page.getByText('Your match ticket is confirmed.')).toBeVisible();

    await page.getByRole('button', { name: 'Leave match' }).click();
    const leave = page.getByTestId('ticket-leave-sheet');
    await expect(leave).toBeVisible();
    expect(await fits()).toBe(true);
    for (const button of [leave.getByRole('button', { name: /Get 1 match credit/ }), leave.getByRole('button', { name: 'Refund R80 to my card / bank' }), leave.getByRole('button', { name: 'Stay in match' })]) {
      await button.scrollIntoViewIfNeeded();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await leave.getByRole('button', { name: 'Stay in match' }).click();
    await expect(leave).toHaveCount(0);
  });
});
