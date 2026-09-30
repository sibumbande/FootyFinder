import argon2 from 'argon2';
import sharp from 'sharp';
import { getDefaultFormationKey, type CreateMatchInput, type LegalAcceptanceInput, type MatchFormat, type TeamSide } from '@footy-finder/shared';
import { prisma } from '../../src/database/prisma.js';
import { serializableTransaction } from '../../src/database/transaction.js';
import { appendAdminAudit } from '../../src/modules/admin/admin-audit.js';
import { MatchLineupService } from '../../src/modules/match-lineup/match-lineup.service.js';
import { AdminMatchCancelService } from '../../src/modules/matches/admin-match-cancel.service.js';
import { MatchesService } from '../../src/modules/matches/matches.service.js';
import { OnboardingService } from '../../src/modules/onboarding/onboarding.service.js';
import { PlayerPhotoService } from '../../src/modules/profiles/player-photo.service.js';
import { findRefereeClash } from '../../src/modules/referees/referee-assignment.js';
import { RefereeAssignmentService } from '../../src/modules/referees/referee-assignment.service.js';
import { RefereeRoleService } from '../../src/modules/referees/referee-role.service.js';
import { TeamMatchMetersService } from '../../src/modules/team-matches/team-match-meters.js';
import { TeamMatchesService } from '../../src/modules/team-matches/team-matches.service.js';
import { TeamWalletService } from '../../src/modules/team-wallet/team-wallet.service.js';
import { TeamsService } from '../../src/modules/teams/teams.service.js';
import { DemoPaymentOperator } from '../../src/modules/wallet/demo-payment.operator.js';
import { DepositsService } from '../../src/modules/wallet/deposits.service.js';
import { FriendsService } from '../../src/modules/social/friends.service.js';
import { RecruitmentService } from '../../src/modules/social/recruitment.service.js';
import { ShiftRefusedError, devSeedMatchLink, shiftDevSeedMatch } from './shift.js';
import {
  DEV_SEED,
  DEV_SEED_BATCH_LABEL,
  DEV_SEED_MATCH_PREFIX,
  DEV_SEED_PASSWORD,
  DEV_SEED_RESET_AUDIT,
  DEV_SEED_TEAM_CONTRIBUTION_CENTS,
  DEV_SEED_WALLET_CENTS,
  GOALKEEPERS,
  TEAMS,
  mockPlayer,
  range,
} from './world.js';

const REQUEST_ID = 'dev-seed-mock';
const MINUTE = 60_000;
const TZ_OFFSET_MINUTES = 120; // Africa/Johannesburg, UTC+2 all year.

const onboarding = new OnboardingService();
const photos = new PlayerPhotoService();
const deposits = new DepositsService(new DemoPaymentOperator());
const teamsService = new TeamsService();
const teamWallet = new TeamWalletService();
const matches = new MatchesService();
const teamMatches = new TeamMatchesService();
const meters = new TeamMatchMetersService();
const lineups = new MatchLineupService();
const refereeRoles = new RefereeRoleService();
const refereeAssignments = new RefereeAssignmentService();
const adminCancel = new AdminMatchCancelService();
const friendsService = new FriendsService();
const recruitmentService = new RecruitmentService();

type Players = Map<number, { id: string; n: number }>;
const log = (message: string) => console.log(`  ${message}`);
const errorCode = (error: unknown) => (error as { code?: string })?.code ?? (error instanceof Error ? error.message : String(error));

async function generation() {
  return (await prisma.adminAuditLog.count({ where: { action: DEV_SEED_RESET_AUDIT } })) + 1;
}

async function mockBatch() {
  return (await prisma.testDataBatch.findFirst({ where: { label: DEV_SEED_BATCH_LABEL } }))
    ?? prisma.testDataBatch.create({ data: { label: DEV_SEED_BATCH_LABEL } });
}

async function mockUserIds() {
  const batch = await prisma.testDataBatch.findFirst({ where: { label: DEV_SEED_BATCH_LABEL } });
  if (!batch) return [];
  return (await prisma.user.findMany({ where: { testDataBatchId: batch.id, isTestAccount: true }, select: { id: true } })).map(({ id }) => id);
}

