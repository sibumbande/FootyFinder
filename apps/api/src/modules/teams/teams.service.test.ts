import { getDefaultFormationKey } from '@footy-finder/shared';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationsService } from '../notifications/notifications.service.js';
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
const notifications = { create: vi.fn() } as unknown as NotificationsService;
const images = { save: vi.fn(), delete: vi.fn() } as unknown as TeamImageStorage;

describe('TeamsService', () => {
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
      }),
      findById: vi.fn().mockResolvedValue(team),
    } as unknown as TeamsRepository;
    await expect(
      new TeamsService(repository, notifications, images).acceptInvite(validToken, 'member'),
    ).resolves.toMatchObject({ alreadyMember: true });
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
