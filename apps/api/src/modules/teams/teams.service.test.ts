import { getDefaultFormationKey } from '@footy-finder/shared';
import type { Notification } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { MatchesRepository } from '../matches/matches.repository.js';
import type { TeamImageStorage } from './team-image.storage.js';
import type { TeamsRepository } from './teams.repository.js';
import { TeamsService } from './teams.service.js';

const now = new Date('2026-08-20T10:00:00.000Z');
const validToken = 'a'.repeat(43);
const publicUser = (id: string, displayName = id) => ({
  id,
  email: `${id}@private.invalid`,
  username: id,
  passwordHash: 'private',
  createdAt: now,
  updatedAt: now,
  profile: {
    displayName,
    avatarUrl: null,
    bio: null,
    dominantFoot: null,
    homeArea: null,
    createdAt: now,
    updatedAt: now,
    preferredPositions: [],
  },
  walletAccount: { balanceCents: 91_000, currency: 'ZAR' },
  teamMemberships: [],
});
const membership = (userId: string, role: 'OWNER' | 'CAPTAIN' | 'MEMBER') => ({
  id: `membership-${userId}`,
  teamId: 'team-1',
  userId,
  role,
  joinedAt: now,
  user: publicUser(userId),
});
const team = {
  id: 'team-1',
  name: 'Test FC',
  shortName: 'TFC',
  description: null,
  profileImageUrl: null,
  locationText: null,
  primaryFormat: 'FIVE_A_SIDE' as const,
  primaryColor: null,
  secondaryColor: null,
  ownerUserId: 'owner',
  owner: publicUser('owner'),
  memberships: [
    membership('owner', 'OWNER'),
    membership('captain', 'CAPTAIN'),
    membership('member', 'MEMBER'),
  ],
  _count: { memberships: 3 },
  createdAt: now,
  updatedAt: now,
};
// CEO touch-up batch 4, item 2: team statistics read the database; these tests stub them.
vi.mock('./team-stats.js', () => ({ teamStats: vi.fn(async () => ({ played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, lastFive: [] })) }));
const notifications = { publishPersistedMany: vi.fn() } as unknown as NotificationsService;
const images = { save: vi.fn(), delete: vi.fn() } as unknown as TeamImageStorage;