async function placeholderPhoto(n: number, initials: string) {
  const hue = (n * 37) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
    <rect width="512" height="512" fill="hsl(${hue},55%,42%)"/>
    <circle cx="256" cy="200" r="92" fill="hsl(${hue},45%,82%)"/>
    <rect x="116" y="316" width="280" height="196" rx="120" fill="hsl(${hue},45%,82%)"/>
    <text x="256" y="480" font-family="Arial, sans-serif" font-size="56" font-weight="700" fill="#fff" text-anchor="middle">${initials}</text>
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buffer, mimetype: 'image/png', size: buffer.byteLength };
}

async function ensurePlayers(): Promise<Players> {
  console.log('Mock players (player01 to player30)');
  const batch = await mockBatch();
  const city = await prisma.city.findUniqueOrThrow({ where: { code: 'CAPE_TOWN' } });
  const terms = await onboarding.currentLegalDocuments();
  if (!terms.length) throw new Error('No published Terms of Service. Publish docs/legal/legal-launch.json with legal:publish first.');
  const passwordHash = await argon2.hash(DEV_SEED_PASSWORD, { type: argon2.argon2id });
  const players: Players = new Map();
  let created = 0;
  for (const n of range(1, 30)) {
    const spec = mockPlayer(n);
    let user = await prisma.user.findUnique({ where: { email: spec.email }, include: { profile: { include: { photo: true, preferredPositions: true } } } });
    if (user && (!user.isTestAccount || user.testDataBatchId !== batch.id))
      throw new Error(`${spec.email} exists but is not a DEV SEED mock account. Refusing to touch it.`);
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: spec.email,
          username: spec.username,
          passwordHash,
          emailVerifiedAt: new Date(),
          isTestAccount: true,
          testDataBatchId: batch.id,
          profile: { create: { displayName: spec.displayName } },
          walletAccount: { create: { currency: 'ZAR' } },
        },
        include: { profile: { include: { photo: true, preferredPositions: true } } },
      });
      created += 1;
    }
    if (!user.profile?.dateOfBirth || !user.profile.preferredPositions.length)
      await onboarding.saveProfile(user.id, { dateOfBirth: spec.dateOfBirth, yearsExperience: spec.yearsExperience, cityId: city.id, preferredPositions: spec.positions });
    if (!user.profile?.photo) await photos.replace(user.id, await placeholderPhoto(n, spec.initials), {});
    // Recorded with source DEV_SEED so these acceptances are never mistaken for a real person's.
    await onboarding.acceptLegal(
      user.id,
      { documentIds: terms.map(({ id }) => id), source: 'DEV_SEED' as LegalAcceptanceInput['source'] },
      { ip: 'DEV SEED 127.0.0.1', userAgent: 'DEV SEED mock world' },
    );
    if (!user.onboardingCompletedAt) await onboarding.complete(user.id);
    players.set(n, { id: user.id, n });
  }
  log(`${created} created, ${30 - created} already there. Terms ${terms[0]!.version} accepted by all.`);
  return players;
}

async function fundWallets(players: Players, round: number) {
  console.log(`Wallets (R${DEV_SEED_WALLET_CENTS / 100} each, round ${round})`);
  let funded = 0;
  for (const player of players.values()) {
    const key = `DEV-SEED:round-${round}:wallet:${mockPlayer(player.n).email}`;
    if (await prisma.walletTransaction.findUnique({ where: { idempotencyKey: key } })) continue;
    const account = await prisma.walletAccount.findUniqueOrThrow({ where: { userId: player.id } });
    const shortfall = DEV_SEED_WALLET_CENTS - account.balanceCents;
    if (shortfall <= 0) continue;
    const amountCents = Math.max(5_000, Math.ceil(shortfall / 100) * 100);
    const result = await deposits.deposit(player.id, amountCents, key, { description: 'DEV SEED wallet top-up (demo, no real money)' });
    if (result.status !== 'success') throw new Error(`Demo top-up failed for player${player.n}: ${result.status}`);
    funded += 1;
  }
  log(`${funded} topped up through the demo top-up path; the rest already had their round-${round} top-up.`);
}

