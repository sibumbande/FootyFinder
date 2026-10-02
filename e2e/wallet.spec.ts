import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../apps/api/src/database/test-database-safety.js';

// Gate 6 / TKT-602-603-609: account menu -> wallet page -> R50-R5,000 top-up with quick picks ->
// history row, in a real browser against the real API and database. The development/test demo
// operator credits instantly; card top-ups through Paystack are covered by smoke:payments.
assertDisposableTestDatabase({ databaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV });

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const marker = `e2e-wallet-${Date.now().toString(36)}`;
const PASSWORD = 'FootyFinder123!';
let testBatchId: string | undefined;

async function api(page: Page, path: string, options: { method?: string; body?: unknown } = {}) {
  return page.evaluate(
    async ({ path, options }) => {
      const response = await fetch(`http://localhost:3000${path}`, {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, options },
  );
}

/** Registers an onboarded test player (the session cookie is set by registration). */
async function registerPlayer(page: Page) {
  const response = await api(page, '/auth/register', {
    method: 'POST',
    body: {
      email: `${marker}@test.invalid`,
      username: marker.replaceAll('-', '').slice(0, 30),
      firstName: 'Wallet',
      lastName: 'Tester',
      password: PASSWORD,
    },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const userId = response.body.data.id as string;
  const city = await prisma.city.findUniqueOrThrow({ where: { code: 'CAPE_TOWN' } });
  testBatchId = (await prisma.testDataBatch.create({ data: { label: marker } })).id;
  await prisma.$transaction(async (tx) => {
    const profile = await tx.playerProfile.update({
      where: { userId },
      data: {
        gender: 'MALE', dateOfBirth: new Date('1995-01-01T00:00:00Z'),
        yearsExperience: 5,
        cityId: city.id,
        onboardingStatus: 'COMPLETE',
        preferredPositions: { deleteMany: {}, create: [{ position: 'MIDFIELDER', sortOrder: 0 }] },
      },
    });
    await tx.playerPhoto.create({
      data: { profileId: profile.id, fileKey: `${userId}.webp`, mimeType: 'image/webp', byteSize: 1, width: 512, height: 512 },
    });
    await tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), isTestAccount: true, testDataBatchId: testBatchId },
    });
  });
  return userId;
}

test.describe('wallet', () => {
  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: marker } } });
    if (testBatchId) await prisma.testDataBatch.deleteMany({ where: { id: testBatchId } });
    await prisma.$disconnect();
  });

  test('player opens the wallet from the account menu, tops up with a quick pick and sees it in history', async ({ page }) => {
    await page.goto('/');
    const userId = await registerPlayer(page);
    await page.goto('/');
    await page.getByRole('button', { name: new RegExp(marker.replaceAll('-', '').slice(0, 12)) }).click();
    await page.getByRole('menuitem', { name: 'Wallet' }).click();
    await expect(page).toHaveURL('/wallet');
    await expect(page.getByText('No wallet activity yet.')).toBeVisible();
    // CEO touch-up batch 4, item 3: R200 / R400 / R800 with match hints, R400 preselected.
    await expect(page.getByRole('button', { name: 'R400 5 matches' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'R200 2 matches + R40' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'R800 10 matches' })).toBeVisible();

    // Server-side and client-side validation: below R50 is refused.
    await page.getByRole('button', { name: 'Other' }).click();
    await page.getByLabel(/Amount in rands/).fill('49');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('The minimum top-up is R50.')).toBeVisible();

    await page.getByRole('button', { name: /^R200/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('top-up-confirm')).toContainText(/You.re adding R\s?200,00 to your wallet. Correct\?/);
    await page.getByRole('button', { name: /Yes, add R\s?200,00/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Wallet top-up' })).toContainText(/\+R\s?200,00/);
    await expect(page.getByLabel(/Wallet balance R\s?200,00/)).toBeVisible();

    const wallet = await prisma.walletAccount.findUniqueOrThrow({ where: { userId } });
    expect(wallet.balanceCents).toBe(20_000);
    const ledger = await prisma.walletTransaction.findMany({ where: { walletAccountId: wallet.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: 'DEPOSIT_CREDIT', amountCents: 20_000, status: 'SUCCEEDED' });

    // The server enforces the range too.
    const tooBig = await api(page, '/wallet/deposits/demo', { method: 'POST', body: { amountCents: 500_100 } });
    expect(tooBig.status).toBe(400);
  });
});