describe('TeamsService', () => {
  it('retires private fixtures at a typed-in venue (Gate 7 / N3)', async () => {
    const matches = { createTeamFixture: vi.fn() } as unknown as MatchesRepository;
    const service = new TeamsService({ findById: vi.fn().mockResolvedValue(team) } as unknown as TeamsRepository, notifications, images, matches);
    await expect(
      service.createMatch('team-1', {} as never, 'owner'),
    ).rejects.toMatchObject({ statusCode: 410, code: 'TEAM_FIXTURE_MANUAL_VENUE_RETIRED' });
    expect(matches.createTeamFixture).not.toHaveBeenCalled();
  });

  it('allows current members to list fixtures but rejects outsiders', async () => {
    const repository = { findById: vi.fn().mockResolvedValue(team) } as unknown as TeamsRepository;
    const matches = { listForTeam: vi.fn().mockResolvedValue([]) } as unknown as MatchesRepository;
    const service = new TeamsService(repository, notifications, images, matches);
    await expect(service.matchesForTeam('team-1', 'member')).resolves.toEqual([]);
    await expect(service.matchesForTeam('team-1', 'outsider')).rejects.toMatchObject({
      code: 'TEAM_FORBIDDEN',
    });
  });

  it('creates the Team and owner membership without touching a wallet', async () => {
    const repository = { create: vi.fn().mockResolvedValue(team) } as unknown as TeamsRepository;
    const service = new TeamsService(repository, notifications, images);
    const input = {
      name: 'Test FC',
      primaryFormat: 'FIVE_A_SIDE' as const,
      formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
    };
    await expect(service.create(input, 'owner')).resolves.toMatchObject({
      ownerUserId: 'owner',
      viewerRole: 'OWNER',
    });
    expect(repository.create).toHaveBeenCalledWith(input, 'owner');
    expect(Object.keys(repository)).not.toContain('wallet');
  });

  it('rejects a duplicate Team short name before persistence', async () => {
    const repository = {
      findByShortName: vi.fn().mockResolvedValue({ id: 'existing-team' }),
      create: vi.fn(),
    } as unknown as TeamsRepository;
    const service = new TeamsService(repository, notifications, images);

    await expect(
      service.create(
        {
          name: 'Another Team',
          shortName: 'TFC',
          primaryFormat: 'FIVE_A_SIDE',
          formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
        },
        'owner',
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'TEAM_SHORT_NAME_TAKEN' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each([
    ['MEMBER cannot edit Team', 'member', 'update'],
    ['CAPTAIN cannot delete Team', 'captain', 'remove'],
  ])('%s', async (_label, actor, operation) => {
    const repository = {
      findById: vi.fn().mockResolvedValue(team),
      update: vi.fn(),
      close: vi.fn(),
    } as unknown as TeamsRepository;
    const service = new TeamsService(repository, notifications, images);
    const action =
      operation === 'update'
        ? service.update('team-1', { name: 'Nope' }, actor)
        : service.remove('team-1', actor);
    await expect(action).rejects.toMatchObject({ statusCode: 403, code: 'TEAM_OWNER_REQUIRED' });
  });

  describe('closing a team (Gate 7 / D7)', () => {
    const closeWith = (result: unknown, found: unknown = team) => {
      const repository = {
        findById: vi.fn().mockResolvedValue(found),
        close: vi.fn().mockResolvedValue(result),
      } as unknown as TeamsRepository;
      return { repository, service: new TeamsService(repository, notifications, images) };
    };

    it('refuses while a public team match is upcoming', async () => {
      const { service } = closeWith({ outcome: 'UPCOMING_MATCHES', refunds: [], notifications: [] });
      await expect(service.remove('team-1', 'owner')).rejects.toMatchObject({ statusCode: 409, code: 'TEAM_HAS_UPCOMING_MATCHES' });
    });

    it('refuses while fill-meter money is held', async () => {
      const { service } = closeWith({ outcome: 'HOLDS_ACTIVE', refunds: [], notifications: [] });
      await expect(service.remove('team-1', 'owner')).rejects.toMatchObject({ statusCode: 409, code: 'TEAM_WALLET_HOLDS_ACTIVE' });
    });

    it('archives the team, returns unspent money and publishes the refund notices after commit', async () => {
      const persisted = [{ id: 'n-1' }] as unknown as Notification[];
      const publish = vi.fn();
      const repository = {
        findById: vi.fn().mockResolvedValue(team),
        close: vi.fn().mockResolvedValue({ outcome: 'CLOSED', refunds: [{ userId: 'member', amountCents: 5_000 }], notifications: persisted }),
      } as unknown as TeamsRepository;
      const service = new TeamsService(repository, { publishPersistedMany: publish } as unknown as NotificationsService, images);
      await expect(service.remove('team-1', 'owner')).resolves.toEqual({ refunds: [{ userId: 'member', amountCents: 5_000 }] });
      expect(repository.close).toHaveBeenCalledWith('team-1', 'owner');
      expect(publish).toHaveBeenCalledWith(persisted);
    });

    it('treats a closed team as read-only', async () => {
      const { service, repository } = closeWith({ outcome: 'CLOSED' }, { ...team, archivedAt: now });
      await expect(service.remove('team-1', 'owner')).rejects.toMatchObject({ statusCode: 409, code: 'TEAM_ARCHIVED' });
      await expect(service.createInvite('team-1', 'captain')).rejects.toMatchObject({ code: 'TEAM_ARCHIVED' });
      expect(repository.close).not.toHaveBeenCalled();
    });
  });

  it('allows a captain to create an invite but prevents a member', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(team),
      createInvite: vi.fn().mockResolvedValue({
        id: 'invite-1',
        teamId: 'team-1',
        createdBy: publicUser('captain'),
        createdAt: now,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
        revokedAt: null,
        maxUses: 1,
        useCount: 0,
      }),
    } as unknown as TeamsRepository;
    const service = new TeamsService(repository, notifications, images);
    await expect(service.createInvite('team-1', 'captain')).resolves.toMatchObject({
      status: 'ACTIVE',
    });
    await expect(service.createInvite('team-1', 'member')).rejects.toMatchObject({
      code: 'TEAM_FORBIDDEN',
    });
  });

  it.each([
    ['REVOKED', 'TEAM_INVITE_REVOKED'],
    ['EXPIRED', 'TEAM_INVITE_EXPIRED'],
    ['USED', 'TEAM_INVITE_USED'],
  ] as const)('maps %s invitation outcomes safely', async (outcome, code) => {
    const repository = {
      acceptInvite: vi.fn().mockResolvedValue({ outcome }),
    } as unknown as TeamsRepository;
    await expect(
      new TeamsService(repository, notifications, images).acceptInvite(validToken, 'member'),
    ).rejects.toMatchObject({ code });
  });

  it('treats accepting as an existing member idempotently', async () => {
    const repository = {
      acceptInvite: vi.fn().mockResolvedValue({
        outcome: 'ALREADY_MEMBER',
        invite: { teamId: 'team-1' },
        membership: membership('member', 'MEMBER'),
        team,
        notifications: [],
      }),
    } as unknown as TeamsRepository;
    await expect(
      new TeamsService(repository, notifications, images).acceptInvite(validToken, 'member'),
    ).resolves.toMatchObject({ alreadyMember: true });
  });

  it('publishes manager notifications returned by a committed invitation acceptance', async () => {
    const notification: Notification = {
      id: 'notification-1',
      userId: 'owner',
      dedupeKey: 'team-invite:invite-1:accepted:member:owner',
      type: 'TEAM_MEMBER_JOINED',
      title: 'New team member',
      message: 'member joined Test FC.',
      targetPath: '/teams/team-1',
      readAt: null,
      createdAt: now,
    };
    const repository = {
      acceptInvite: vi.fn().mockResolvedValue({
        outcome: 'JOINED',
        invite: { id: 'invite-1', teamId: 'team-1' },
        membership: membership('member', 'MEMBER'),
        team,
        notifications: [notification],
      }),
    } as unknown as TeamsRepository;
    const publisher = {
      publishPersistedMany: vi.fn(),
    } as unknown as NotificationsService;

    await expect(
      new TeamsService(repository, publisher, images).acceptInvite(validToken, 'member'),
    ).resolves.toMatchObject({ alreadyMember: false });
    expect(publisher.publishPersistedMany).toHaveBeenCalledWith([notification]);
  });

  it('prevents removal or role mutation of the owner', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(team),
      removeMember: vi.fn(),
      updateMemberRole: vi.fn(),
    } as unknown as TeamsRepository;
    const service = new TeamsService(repository, notifications, images);
    await expect(service.removeMember('team-1', 'owner', 'owner')).rejects.toMatchObject({
      code: 'TEAM_OWNER_REQUIRED',
    });
    await expect(
      service.updateMemberRole('team-1', 'owner', 'MEMBER', 'owner'),
    ).rejects.toMatchObject({ code: 'TEAM_OWNER_REQUIRED' });
  });

  it('keeps private account and wallet fields out of Team responses', async () => {
    const repository = { findById: vi.fn().mockResolvedValue(team) } as unknown as TeamsRepository;
    const result = await new TeamsService(repository, notifications, images).get(
      'team-1',
      'member',
    );
    expect(result.owner).not.toHaveProperty('email');
    expect(result.owner).not.toHaveProperty('walletAccount');
    expect(result.members[0]?.user).not.toHaveProperty('email');
    expect(result.members[0]?.user).not.toHaveProperty('passwordHash');
  });

  it('allows captains to save valid formations and rejects members and invalid presets', async () => {
    const formation = {
      id: 'formation-1',
      teamId: 'team-1',
      format: 'FIVE_A_SIDE',
      formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
      updatedAt: now,
      slots: [],
    };
    const repository = {
      findById: vi.fn().mockResolvedValue(team),
      replaceFormation: vi.fn().mockResolvedValue(formation),
    } as unknown as TeamsRepository;
    const service = new TeamsService(repository, notifications, images);
    await expect(
      service.saveFormation(
        'team-1',
        'FIVE_A_SIDE',
        getDefaultFormationKey('FIVE_A_SIDE'),
        'captain',
      ),
    ).resolves.toMatchObject({ teamId: 'team-1' });
    await expect(
      service.saveFormation(
        'team-1',
        'FIVE_A_SIDE',
        getDefaultFormationKey('FIVE_A_SIDE'),
        'member',
      ),
    ).rejects.toMatchObject({ code: 'TEAM_FORBIDDEN' });
    await expect(
      service.saveFormation('team-1', 'FIVE_A_SIDE', 'not-a-preset', 'captain'),
    ).rejects.toMatchObject({ code: 'TEAM_FORMATION_INVALID' });
  });

  it('replaces an image and deletes the previous local image only after persistence', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue({ ...team, profileImageUrl: '/uploads/teams/old.webp' }),
      update: vi.fn().mockResolvedValue({ ...team, profileImageUrl: '/uploads/teams/new.webp' }),
    } as unknown as TeamsRepository;
    const storage = {
      save: vi.fn().mockResolvedValue('/uploads/teams/new.webp'),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as TeamImageStorage;
    const service = new TeamsService(repository, notifications, storage);
    await service.uploadImage('team-1', 'owner', {
      buffer: Buffer.from('image'),
      mimetype: 'image/webp',
      size: 5,
      originalname: '../../unsafe.webp',
    });
    expect(repository.update).toHaveBeenCalledWith('team-1', {
      profileImageUrl: '/uploads/teams/new.webp',
    });
    expect(storage.delete).toHaveBeenCalledWith('/uploads/teams/old.webp');
  });
});
