import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { assertDisposableTestDatabase } from '../apps/api/src/database/test-database-safety.js';

assertDisposableTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const marker = `e2e-${Date.now().toString(36)}`;
const emails = [`${marker}-captain@test.invalid`, `${marker}-player@test.invalid`];

type ApiResult<T = Record<string, unknown>> = {
  status: number;
  body: { data?: T; error?: { code?: string; message?: string } };
};

async function api<T = Record<string, unknown>>(
  page: Page,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ path, options }) => {
      const response = await fetch(`http://localhost:3000${path}`, {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers: {
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, options },
  );
}

async function register(page: Page, suffix: 'captain' | 'player') {
  const response = await api<{ id: string }>(page, '/auth/register', {
    method: 'POST',
    body: {
      email: `${marker}-${suffix}@test.invalid`,
      username: `${marker.replaceAll('-', '')}_${suffix}`.slice(0, 30),
      firstName: suffix === 'captain' ? 'Casey' : 'Parker',
      lastName: 'Browser Test',
      password: 'FootyFinder123!',
    },
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data!;
}

async function cleanFixtures() {
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (!userIds.length) return;
  const matches = await prisma.match.findMany({
    where: { createdById: { in: userIds } },
    select: { id: true, venueId: true },
  });
  const conversations = await prisma.conversation.findMany({
    where: { participants: { some: { userId: { in: userIds } } } },
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.conversation.deleteMany({ where: { id: { in: conversations.map(({ id }) => id) } } });
    await tx.match.deleteMany({ where: { id: { in: matches.map(({ id }) => id) } } });
    await tx.team.deleteMany({ where: { ownerUserId: { in: userIds } } });
    await tx.venue.deleteMany({ where: { id: { in: matches.map(({ venueId }) => venueId) } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
  expect(await prisma.user.count({ where: { email: { in: emails } } })).toBe(0);
}

test.describe('browser critical path', () => {
  test.afterAll(async () => {
    await cleanFixtures();
    await prisma.$disconnect();
  });

  test('covers auth, paid joining, CORS PUT, Team selection, messaging, and notifications', async ({
    browser,
  }) => {
    const captainContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const captainPage = await captainContext.newPage();
    const playerPage = await playerContext.newPage();
    const protectedDestination = '/matches?format=FIVE_A_SIDE#available';
    await Promise.all([captainPage.goto(protectedDestination), playerPage.goto('/')]);
    await expect(captainPage).toHaveURL(
      `/login?returnTo=${encodeURIComponent(protectedDestination)}`,
    );

    const ready = await api<{ status: string; database: string }>(captainPage, '/ready');
    expect(ready).toMatchObject({
      status: 200,
      body: { data: { status: 'ready', database: 'ready' } },
    });

    const captain = await register(captainPage, 'captain');
    const player = await register(playerPage, 'player');
    await captainPage.reload();
    await expect(captainPage).toHaveURL(protectedDestination);

    await captainPage.goto(`/login?returnTo=${encodeURIComponent('/\\attacker.invalid/steal')}`);
    await expect(captainPage).toHaveURL('/');

    for (const [index, page] of [captainPage, playerPage].entries()) {
      const deposit = await api(page, '/wallet/deposits/demo', {
        method: 'POST',
        headers: { 'Idempotency-Key': `${marker}-deposit-${index}` },
      });
      expect(deposit.status, JSON.stringify(deposit.body)).toBe(200);
    }

    const quick = await api<{ id: string }>(captainPage, '/matches', {
      method: 'POST',
      body: {
        name: `${marker} paid match`,
        format: 'FIVE_A_SIDE',
        substituteCapacityPerTeam: 0,
        rollingSubstitutes: false,
        rules: [],
        visibility: 'PUBLIC',
        venue: {
          name: `${marker} pitch`,
          addressLine1: '1 Browser Road',
          city: 'Cape Town',
          region: 'Western Cape',
          countryCode: 'ZA',
        },
        startsAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
        feeCents: 8000,
      },
    });
    expect(quick.status, JSON.stringify(quick.body)).toBe(201);
    const joined = await api(playerPage, `/matches/${quick.body.data!.id}/join`, {
      method: 'POST',
      headers: { 'Idempotency-Key': `${marker}-join` },
      body: { team: 'AWAY' },
    });
    expect(joined.status, JSON.stringify(joined.body)).toBe(201);

    const team = await api<{ id: string }>(captainPage, '/teams', {
      method: 'POST',
      body: {
        name: `${marker} FC`,
        primaryFormat: 'FIVE_A_SIDE',
        formationKey: 'BALANCED_1_1_2_1',
      },
    });
    expect(team.status, JSON.stringify(team.body)).toBe(201);
    const invite = await api<{ inviteUrl: string }>(
      captainPage,
      `/teams/${team.body.data!.id}/invites`,
      { method: 'POST' },
    );
    expect(invite.status, JSON.stringify(invite.body)).toBe(201);
    const inviteToken = invite.body.data!.inviteUrl.split('/').at(-1)!;
    const accepted = await api(playerPage, `/team-invites/${inviteToken}/accept`, {
      method: 'POST',
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

    const fixture = await api<{ id: string }>(captainPage, `/teams/${team.body.data!.id}/matches`, {
      method: 'POST',
      body: {
        name: `${marker} team fixture`,
        format: 'FIVE_A_SIDE',
        substituteCapacityPerTeam: 5,
        rollingSubstitutes: true,
        rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
        formationKey: 'BALANCED_1_1_2_1',
        venue: {
          name: `${marker} team pitch`,
          addressLine1: '2 Browser Road',
          city: 'Cape Town',
          region: 'Western Cape',
          countryCode: 'ZA',
        },
        startsAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
      },
    });
    expect(fixture.status, JSON.stringify(fixture.body)).toBe(201);
    const fixtureId = fixture.body.data!.id;
    expect(
      (
        await api(captainPage, `/matches/${fixtureId}/team-sides/HOME/availability/request`, {
          method: 'POST',
        })
      ).status,
    ).toBe(200);
    const availability = await api(
      playerPage,
      `/matches/${fixtureId}/team-sides/HOME/availability/me`,
      { method: 'PUT', body: { status: 'AVAILABLE' } },
    );
    expect(availability.status, JSON.stringify(availability.body)).toBe(200);

    const lineup = await api<{ slots: Array<{ id: string }> }>(
      captainPage,
      `/matches/${fixtureId}/team-sides/HOME/lineup`,
    );
    expect(lineup.status, JSON.stringify(lineup.body)).toBe(200);
    const slotId = lineup.body.data!.slots[0].id;
    expect(
      (
        await api(
          captainPage,
          `/matches/${fixtureId}/team-sides/HOME/lineup/slots/${slotId}/open`,
          { method: 'POST', body: {} },
        )
      ).status,
    ).toBe(200);
    const claim = await api(
      playerPage,
      `/matches/${fixtureId}/team-sides/HOME/lineup/slots/${slotId}/claim`,
      { method: 'POST' },
    );
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);

    const conversation = await api<{ id: string }>(captainPage, '/conversations', {
      method: 'POST',
      body: { userId: player.id },
    });
    expect(conversation.status, JSON.stringify(conversation.body)).toBe(201);
    const message = await api(
      captainPage,
      `/conversations/${conversation.body.data!.id}/messages`,
      { method: 'POST', body: { content: `${marker} hello` } },
    );
    expect(message.status, JSON.stringify(message.body)).toBe(201);
    const received = await api<{ messages: Array<{ content: string }> }>(
      playerPage,
      `/conversations/${conversation.body.data!.id}`,
    );
    expect(received.body.data!.messages.some(({ content }) => content === `${marker} hello`)).toBe(
      true,
    );
    const notifications = await api<Array<{ type: string }>>(playerPage, '/notifications');
    expect(notifications.body.data!.some(({ type }) => type === 'DIRECT_MESSAGE')).toBe(true);

    await captainContext.close();
    await playerContext.close();
  });
});
