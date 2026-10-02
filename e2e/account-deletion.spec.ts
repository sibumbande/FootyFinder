import { expect, test } from '@playwright/test';
import { createFixtures } from './support/fixtures.js';

// CEO batch 5 in a real browser against the real API and database: a player opens Account settings, reads the
// "Delete my account" summary, confirms with their password and DELETE, is signed out, then signs in again within
// the 14 days, which cancels the deletion. They also download their data. The player is not deleted at clean-up:
// the append-only audit log names them (like the admin fixtures).
const fixtures = createFixtures('e2e-del');
const { prisma, marker, PASSWORD, api, register, cleanFixtures } = fixtures;

test.describe('account deletion and data download (CEO batch 5)', () => {
  test.afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  test('a player deletes their account, signs in within 14 days to cancel it, and downloads their data', async ({ page }) => {
    await page.goto('/');
    const email = `deleter-${marker}@test.invalid`;
    const player = await register(page, 'del', 'Deleter', email);
    await prisma.user.update({ where: { id: player.id }, data: { isTestAccount: false, testDataBatchId: null } });

    await page.goto(`/players/${player.id}`);
    await page.getByRole('link', { name: 'Delete my account' }).click();
    await expect(page.getByRole('heading', { name: 'Delete my account' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The next 14 days' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What we keep, and why' })).toBeVisible();
    const confirm = page.getByRole('button', { name: 'Delete my account' });
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Your password').fill(PASSWORD);
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Your account is being deleted' })).toBeVisible();
    expect((await api(page, '/users/me')).status).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: player.id } })).accountStatus).toBe('PENDING_DELETION');

    await page.goto('/login');
    await page.getByLabel('Email or username').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/account/welcome-back');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: player.id } })).accountStatus).toBe('ACTIVE');

    await page.goto('/account/data');
    await page.getByLabel('Your password').fill(PASSWORD);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download my data' }).click();
    expect((await download).suggestedFilename()).toMatch(/^footyfinder-my-data-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(page.getByRole('heading', { name: 'Messages you sent' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });
});
