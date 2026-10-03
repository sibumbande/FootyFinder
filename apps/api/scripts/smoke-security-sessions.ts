import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import { SocketEvents } from '@footy-finder/shared';
import { app } from '../src/app.js';
import { allowedOrigins } from '../src/config/cors.js';
import { prisma } from '../src/database/prisma.js';
import { domainEvents } from '../src/events/domain-events.js';
import { SessionsService } from '../src/modules/auth/sessions.service.js';
import {
  createMatchInviteToken,
  hashMatchInviteToken,
} from '../src/modules/matches/invite-token.js';
import { MatchesService } from '../src/modules/matches/matches.service.js';
import { createSocketServer } from '../src/socket/create-socket-server.js';

const marker = `slice-1-security-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const waitFor = async (condition: () => boolean, message: string) => {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const connect = (url: string, token: string) =>
  new Promise<ClientSocket>((resolve, reject) => {
    const socket = createClient(url, {
      auth: { token },
      extraHeaders: { Origin: allowedOrigins[0]! },
      forceNew: true,
      reconnection: false,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

let userId: string | undefined;
let matchId: string | undefined;
let venueId: string | undefined;
let httpServer: ReturnType<typeof createServer> | undefined;
let io: ReturnType<typeof createSocketServer> | undefined;
const clients: ClientSocket[] = [];

try {
  const user = await prisma.user.create({
    data: {
      email: `${marker}@smoke.invalid`,
      username: marker.slice(0, 28),
      passwordHash: 'smoke-test-only',
      // Since Gate 2 the socket accepts only verified, onboarded accounts; this smoke tests
      // session revocation, so its player is an ordinary onboarded one.
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
    },
  });
  userId = user.id;
  const venue = await prisma.venue.create({
    data: {
      name: marker,
      addressLine1: '1 Security Lane',
      city: 'Johannesburg',
      region: 'Gauteng',
      countryCode: 'ZA',
    },
  });
  venueId = venue.id;

  const initialToken = createMatchInviteToken();
  const match = await prisma.match.create({
    data: {
      name: marker,
      createdById: user.id,
      venueId: venue.id,
      format: 'FIVE_A_SIDE',
      visibility: 'PRIVATE',
      inviteTokenHash: hashMatchInviteToken(initialToken),
      startsAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 60,
      feeCents: 0,
    },
  });
  matchId = match.id;

  const matchService = new MatchesService();
  assert(
    (await matchService.getByInvite(initialToken)).id === match.id,
    'Hashed invite lookup failed.',
  );
  const rotated = await matchService.rotateInvite(match.id, user.id);
  assert(rotated.inviteToken, 'Invite rotation did not return the one-time plaintext token.');
  let oldInviteRejected = false;
  try {
    await matchService.getByInvite(initialToken);
  } catch {
    oldInviteRejected = true;
  }
  assert(oldInviteRejected, 'Rotating an invite did not invalidate the previous token.');
  assert(
    (await matchService.getByInvite(rotated.inviteToken)).id === match.id,
    'Rotated hashed invite lookup failed.',
  );
  const storedMatch = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
  assert(storedMatch.inviteToken === null, 'A plaintext invitation token was persisted.');
  assert(storedMatch.inviteTokenHash?.length === 64, 'Invitation digest was not persisted.');

  const sessions = new SessionsService();
  const first = await sessions.issue(user.id, { ip: '127.0.0.1', userAgent: 'smoke-one' });
  const second = await sessions.issue(user.id, { ip: '127.0.0.1', userAgent: 'smoke-two' });
  assert((await sessions.verify(first.token)).sessionId === first.sessionId, 'Session one failed.');
  assert(
    (await sessions.verify(second.token)).sessionId === second.sessionId,
    'Session two failed.',
  );
  await sessions.revokeToken(first.token);
  let revokedRejected = false;
  try {
    await sessions.verify(first.token);
  } catch {
    revokedRejected = true;
  }
  assert(revokedRejected, 'Revoked session remained valid.');
  assert(
    (await sessions.verify(second.token)).sessionId === second.sessionId,
    'Revoking one session incorrectly revoked another.',
  );
  const httpSession = await sessions.issue(user.id, { userAgent: 'smoke-http' });
  const sessionCookie = `footy_finder_session=${httpSession.token}`;
  assert(
    (await request(app).get('/users/me').set('Cookie', sessionCookie)).status === 200,
    'Persisted cookie session was not accepted by HTTP authentication.',
  );
  assert(
    (
      await request(app)
        .post('/auth/logout')
        .set('Origin', 'https://malicious.example')
        .set('Cookie', sessionCookie)
    ).body.code === 'ORIGIN_NOT_ALLOWED',
    'Untrusted cookie mutation origin was not rejected.',
  );
  assert(
    (
      await request(app)
        .post('/auth/logout')
        .set('Origin', allowedOrigins[0]!)
        .set('Cookie', sessionCookie)
    ).status === 200,
    'Trusted logout request failed.',
  );
  assert(
    (await request(app).get('/users/me').set('Cookie', sessionCookie)).status === 401,
    'Logged-out HTTP session remained usable.',
  );

  httpServer = createServer(app);
  io = createSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  assert(address && typeof address !== 'string', 'Socket smoke server did not bind.');
  const url = `http://127.0.0.1:${address.port}`;
  const socket = await connect(url, second.token);
  clients.push(socket);
  socket.emit(SocketEvents.joinRoom, { matchId: match.id });
  await waitFor(
    () => [...io!.sockets.sockets.values()].some((item) => item.rooms.has(`match:${match.id}`)),
    'Authorized socket did not join the Match room.',
  );
  domainEvents.emit('participant:left', { matchId: match.id, userId: user.id });
  await waitFor(
    () => [...io!.sockets.sockets.values()].every((item) => !item.rooms.has(`match:${match.id}`)),
    'Revoked participant socket remained in the Match room.',
  );
  await sessions.revokeToken(second.token);
  domainEvents.emit('auth:session-revoked', { sessionId: second.sessionId });
  await waitFor(() => !socket.connected, 'Revoked session socket was not disconnected.');

  const denied = createClient(url, {
    auth: { token: second.token },
    extraHeaders: { Origin: allowedOrigins[0]! },
    forceNew: true,
    reconnection: false,
  });
  clients.push(denied);
  const deniedMessage = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Revoked socket was not rejected.')), 2_000);
    denied.once('connect_error', (error) => {
      clearTimeout(timeout);
      resolve(error.message);
    });
  });
  assert(deniedMessage === 'Authentication required.', 'Socket leaked a raw authentication error.');

  await prisma.user.update({ where: { id: user.id }, data: { accountStatus: 'BANNED' } });
  const bannedSession = await sessions.issue(user.id, {});
  assert(
    (await sessions.verify(bannedSession.token)).accountStatus === 'BANNED',
    'Session verification did not surface the current account restriction.',
  );
  // /users/me stays readable for a restricted account (its own status); protected routes such
  // as /tickets/mine must refuse it.
  const restricted = await request(app)
    .get('/tickets/mine')
    .set('Cookie', `footy_finder_session=${bannedSession.token}`);
  assert(
    restricted.status === 403 && restricted.body.code === 'ACCOUNT_RESTRICTED',
    'Restricted account was not denied by HTTP authorization.',
  );

  console.log('Slice 1 sessions, invitations, and realtime security smoke test passed.');
} finally {
  for (const client of clients) client.disconnect();
  if (io) await io.close();
  if (httpServer?.listening)
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  if (matchId) await prisma.match.deleteMany({ where: { id: matchId } });
  if (venueId) await prisma.venue.deleteMany({ where: { id: venueId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  const leftovers = await prisma.user.count({ where: { email: `${marker}@smoke.invalid` } });
  assert(leftovers === 0, 'Slice 1 smoke cleanup left test users behind.');
  await prisma.$disconnect();
}