async function setUpReferee(email: string) {
  console.log(`Referee (${email})`);
  const me = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!me) throw new Error(`No account with the email ${email}.`);
  if (me.isTestAccount) throw new Error('--me must be your own account, not a mock player.');
  if (me.platformRole !== 'ADMIN' || me.accountStatus !== 'ACTIVE') throw new Error('--me must be an active admin account.');
  if (!(await prisma.refereeGrant.findFirst({ where: { userId: me.id, revokedAt: null } }))) {
    await refereeRoles.grant(me.id, me.id, { reason: `${DEV_SEED}: referee for the local mock world scenarios` }, REQUEST_ID);
    log('Referee role granted (audited, reason "DEV SEED").');
  } else log('Already a referee; left as is.');
  const settings = await prisma.refereeSettings.findUniqueOrThrow({ where: { id: 1 } });
  if (settings.defaultRefereeUserId !== me.id) {
    await refereeAssignments.setSettings(me.id, { defaultRefereeUserId: me.id }, REQUEST_ID);
    await serializableTransaction((tx) => appendAdminAudit(tx, {
      actorUserId: me.id, action: 'DEV_SEED_DEFAULT_REFEREE_SET', entityType: 'REFEREE_SETTINGS', entityId: '1', requestId: REQUEST_ID,
      metadata: { mark: DEV_SEED, from: settings.defaultRefereeUserId, to: me.id },
    }));
    log('Set as the default referee (audited as DEV SEED).');
  } else log('Already the default referee; left as is.');
  return me;
}

async function ensureTeams(players: Players) {
  console.log('Teams');
  const ids: Record<string, string> = {};
  for (const spec of TEAMS) {
    const owner = players.get(spec.owner)!;
    let team = await prisma.team.findFirst({ where: { name: spec.name, ownerUserId: owner.id, archivedAt: null } });
    if (!team) {
      const created = await teamsService.create({
        name: spec.name,
        description: `${DEV_SEED} mock team`,
        locationText: spec.locationText,
        primaryFormat: 'FIVE_A_SIDE',
        formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
        primaryColor: spec.primaryColor,
        secondaryColor: spec.secondaryColor,
      }, owner.id);
      team = await prisma.team.findUniqueOrThrow({ where: { id: created.id } });
    }
    ids[spec.key] = team.id;
    const members = new Map((await prisma.teamMembership.findMany({ where: { teamId: team.id } })).map((row) => [row.userId, row.role]));
    for (const n of spec.members) {
      const member = players.get(n)!;
      if (members.has(member.id)) continue;
      const invite = await teamsService.createInvite(team.id, owner.id);
      await teamsService.acceptInvite(invite.inviteUrl!.split('/').pop()!, member.id);
    }
    const captain = players.get(spec.captain)!;
    if ((await prisma.teamMembership.findFirst({ where: { teamId: team.id, userId: captain.id } }))?.role !== 'CAPTAIN')
      await teamsService.updateMemberRole(team.id, captain.id, 'CAPTAIN', owner.id);
    for (const n of spec.contributors)
      await teamWallet.contribute(team.id, players.get(n)!.id, DEV_SEED_TEAM_CONTRIBUTION_CENTS, `DEV-SEED:team:${team.id}:contribution:player${n}`);
    const account = await prisma.teamWalletAccount.findUniqueOrThrow({ where: { teamId: team.id } });
    log(`${spec.name}: ${spec.members.length} members, owner player${String(spec.owner).padStart(2, '0')}, captain player${String(spec.captain).padStart(2, '0')}, team wallet R${account.balanceCents / 100}.`);
  }
  return ids;
}

