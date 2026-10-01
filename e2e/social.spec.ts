import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../apps/api/src/database/test-database-safety.js';

// Gate 9 (TKT-901 to TKT-910) in a real browser against the real API and database: a guest browses
// the recruitment board and a profile without an account; players find each other in Discover and
// become friends; a captain invites a friend to the team in one tap; a team posts that it is
// recruiting and accepts a player's request to join; and a block hides the players from each other.
assertDisposableTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
});

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const marker = `e2e-soc-${Date.now().toString(36)}`;
const PASSWORD = 'FootyFinder123!';
let testBatchId: string | undefined;

async function api<T = Record<string, unknown>>(page: Page, path: string, options: { method?: string; body?: unknown } = {}) {
  return page.evaluate(
    async ({ path, options }) => {
      const response = await fetch(`http://localhost:3000${path}`, {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return { status: response.status, body: (await response.json()) as { data?: T } };
    },
    { path, options },
  );
}

/** Registers and onboards a player through the API, finishing the profile in the database (test fixture). */
async function register(page: Page, suffix: string, firstName: string) {
  const response = await api<{ id: string }>(page, '/auth/register', {
    method: 'POST',
    body: { email: `${marker}-${suffix}@test.invalid`, username: `${marker.replaceAll('-', '')}_${suffix}`.slice(0, 30), firstName, lastName: 'Social', password: PASSWORD },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const userId = response.body.data!.id;
  const city = await prisma.city.findUniqueOrThrow({ where: { code: 'CAPE_TOWN' } });
  testBatchId ??= (await prisma.testDataBatch.create({ data: { label: marker } })).id;
  await prisma.$transaction(async (tx) => {
    const profile = await tx.playerProfile.update({
      where: { userId },
      data: {
        dateOfBirth: new Date('1995-01-01T00:00:00Z'), yearsExperience: 4, cityId: city.id, onboardingStatus: 'COMPLETE', bio: `${firstName} plays on Saturdays`,
        preferredPositions: { deleteMany: {}, create: [{ position: 'DEFENDER', sortOrder: 0 }] },
      },
    });
    await tx.playerPhoto.create({ data: { profileId: profile.id, fileKey: `${userId}.webp`, mimeType: 'image/webp', byteSize: 1, width: 512, height: 512 } });
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), isTestAccount: true, testDataBatchId: testBatchId } });
  });
  return { id: userId, name: `${firstName} Social` };
}

