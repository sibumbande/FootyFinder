import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type {
  CreateTeamMatchInput,
  CreateTeamInput,
  MatchFormat,
  TeamRole,
  UpdateTeamFormationSlotInput,
  UpdateTeamInput,
} from '@footy-finder/shared';
import { getFormationPreset } from '@footy-finder/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { emitDomainEventBestEffort } from '../../events/domain-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toMatch } from '../matches/match.mapper.js';
import {
  MatchesRepository,
} from '../matches/matches.repository.js';
import {
  LocalTeamImageStorage,
  type TeamImageInput,
  type TeamImageStorage,
} from './team-image.storage.js';
import {
  toInviteLanding,
  toTeamDetail,
  toTeamFormation,
  toTeamInvite,
  toTeamMember,
  toTeamSummary,
} from './team.mapper.js';
import { TeamsRepository } from './teams.repository.js';
import { teamStats } from './team-stats.js';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const validInviteToken = /^[A-Za-z0-9_-]{43}$/;

export class TeamsService {
  constructor(
    private readonly teams = new TeamsRepository(),
    private readonly notifications = new NotificationsService(),
    private readonly images: TeamImageStorage = new LocalTeamImageStorage(
      resolve(env.TEAM_UPLOAD_DIR),
      env.PUBLIC_API_URL,
    ),
    private readonly matches = new MatchesRepository(),
  ) {}

  async create(input: CreateTeamInput, userId: string) {
    this.assertFormation(input.primaryFormat, input.formationKey);
    await this.assertShortNameAvailable(input.shortName);
    return toTeamDetail(await this.teams.create(input, userId), userId);
  }
  async list(userId: string) {
    return (await this.teams.listForUser(userId)).map((team) => toTeamSummary(team, userId));
  }
  async get(id: string, userId: string) {
    const team = await this.load(id);
    // CEO touch-up batch 4, item 2: results from final results only (same rules as player statistics).
    return { ...toTeamDetail(team, userId), stats: await teamStats(id) };
  }
  async update(id: string, input: UpdateTeamInput, userId: string) {
    await this.assertOwner(id, userId);
    await this.assertShortNameAvailable(input.shortName, id);
    const team = toTeamDetail(await this.teams.update(id, input), userId);
    emitDomainEventBestEffort('team:details-updated', { teamId: id, team });
    return team;
  }
  /** Gate 7 / D7: "Close team". The team is archived (never deleted) and unspent money returned. */
  async remove(id: string, userId: string) {
    await this.assertOwner(id, userId);
    const result = await this.teams.close(id, userId);
    if (result.outcome === 'UPCOMING_MATCHES')
      throw new AppError(
        409,
        'This team has an upcoming team match. Cancel it or wait until it has been played before closing the team.',
        'TEAM_HAS_UPCOMING_MATCHES',
      );
    if (result.outcome === 'HOLDS_ACTIVE')
      throw new AppError(
        409,
        'Team wallet money is still held for a match. It is released or spent when that match is decided.',
        'TEAM_WALLET_HOLDS_ACTIVE',
      );
    if (result.outcome === 'CLOSED') {
      this.notifications.publishPersistedMany(result.notifications);
      emitDomainEventBestEffort('team:deleted', { teamId: id });
    }
    return { refunds: result.refunds };
  }
  /**
   * Gate 7 / N3: private free fixtures at a typed-in venue are retired. Team matches are created
   * through POST /matches with playAsTeamId (the same wizard as Quick Matches). Existing drafts
   * stay readable and cancellable.
   */
  async createMatch(_id: string, _input: CreateTeamMatchInput, _userId: string): Promise<never> {
    throw new AppError(
      410,
      'Team matches are now created from the create-match flow at a FootyFinder venue.',
      'TEAM_FIXTURE_MANUAL_VENUE_RETIRED',
    );
  }
  async matchesForTeam(id: string, userId: string) {
    const { role } = await this.assertMember(id, userId);
    const viewerCanManage = role === 'OWNER' || role === 'CAPTAIN';
    return (await this.matches.listForTeam(id)).map((match) =>
      toMatch(match, { viewerCanManage, viewerCanChat: true }),
    );
  }
  async uploadImage(id: string, userId: string, file?: TeamImageInput) {
    const team = await this.assertOwner(id, userId);
    if (!file) throw new AppError(400, 'Choose a team image to upload.', 'TEAM_IMAGE_INVALID');
    const profileImageUrl = await this.images.save(file);
    try {
      const updated = await this.teams.update(id, { profileImageUrl });
      if (team.profileImageUrl) await this.images.delete(team.profileImageUrl);
      const dto = toTeamDetail(updated, userId);
      emitDomainEventBestEffort('team:details-updated', { teamId: id, team: dto });
      return dto;
    } catch (error) {
      await this.images.delete(profileImageUrl);
      throw error;
    }
  }