/** A published, active field at a FootyFinder venue that supports every format given. */
async function fieldFor(formats: MatchFormat[]) {
  const field = await prisma.managedField.findFirst({
    where: {
      status: 'ACTIVE',
      venue: { isActive: true, publicationStatus: 'PUBLISHED' },
      AND: formats.map((format) => ({ supportedFormats: { some: { format } } })),
    },
    include: { venue: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!field)
    throw new Error(`No published field supports ${formats.join(' and ')}. Create one in Admin -> Venues (see docs/DEV_MOCK_WORLD.md).`);
  return field;
}

const gridSlotAtLeast = (at: Date) => new Date(Math.ceil(at.getTime() / (30 * MINUTE)) * 30 * MINUTE);
/** HH:MM Johannesburg time, tomorrow. */
function tomorrowAt(hour: number, minute: number, now: Date) {
  const local = new Date(now.getTime() + TZ_OFFSET_MINUTES * MINUTE);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, hour, minute);
  return new Date(day - TZ_OFFSET_MINUTES * MINUTE);
}

/**
 * Publishes through the normal create path at the first 30-minute slot from `from` where the
 * field is free and the referee would not be double-booked (D27), so the default-referee rule
 * assigns `refereeId` on publish.
 */
async function publishAtFreeSlot(input: Omit<CreateMatchInput, 'startsAt'>, hostId: string, from: Date, refereeId: string) {
  let startsAt = gridSlotAtLeast(from);
  for (let attempt = 0; attempt < 48; attempt += 1, startsAt = new Date(startsAt.getTime() + 30 * MINUTE)) {
    if (await findRefereeClash(prisma, refereeId, { id: '00000000-0000-0000-0000-000000000000', startsAt, durationMinutes: 60 })) continue;
    try {
      const created = await matches.create({ ...input, startsAt: startsAt.toISOString() } as CreateMatchInput, hostId);
      const row = await prisma.match.findUniqueOrThrow({ where: { id: created.id }, select: { id: true, refereeUserId: true, startsAt: true } });
      if (row.refereeUserId !== refereeId) throw new Error(`${input.name} was published without you as its referee.`);
      return row;
    } catch (error) {
      if (['FIELD_TIME_CONFLICT', 'FIELD_UNAVAILABLE'].includes(errorCode(error))) continue;
      throw error;
    }
  }
  throw new Error(`No free slot found for ${input.name}.`);
}

async function joinAndClaim(matchId: string, entries: Array<{ n: number; side: TeamSide }>, players: Players) {
  const used = new Set<string>();
  for (const { n, side } of entries) {
    const player = players.get(n)!;
    await matches.join(matchId, player.id, { team: side }, `DEV-SEED:join:${matchId}:player${n}`);
    const participant = await prisma.matchParticipant.findFirstOrThrow({ where: { matchId, userId: player.id, status: 'JOINED' }, include: { formationSlot: true } });
    if (participant.formationSlot) continue;
    const slots = await prisma.formationSlot.findMany({ where: { matchId, team: side, participantId: null }, orderBy: { slotIndex: 'asc' } });
    const free = slots.filter((slot) => !used.has(slot.id));
    const slot = GOALKEEPERS.has(n) ? free.find((item) => item.slotIndex === 1) ?? free[0] : free.find((item) => item.slotIndex !== 1) ?? free[0];
    if (!slot) continue;
    used.add(slot.id);
    await matches.claimPosition(matchId, slot.id, player.id);
  }
}

async function arrangeLineup(matchId: string, side: TeamSide, managerId: string, starters: number[], subs: number[], players: Players) {
  const lineup = await lineups.get(matchId, side, managerId);
  const slots = [...lineup.slots].sort((a, b) => a.slotIndex - b.slotIndex);
  for (const [index, n] of starters.entries())
    await lineups.assignStarter(matchId, side, slots[index]!.id, { userId: players.get(n)!.id }, managerId);
  for (const n of subs) await lineups.selectSubstitute(matchId, side, players.get(n)!.id, managerId);
  await lineups.finalize(matchId, side, managerId);
}

type Scenario = { key: string; matchId: string; startsAt: Date; test: string; loginAs: string; note?: string };

async function scenarios(players: Players, teamIds: Record<string, string>, refereeId: string, round: number, now: Date) {
  console.log('Scenarios');
  const five = await fieldFor(['FIVE_A_SIDE']);
  const seven = await fieldFor(['SEVEN_A_SIDE']);
  log(`5-a-side field: ${five.venue.name} / ${five.name}. 7-a-side field: ${seven.venue.name} / ${seven.name}.`);
  const tag = (key: string) => `${DEV_SEED} mock world, round ${round}, scenario ${key}. Test data only.`;
  const existing = async (key: string) => prisma.match.findFirst({ where: { description: tag(key) }, select: { id: true, startsAt: true } });
  const id = (n: number) => players.get(n)!.id;
  const quick = (key: string, title: string, format: MatchFormat, fieldId: string): Omit<CreateMatchInput, 'startsAt'> => ({
    name: `${DEV_SEED_MATCH_PREFIX} ${key} · ${title}`, description: tag(key), format, managedFieldId: fieldId,
    substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC',
  });
  const results: Scenario[] = [];
  const toShift: Array<{ key: string; matchId: string; target: Date }> = [];

  // A, B and C each keep the referee busy for 90 minutes (60-minute match + 30 minutes' travel, D27),
  // so they are staggered. Players may only publish 2 hours ahead, so each is published at a free
  // slot further out and then moved to its target with the dev time helper.
  const targetA = new Date(Math.ceil((now.getTime() + 40 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE);
  const targets: Record<string, Date> = { A: targetA, B: new Date(targetA.getTime() + 90 * MINUTE), C: new Date(targetA.getTime() + 180 * MINUTE) };
  let from = new Date(now.getTime() + 2 * 60 * MINUTE + 5 * MINUTE);

  let a = await existing('A');
  if (!a) {
    a = await publishAtFreeSlot(quick('A', 'Quick 5-a-side, one place left for you', 'FIVE_A_SIDE', five.id), id(21), from, refereeId);
    await joinAndClaim(a.id, [
      { n: 21, side: 'HOME' }, { n: 22, side: 'HOME' }, { n: 23, side: 'HOME' }, { n: 24, side: 'HOME' }, { n: 26, side: 'HOME' },
      { n: 25, side: 'AWAY' }, { n: 27, side: 'AWAY' }, { n: 28, side: 'AWAY' }, { n: 29, side: 'AWAY' },
    ], players);
    toShift.push({ key: 'A', matchId: a.id, target: targets.A! });
    from = new Date(a.startsAt.getTime() + 90 * MINUTE);
  } else log('A already exists for this round; left as is.');
  results.push({ key: 'A', matchId: a.id, startsAt: a.startsAt, loginAs: 'You (join the AWAY side, pay R80, claim the open position)', test: 'Join, pay, claim; T-30 go ahead; kick-off; record the result as referee; stats; team-free Quick Match (no reviews), lineup record' });

  let b = await existing('B');
  if (!b) {
    b = await publishAtFreeSlot(quick('B', 'Quick 5-a-side, short of players', 'FIVE_A_SIDE', five.id), id(30), from, refereeId);
    await joinAndClaim(b.id, [
      { n: 15, side: 'HOME' }, { n: 16, side: 'HOME' }, { n: 17, side: 'HOME' },
      { n: 18, side: 'AWAY' }, { n: 19, side: 'AWAY' }, { n: 20, side: 'AWAY' },
    ], players);
    toShift.push({ key: 'B', matchId: b.id, target: targets.B! });
    from = new Date(b.startsAt.getTime() + 90 * MINUTE);
  } else log('B already exists for this round; left as is.');
  results.push({ key: 'B', matchId: b.id, startsAt: b.startsAt, loginAs: 'player15 (or player30, the host)', test: 'T-30 auto-cancel (positions not filled): every R80 refunded to the wallet, in-app cancellation notice, the email printed in the API console' });

  let c = await existing('C');
  if (!c) {
    c = await publishAtFreeSlot({
      ...quick('C', 'Wanderers v Observatory United (teams only)', 'FIVE_A_SIDE', five.id),
      playAsTeamId: teamIds.WANDERERS, otherSideMode: 'TEAMS_ONLY', teamSubstituteCount: 2,
    }, id(1), from, refereeId);
    await teamMatches.loadTeam(c.id, id(15), { teamId: teamIds.OBSERVATORY!, substituteCount: 2 });
    await meters.fill(c.id, 'HOME', id(2), undefined, `DEV-SEED:meter:${c.id}:HOME`);
    await meters.fill(c.id, 'AWAY', id(16), undefined, `DEV-SEED:meter:${c.id}:AWAY`);
    await arrangeLineup(c.id, 'HOME', id(2), [1, 2, 3, 4, 5], [6, 7], players);
    await arrangeLineup(c.id, 'AWAY', id(16), [15, 16, 17, 18, 19], [20, 21], players);
    toShift.push({ key: 'C', matchId: c.id, target: targets.C! });
  } else log('C already exists for this round; left as is.');
  results.push({ key: 'C', matchId: c.id, startsAt: c.startsAt, loginAs: 'player02 (Wanderers captain) or player16 (Observatory captain)', test: 'Team T-30: both R560 team fees captured once; lineup lock and lineup record at kick-off; referee result; team reviews (14 days) and stats' });

  let d = await existing('D');
  if (!d) {
    d = await publishAtFreeSlot({
      ...quick('D', 'Wanderers home, open to both', 'FIVE_A_SIDE', five.id),
      playAsTeamId: teamIds.WANDERERS, otherSideMode: 'OPEN', teamSubstituteCount: 2,
    }, id(1), tomorrowAt(18, 0, now), refereeId);
  } else log('D already exists for this round; left as is.');
  results.push({ key: 'D', matchId: d.id, startsAt: d.startsAt, loginAs: 'player29 or player30 (join as individuals), player15 ("Load my team" instead), player01/player02 (withdraw, cancel)', test: 'Individuals vs "Load my team" race for the other side, R80 per individual, team withdraw, home cancel with refunds' });

  let e = await existing('E');
  if (!e) {
    e = await publishAtFreeSlot(quick('E', 'Quick 7-a-side, half full', 'SEVEN_A_SIDE', seven.id), id(22), tomorrowAt(20, 0, now), refereeId);
    await joinAndClaim(e.id, [
      { n: 25, side: 'HOME' }, { n: 22, side: 'HOME' }, { n: 23, side: 'HOME' }, { n: 24, side: 'HOME' },
      { n: 26, side: 'AWAY' }, { n: 27, side: 'AWAY' }, { n: 28, side: 'AWAY' },
    ], players);
  } else log('E already exists for this round; left as is.');
  results.push({ key: 'E', matchId: e.id, startsAt: e.startsAt, loginAs: 'player23 (leave >12h before: full refund), you in the admin app (Cancel match (weather/venue))', test: 'Leaving more than 12 hours before kick-off; the admin "Cancel match (weather/venue)" button with full refunds' });

  for (const item of toShift) {
    const current = await prisma.match.findUniqueOrThrow({ where: { id: item.matchId }, select: { startsAt: true } });
    const minutes = Math.round((item.target.getTime() - current.startsAt.getTime()) / MINUTE);
    try {
      const shifted = await shiftDevSeedMatch(item.matchId, minutes, new Date());
      log(`${item.key} moved ${minutes} min to kick off at ${local(shifted.to)} (T-30 check ${local(shifted.goNoGoAt!)}).`);
    } catch (error) {
      if (!(error instanceof ShiftRefusedError)) throw error;
      const result = results.find(({ key }) => key === item.key)!;
      result.note = `Not moved: ${error.message}`;
      log(`${item.key} left at its published time: ${error.message}`);
    }
  }
  for (const result of results)
    result.startsAt = (await prisma.match.findUniqueOrThrow({ where: { id: result.matchId }, select: { startsAt: true } })).startsAt;
  return results;
}

const local = (date: Date) => {
  const shifted = new Date(date.getTime() + TZ_OFFSET_MINUTES * MINUTE);
  return `${shifted.toISOString().slice(0, 10)} ${shifted.toISOString().slice(11, 16)}`;
};

function printTable(rows: Scenario[]) {
  console.log('\nScenarios (times are Johannesburg time)\n');
  for (const row of rows) {
    console.log(`${row.key}  kick-off ${local(row.startsAt)}  ${devSeedMatchLink(row.matchId)}`);
    console.log(`   Test:        ${row.test}`);
    console.log(`   Log in as:   ${row.loginAs}`);
    if (row.note) console.log(`   Note:        ${row.note}`);
  }
  console.log(`\nEvery mock player: player01@footyfinder.test ... player30@footyfinder.test, password ${DEV_SEED_PASSWORD}`);
  console.log('Move a kick-off: npm run dev:shift-match -- <matchId> <minutes>   (negative = earlier). Keep the dev API running: it runs the T-30 check and kick-off.');
}

/** Two players become friends through the normal request-and-accept path (idempotent). */
async function befriend(requesterId: string, recipientId: string) {
  const relationship = await friendsService.send(requesterId, recipientId);
  if (relationship.state === 'REQUESTED' && relationship.requestId) await friendsService.accept(recipientId, relationship.requestId);
}

/**
 * Gate 9 (CEO D18): friendships, recruitment posts, looking players and a join request, all through
 * the normal services. With --me, you are friends with player01 and player16, and player03 has sent
 * you a friend request.
 */
async function ensureSocial(players: Players, teamIds: Record<string, string>, meId?: string) {
  console.log('Social');
  const id = (n: number) => players.get(n)!.id;
  for (const [a, b] of [[1, 2], [1, 3], [2, 3], [15, 16], [16, 17], [21, 22], [22, 23], [29, 30], [1, 15]] as const) await befriend(id(a), id(b));
  if (meId) {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: meId }, select: { friendRequestsEnabled: true } });
    if (me.friendRequestsEnabled) {
      await befriend(id(1), meId);
      await befriend(id(16), meId);
      const pending = await friendsService.relationships(id(3), [meId]);
      if (pending.get(meId)!.state === 'CAN_REQUEST') await friendsService.send(id(3), meId);
    } else log('Your account has friend requests turned off; skipped your friendships.');
  }
  const posts = [
    { team: 'WANDERERS', owner: 1, input: { positions: ['GOALKEEPER', 'DEFENDER'], playersWanted: 2, format: 'SEVEN_A_SIDE', level: 'COMPETITIVE', days: [2, 4], times: ['EVENING'], area: 'Woodstock, Cape Town', note: 'We need a keeper and a centre-back for Tuesday and Thursday evenings.' } },
    { team: 'OBSERVATORY', owner: 15, input: { positions: ['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD'], playersWanted: 5, format: 'ELEVEN_A_SIDE', level: 'CASUAL', days: [6, 0], times: ['MORNING'], area: 'Observatory, Cape Town', note: 'Starting an 11-a-side weekend side. All positions welcome.' } },
  ] as const;
  const postIds: Record<string, string> = {};
  for (const post of posts) {
    const teamId = teamIds[post.team]!;
    const existing = await prisma.teamRecruitmentPost.findFirst({ where: { teamId, status: 'OPEN' } });
    postIds[post.team] = existing?.id ?? (await recruitmentService.createPost(id(post.owner), teamId, { ...post.input, positions: [...post.input.positions], days: [...post.input.days], times: [...post.input.times] })).id;
  }
  await recruitmentService.updateCard(id(29), { enabled: true, positions: ['FORWARD', 'MIDFIELDER'], area: 'Salt River', days: [6], times: ['MORNING'], note: 'Quick winger, free on Saturday mornings.' });
  await recruitmentService.updateCard(id(30), { enabled: true, positions: ['GOALKEEPER'], area: 'Rondebosch', days: [1, 3], times: ['EVENING'], note: 'Keeper looking for a regular weekday side.' });
  await recruitmentService.askToJoin(id(29), postIds.OBSERVATORY!);
  log('9 friendships between mock players, 2 recruitment posts, player29 and player30 looking for a team, player29 has asked to join Observatory United.');
  if (meId) log('You: friends with player01 and player16; player03 has sent you a friend request.');
}

