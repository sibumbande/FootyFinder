import { getDefaultFormationKey } from '@footy-finder/shared';
import type { Notification } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationsService } from '../notifications/notifications.service.js';
import {
  TeamFixtureForbiddenError,
  type MatchesRepository,
} from '../matches/matches.repository.js';
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
const notifications = { publishPersistedMany: vi.fn() } as unknown as NotificationsService;
const images = { save: vi.fn(), delete: vi.fn() } as unknown as TeamImageStorage;
const teamMatch = {
  id: 'match-1',
  name: 'Team planning night',
  description: null,
  createdById: 'owner',
  venueId: 'venue-1',
  mode: 'TEAM_MATCH' as const,
  format: 'FIVE_A_SIDE' as const,
  substituteCapacityPerTeam: 5,
  rollingSubstitutes: false,
  rules: [],
  visibility: 'PRIVATE' as const,
  inviteToken: null,
  startsAt: new Date('2099-01-01T18:00:00.000Z'),
  durationMinutes: 50,
  feeCents: 0,
  currency: 'ZAR',
  status: 'DRAFT' as const,
  cancelledAt: null,
  createdAt: now,
  updatedAt: now,
  createdBy: publicUser('owner'),
  venue: {
    id: 'venue-1',
    name: 'Planning Pitch',
    addressLine1: '1 Team Road',
    addressLine2: null,
    locality: null,
    city: 'Johannesburg',
    region: 'Gauteng',
    postalCode: null,
    countryCode: 'ZA',
    latitude: null,
    longitude: null,
    externalPlaceId: null,
    createdAt: now,
    updatedAt: now,
  },
  participants: [],
  formationSlots: [],
  result: null,
  teamSides: [
    {
      id: 'match-team-1',
      matchId: 'match-1',
      teamId: 'team-1',
      side: 'HOME' as const,
      organisingUserId: 'owner',
      formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
      teamNameSnapshot: 'Test FC',
      teamImageUrlSnapshot: null,
      primaryColorSnapshot: null,
      secondaryColorSnapshot: null,
      availabilityRequestedAt: null,
      lineupFinalizedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
};

describe('TeamsService', () => {
  it('creates a private free HOME-only Team draft through the isolated Match repository', async () => {
    const matches = {
      createTeamFixture: vi.fn().mockResolvedValue(teamMatch),
    } as unknown as MatchesRepository;
    const service = new TeamsService({} as TeamsRepository, notifications, images, matches);
    const input = {
      name: 'Team planning night',
      format: 'FIVE_A_SIDE' as const,
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: false,
      rules: [],
      startsAt: '2099-01-01T18:00:00.000Z',
      formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
      venue: {
        name: 'Planning Pitch',
        addressLine1: '1 Team Road',
        city: 'Johannesburg',
        region: 'Gauteng',
        countryCode: 'ZA',
      },
    };
    await expect(service.createMatch('team-1', input, 'owner')).resolves.toMatchObject({
      mode: 'TEAM_MATCH',
      status: 'DRAFT',
      visibility: 'PRIVATE',
      feeCents: 0,
      teamSides: [{ side: 'HOME', teamId: 'team-1' }],
      viewerCanManage: true,
    });
    expect(matches.createTeamFixture).toHaveBeenCalledWith('team-1', input, 'owner', 90);
    expect(Object.keys(matches)).not.toContain('wallet');
  });

  it('maps MEMBER Team fixture creation to TEAM_FORBIDDEN', async () => {
    const matches = {
      createTeamFixture: vi.fn().mockRejectedValue(new TeamFixtureForbiddenError()),
    } as unknown as MatchesRepository;
    const service = new TeamsService({} as TeamsRepository, notifications, images, matches);
    await expect(
      service.createMatch(
        'team-1',
        {
          name: 'Blocked fixture',
          format: 'FIVE_A_SIDE',
          substituteCapacityPerTeam: 5,
          rollingSubstitutes: false,
          rules: [],
          startsAt: '2099-01-01T18:00:00.000Z',
          formationKey: getDefaultFormationKey('FIVE_A_SIDE'),
          venue: {
            name: 'Planning Pitch',
            addressLine1: '1 Team Road',
            city: 'Johannesburg',
            region: 'Gauteng',
            countryCode: 'ZA',
          },
        },
        'member',
      ),
    ).rejects.toMatchObject({ code: 'TEAM_FORBIDDEN' });
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

  it.each([
    ['MEMBER cannot edit Team', 'member', 'update'],
    ['CAPTAIN cannot delete Team', 'captain', 'remove'],
  ])('%s', async (_label, actor, operation) => {
    const repository = {
      findById: vi.fn().mockResolvedValue(team),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as TeamsRepository;
    const service = new TeamsService(repository, notifications, images);
    const action =
      operation === 'update'
        ? service.update('team-1', { name: 'Nope' }, actor)
        : service.remove('team-1', actor);
    await expect(action).rejects.toMatchObject({ statusCode: 403, code: 'TEAM_OWNER_REQUIRED' });
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