  async members(id: string, userId: string) {
    return (await this.get(id, userId)).members;
  }
  async updateMemberRole(id: string, memberUserId: string, role: TeamRole, userId: string) {
    const team = await this.assertOwner(id, userId);
    if (memberUserId === team.ownerUserId || role === 'OWNER')
      throw new AppError(409, 'The Team owner role cannot be changed here.', 'TEAM_OWNER_REQUIRED');
    const existing = await this.teams.findMembership(id, memberUserId);
    if (!existing) throw new AppError(404, 'Team member not found.', 'TEAM_MEMBER_NOT_FOUND');
    const member = toTeamMember(
      await this.teams.updateMemberRole(id, memberUserId, role as 'CAPTAIN' | 'MEMBER'),
    );
    emitDomainEventBestEffort('team:member-role-updated', {
      teamId: id,
      userId: memberUserId,
    });
    return member;
  }
  async removeMember(id: string, memberUserId: string, userId: string) {
    const team = await this.assertOwner(id, userId);
    if (memberUserId === team.ownerUserId)
      throw new AppError(409, 'The Team owner cannot be removed.', 'TEAM_OWNER_REQUIRED');
    const existing = await this.teams.findMembership(id, memberUserId);
    if (!existing) throw new AppError(404, 'Team member not found.', 'TEAM_MEMBER_NOT_FOUND');
    await this.teams.removeMember(id, memberUserId);
    emitDomainEventBestEffort('team:member-removed', { teamId: id, userId: memberUserId });
  }

  async createInvite(id: string, userId: string) {
    await this.assertAdmin(id, userId);
    const rawToken = randomBytes(32).toString('base64url');
    const invite = await this.teams.createInvite(
      id,
      userId,
      hashToken(rawToken),
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    );
    return toTeamInvite(invite, `${env.CLIENT_URL.replace(/\/$/, '')}/teams/invite/${rawToken}`);
  }
  async listInvites(id: string, userId: string) {
    await this.assertAdmin(id, userId);
    return (await this.teams.listInvites(id)).map((invite) => toTeamInvite(invite));
  }
  async revokeInvite(id: string, inviteId: string, userId: string) {
    await this.assertAdmin(id, userId);
    if ((await this.teams.revokeInvite(inviteId, id)).count !== 1)
      throw new AppError(409, 'This invitation is no longer active.', 'TEAM_INVITE_USED');
  }
  async inspectInvite(token: string) {
    if (!validInviteToken.test(token))
      throw new AppError(404, 'This Team invitation is invalid.', 'TEAM_INVITE_INVALID');
    const invite = await this.teams.findInviteByHash(hashToken(token));
    if (!invite) throw new AppError(404, 'This Team invitation is invalid.', 'TEAM_INVITE_INVALID');
    return toInviteLanding(invite);
  }
  async acceptInvite(token: string, userId: string) {
    if (!validInviteToken.test(token))
      throw new AppError(404, 'This Team invitation is invalid.', 'TEAM_INVITE_INVALID');
    const result = await this.teams.acceptInvite(hashToken(token), userId, new Date());
    if (result.outcome === 'INVALID')
      throw new AppError(404, 'This Team invitation is invalid.', 'TEAM_INVITE_INVALID');
    if (result.outcome === 'REVOKED')
      throw new AppError(409, 'This Team invitation was revoked.', 'TEAM_INVITE_REVOKED');
    if (result.outcome === 'EXPIRED')
      throw new AppError(410, 'This Team invitation has expired.', 'TEAM_INVITE_EXPIRED');
    if (result.outcome === 'USED')
      throw new AppError(409, 'This Team invitation has already been used.', 'TEAM_INVITE_USED');
    const team = result.team;
    if (result.outcome === 'JOINED') {
      const member = toTeamMember(result.membership);
      emitDomainEventBestEffort('team:member-joined', { teamId: team.id, member });
      this.notifications.publishPersistedMany(result.notifications);
    }
    return {
      team: toTeamDetail(team, userId),
      alreadyMember: result.outcome === 'ALREADY_MEMBER',
    };
  }