/** Reset: posts closed, join requests and friend requests cancelled, looking cards off, mock-to-mock friendships removed. */
async function resetSocial(userIds: string[]) {
  console.log('Social');
  const posts = await prisma.teamRecruitmentPost.findMany({ where: { status: 'OPEN', team: { ownerUserId: { in: userIds }, archivedAt: null } }, include: { team: { select: { ownerUserId: true } } } });
  for (const post of posts) await recruitmentService.closePost(post.team.ownerUserId, post.teamId, post.id);
  const requests = await prisma.teamJoinRequest.findMany({ where: { userId: { in: userIds }, status: 'PENDING' } });
  for (const request of requests) await recruitmentService.cancelJoinRequest(request.userId, request.id);
  const cards = await prisma.playerLookingCard.findMany({ where: { userId: { in: userIds }, enabled: true } });
  for (const card of cards) await recruitmentService.updateCard(card.userId, { enabled: false, positions: card.positions, days: card.days, times: card.times });
  const pending = await prisma.friendRequest.findMany({ where: { requesterId: { in: userIds }, status: 'PENDING' } });
  for (const request of pending) await friendsService.close(request.requesterId, request.id, 'CANCEL');
  const friendships = await prisma.friendship.findMany({ where: { userLowId: { in: userIds }, userHighId: { in: userIds } } });
  for (const friendship of friendships) await friendsService.remove(friendship.userLowId, friendship.userHighId);
  log(`Closed ${posts.length} posts, cancelled ${requests.length} join requests and ${pending.length} friend requests, switched off ${cards.length} looking cards, removed ${friendships.length} mock friendships. Your own friendships are kept.`);
}