async function cleanFixtures() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: marker } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  const teams = await prisma.team.findMany({ where: { name: { startsWith: marker } }, select: { id: true } });
  const teamIds = teams.map(({ id }) => id);
  await prisma.$transaction(async (tx) => {
    await tx.notification.deleteMany({ where: { userId: { in: userIds } } });
    await tx.teamWalletAccount.deleteMany({ where: { teamId: { in: teamIds } } });
    await tx.team.deleteMany({ where: { id: { in: teamIds } } });
    await tx.conversation.deleteMany({ where: { participants: { some: { userId: { in: userIds } } } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
    if (testBatchId) await tx.testDataBatch.delete({ where: { id: testBatchId } });
  });
  expect(await prisma.user.count({ where: { email: { startsWith: marker } } })).toBe(0);
}

test.describe('Social: friends, team invites, recruitment, blocking and guest browsing (Gate 9)', () => {
  test.afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  test('a guest browses; players befriend, invite, recruit and block', async ({ browser }) => {
    test.setTimeout(240_000);
    const contexts = await Promise.all([1, 2, 3, 4].map(() => browser.newContext()));
    const [guestPage, captainPage, friendPage, recruitPage] = await Promise.all(contexts.map((context) => context.newPage()));
    await Promise.all([captainPage, friendPage, recruitPage].map((page) => page.goto('/login')));
    const captain = await register(captainPage, 'captain', 'Captain');
    const friend = await register(friendPage, 'friend', 'Friendly');
    const recruit = await register(recruitPage, 'recruit', 'Recruit');

    // Discover: the captain finds the friend by name and sends a request; the friend accepts.
    await captainPage.goto('/social');
    await expect(captainPage.getByRole('heading', { name: /social network/i })).toBeVisible();
    await captainPage.getByTestId('social-search').fill('Friendly');
    const card = captainPage.getByTestId('social-player-card').filter({ hasText: friend.name });
    await card.getByRole('button', { name: /add friend/i }).click();
    await expect(card.getByRole('button', { name: 'Requested' })).toBeVisible();
    await friendPage.goto('/social?tab=friends');
    await friendPage.getByTestId('social-player-card').filter({ hasText: captain.name }).getByRole('button', { name: 'Accept' }).click();
    await expect(friendPage.getByTestId('friend-state').first()).toBeVisible();

    // The captain's team: invite the friend in one tap; the friend joins from the Friends tab.
    const team = await api<{ id: string }>(captainPage, '/teams', { method: 'POST', body: { name: `${marker} Rovers`, primaryFormat: 'FIVE_A_SIDE', formationKey: 'BALANCED_1_1_2_1' } });
    const teamId = team.body.data!.id;
    await captainPage.goto('/'); // refresh the signed-in user so the team shows up as captained
    await captainPage.goto(`/teams/${teamId}?tab=invites`);
    await captainPage.getByTestId('invite-friends').getByRole('button', { name: 'Invite' }).click();
    await expect(captainPage.getByTestId('invite-friends').getByText(/Invited/)).toBeVisible();
    await friendPage.goto('/social?tab=friends');
    await friendPage.getByTestId('team-invites').getByRole('button', { name: 'Join team' }).click();
    await expect(friendPage.getByTestId('team-invites')).toHaveCount(0);
    expect(await prisma.teamMembership.count({ where: { teamId, userId: friend.id } })).toBe(1);

    // Recruitment: the captain posts; the recruit asks to join; the captain accepts.
    await captainPage.goto(`/teams/${teamId}?tab=invites`);
    await captainPage.getByTestId('team-recruitment').getByRole('button', { name: 'New post' }).click();
    const form = captainPage.getByTestId('recruitment-form');
    await form.getByRole('button', { name: 'Goalkeeper' }).click();
    await form.getByPlaceholder('e.g. Woodstock, Cape Town').fill('Woodstock');
    await form.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(captainPage.getByTestId('team-recruitment').getByTestId('recruitment-post')).toHaveCount(1);
    await recruitPage.goto('/social?tab=teams');
    const post = recruitPage.getByTestId('recruitment-post').filter({ hasText: `${marker} Rovers` });
    await post.getByRole('button', { name: 'Ask to join' }).click();
    await expect(post.getByRole('button', { name: /Requested/ })).toBeVisible();
    await captainPage.reload();
    await captainPage.getByTestId('join-requests').getByRole('button', { name: 'Accept' }).click();
    await expect(captainPage.getByTestId('join-requests')).toHaveCount(0);
    expect(await prisma.teamMembership.count({ where: { teamId, userId: recruit.id } })).toBe(1);

    // A guest browses the board and a profile without an account; actions prompt to sign up.
    await guestPage.goto('/social?tab=teams');
    await expect(guestPage.getByTestId('recruitment-post').filter({ hasText: `${marker} Rovers` })).toBeVisible();
    await guestPage.goto('/social');
    await expect(guestPage.getByTestId('sign-up-prompt')).toBeVisible();
    await guestPage.goto(`/players/${friend.id}`);
    await expect(guestPage.getByTestId('guest-player')).toContainText('Friendly plays on Saturdays');
    await expect(guestPage.getByRole('main').getByRole('link', { name: 'Sign up to play' })).toHaveAttribute('href', `/register?returnTo=%2Fplayers%2F${friend.id}`);
    await expect(guestPage.getByTestId('guest-player')).not.toContainText('@test.invalid');
    await guestPage.goto(`/teams/${teamId}`);
    await expect(guestPage.getByTestId('guest-team')).toContainText(friend.name);

    // Blocking: the recruit blocks the captain; they disappear from each other's search.
    recruitPage.on('dialog', (dialog) => void dialog.accept());
    await recruitPage.goto(`/players/${captain.id}`);
    await recruitPage.getByRole('button', { name: 'Block' }).click();
    await expect(recruitPage.getByRole('button', { name: 'Unblock' })).toBeVisible();
    await captainPage.goto('/social');
    await captainPage.getByTestId('social-search').fill('Recruit');
    await expect(captainPage.getByText('No new profiles found.')).toBeVisible();
    expect((await api(captainPage, '/social/friend-requests', { method: 'POST', body: { userId: recruit.id } })).status).toBe(403);

    await Promise.all(contexts.map((context) => context.close()));
  });
});