  async formation(id: string, format: MatchFormat, userId: string) {
    await this.get(id, userId);
    const formation = await this.teams.findFormation(id, format);
    if (!formation) throw new AppError(404, 'Team formation not found.', 'TEAM_FORMATION_INVALID');
    return toTeamFormation(formation);
  }
  async saveFormation(id: string, format: MatchFormat, formationKey: string, userId: string) {
    await this.assertAdmin(id, userId);
    this.assertFormation(format, formationKey);
    const formation = toTeamFormation(await this.teams.replaceFormation(id, format, formationKey));
    emitDomainEventBestEffort('team:formation-updated', { teamId: id, format, formation });
    return formation;
  }
  async updateFormationSlot(
    id: string,
    format: MatchFormat,
    slotId: string,
    input: UpdateTeamFormationSlotInput,
    userId: string,
  ) {
    await this.assertAdmin(id, userId);
    try {
      const formation = toTeamFormation(
        await this.teams.updateFormationSlot(id, format, slotId, input),
      );
      emitDomainEventBestEffort('team:formation-updated', { teamId: id, format, formation });
      return formation;
    } catch (error) {
      if (error instanceof Error && error.message === 'TEAM_MEMBER_NOT_FOUND')
        throw new AppError(
          400,
          'That player is not a member of this Team.',
          'TEAM_MEMBER_NOT_FOUND',
        );
      throw error;
    }
  }

  private assertFormation(format: MatchFormat, formationKey: string) {
    if (!getFormationPreset(format, formationKey))
      throw new AppError(
        400,
        'That formation is not valid for this format.',
        'TEAM_FORMATION_INVALID',
      );
  }
  private async assertShortNameAvailable(shortName?: string, excludingTeamId?: string) {
    if (!shortName) return;
    const existing = await this.teams.findByShortName(shortName, excludingTeamId);
    if (existing)
      throw new AppError(409, 'That Team short name is already in use.', 'TEAM_SHORT_NAME_TAKEN');
  }
  private async load(id: string) {
    const team = await this.teams.findById(id);
    if (!team) throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
    return team;
  }
  private assertNotArchived(team: { archivedAt: Date | null }) {
    if (team.archivedAt)
      throw new AppError(409, 'This team has been closed.', 'TEAM_ARCHIVED');
  }
  private async assertOwner(id: string, userId: string) {
    const team = await this.load(id);
    if (team.ownerUserId !== userId)
      throw new AppError(403, 'Only the Team owner can do that.', 'TEAM_OWNER_REQUIRED');
    this.assertNotArchived(team);
    return team;
  }
  private async assertAdmin(id: string, userId: string) {
    const team = await this.load(id);
    this.assertNotArchived(team);
    const member = team.memberships.find(({ userId: idOfMember }) => idOfMember === userId);
    if (!member || !['OWNER', 'CAPTAIN'].includes(member.role))
      throw new AppError(403, 'Owner or captain permission is required.', 'TEAM_FORBIDDEN');
    return team;
  }
  private async assertMember(id: string, userId: string) {
    const team = await this.load(id);
    const member = team.memberships.find(({ userId: idOfMember }) => idOfMember === userId);
    if (!member) throw new AppError(403, 'Current Team membership is required.', 'TEAM_FORBIDDEN');
    return member;
  }
}