export async function seed(meEmail: string | undefined) {
  const now = new Date();
  const round = await generation();
  console.log(`DEV SEED mock world, round ${round}\n`);
  const players = await ensurePlayers();
  await fundWallets(players, round);
  const teamIds = await ensureTeams(players);
  const meForSocial = meEmail ? await prisma.user.findUnique({ where: { email: meEmail.trim().toLowerCase() }, select: { id: true, isTestAccount: true } }) : null;
  await ensureSocial(players, teamIds, meForSocial && !meForSocial.isTestAccount ? meForSocial.id : undefined);
  if (!meEmail) {
    console.log('\nNo --me given: players and teams are ready; scenarios need you as their referee (npm run dev:seed-mock -- --me <your email>).');
    return;
  }
  const me = await setUpReferee(meEmail);
  const rows = await scenarios(players, teamIds, me.id, round, now);
  await serializableTransaction((tx) => appendAdminAudit(tx, {
    actorUserId: me.id, action: 'DEV_SEED_MOCK_WORLD_SEEDED', entityType: 'DEV_SEED', requestId: REQUEST_ID,
    metadata: { mark: DEV_SEED, round, matches: rows.map(({ key, matchId }) => ({ key, matchId })) },
  }));
  printTable(rows);
}

/**
 * --reset-mock (CEO-approved, 2026-09-30). Mock accounts are kept: their Terms acceptances are
 * append-only legal records that block deleting the account. Not-started scenario matches are
 * cancelled through the normal cancel path (full refunds); started, finished and cancelled ones are
 * kept as history and marked. Mock teams are closed through the normal team-closure path. The next
 * seed run starts a new round with fresh teams and scenarios.
 */
export async function resetMock(meEmail: string | undefined) {
  const now = new Date();
  const round = await generation();
  console.log(`DEV SEED reset (ending round ${round})\n`);
  const userIds = await mockUserIds();
  if (!userIds.length) {
    console.log('No mock players found. Nothing to reset.');
    return;
  }
  const me = meEmail ? await prisma.user.findUnique({ where: { email: meEmail.trim().toLowerCase() } }) : null;
  if (meEmail && (!me || me.platformRole !== 'ADMIN' || me.isTestAccount)) throw new Error('--me must be your own active admin account.');
  const seeded = await prisma.match.findMany({
    where: { name: { startsWith: DEV_SEED_MATCH_PREFIX }, createdById: { in: userIds } },
    select: { id: true, name: true, status: true, startsAt: true, description: true, createdById: true },
    orderBy: { startsAt: 'asc' },
  });
  const summary = { cancelled: [] as string[], keptAsHistory: [] as string[], notCancelled: [] as string[], teamsClosed: [] as string[], teamsKept: [] as string[] };
  const historyNote = ` Kept as history by --reset-mock on ${now.toISOString().slice(0, 10)}.`;
  console.log('Scenario matches');
  for (const match of seeded) {
    const notStarted = ['OPEN', 'READY', 'DRAFT'].includes(match.status) && match.startsAt > now;
    if (!notStarted) {
      if (!match.description?.includes('Kept as history'))
        await prisma.match.update({ where: { id: match.id }, data: { description: `${match.description ?? DEV_SEED}${historyNote}` } });
      summary.keptAsHistory.push(`${match.name} (${match.status})`);
      continue;
    }
    try {
      await matches.remove(match.id, match.createdById);
      summary.cancelled.push(`${match.name} (host cancel)`);
    } catch (error) {
      const code = errorCode(error);
      if (me) {
        try {
          await adminCancel.cancel(match.id, me.id, { reason: `${DEV_SEED} reset: removing a mock scenario match` }, REQUEST_ID, now);
          summary.cancelled.push(`${match.name} (FootyFinder cancel)`);
          continue;
        } catch (adminError) {
          summary.notCancelled.push(`${match.name}: ${code} / ${errorCode(adminError)}`);
          continue;
        }
      }
      summary.notCancelled.push(`${match.name}: ${code}${me ? '' : ' (pass --me to try the admin cancel)'}`);
    }
  }
  for (const line of summary.cancelled) log(`Cancelled with full refunds: ${line}`);
  for (const line of summary.keptAsHistory) log(`Kept as history: ${line}`);
  for (const line of summary.notCancelled) log(`Could not cancel (left as is): ${line}`);

  await resetSocial(userIds);
  console.log('Mock teams');
  const teams = await prisma.team.findMany({ where: { ownerUserId: { in: userIds }, archivedAt: null } });
  for (const team of teams) {
    try {
      const { refunds } = await teamsService.remove(team.id, team.ownerUserId);
      await prisma.teamMessage.deleteMany({ where: { teamId: team.id } });
      summary.teamsClosed.push(team.name);
      log(`Closed ${team.name}; ${refunds?.length ?? 0} contributors got their unspent money back.`);
    } catch (error) {
      summary.teamsKept.push(`${team.name}: ${errorCode(error)}`);
      log(`Could not close ${team.name}: ${errorCode(error)}`);
    }
  }
  const notifications = await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  log(`Cleared ${notifications.count} notifications of mock players. Mock accounts, wallets and ledgers are kept.`);
  await serializableTransaction((tx) => appendAdminAudit(tx, {
    ...(me ? { actorUserId: me.id } : {}), action: DEV_SEED_RESET_AUDIT, entityType: 'DEV_SEED', requestId: REQUEST_ID,
    metadata: { mark: DEV_SEED, endedRound: round, ...summary },
  }));
  console.log(`\nRound ${round} ended. The next npm run dev:seed-mock starts round ${round + 1} with fresh teams and scenarios.`);
}
