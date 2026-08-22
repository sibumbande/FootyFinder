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
import { domainEvents } from '../../events/domain-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toMatch } from '../matches/match.mapper.js';
import {
  MatchesRepository,
  TeamFixtureForbiddenError,
  TeamFixtureTeamNotFoundError,
  durationForFormat,
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
    return toTeamDetail(await this.teams.create(input, userId), userId);
  }
  async list(userId: string) {
    return (await this.teams.listForUser(userId)).map((team) => toTeamSummary(team, userId));
  }
  async get(id: string, userId: string) {
    const team = await this.load(id);
    return toTeamDetail(team, userId);
  }
  async update(id: string, input: UpdateTeamInput, userId: string) {
    await this.assertOwner(id, userId);
    const team = toTeamDetail(await this.teams.update(id, input), userId);
    domainEvents.emit('team:details-updated', { teamId: id, team });
    return team;
  }
  async remove(id: string, userId: string) {
    const team = await this.assertOwner(id, userId);
    await this.teams.delete(id);
    if (team.profileImageUrl) await this.images.delete(team.profileImageUrl);
  }
  async createMatch(id: string, input: CreateTeamMatchInput, userId: string) {
    this.assertFormation(input.format, input.formationKey);
    try {
      return toMatch(
        await this.matches.createTeamFixture(
          id,
          input,
          userId,
          durationForFormat(input.format, {
            FIVE_A_SIDE: env.MATCH_DURATION_FIVE_A_SIDE_MINUTES,
            SEVEN_A_SIDE: env.MATCH_DURATION_SEVEN_A_SIDE_MINUTES,
            ELEVEN_A_SIDE: env.MATCH_DURATION_ELEVEN_A_SIDE_MINUTES,
          }),
        ),
        { viewerCanManage: true, viewerCanChat: true },
      );
    } catch (error) {
      if (error instanceof TeamFixtureTeamNotFoundError)
        throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
      if (error instanceof TeamFixtureForbiddenError)
        throw new AppError(403, 'Owner or captain permission is required.', 'TEAM_FORBIDDEN');
      throw error;
    }
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
      domainEvents.emit('team:details-updated', { teamId: id, team: dto });
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
    return toTeamMember(
      await this.teams.updateMemberRole(id, memberUserId, role as 'CAPTAIN' | 'MEMBER'),
    );
  }
  async removeMember(id: string, memberUserId: string, userId: string) {
    const team = await this.assertOwner(id, userId);
    if (memberUserId === team.ownerUserId)
      throw new AppError(409, 'The Team owner cannot be removed.', 'TEAM_OWNER_REQUIRED');
    const existing = await this.teams.findMembership(id, memberUserId);
    if (!existing) throw new AppError(404, 'Team member not found.', 'TEAM_MEMBER_NOT_FOUND');
    await this.teams.removeMember(id, memberUserId);
    domainEvents.emit('team:member-removed', { teamId: id, userId: memberUserId });
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
    const team = await this.load(result.invite.teamId);
    if (result.outcome === 'JOINED') {
      const member = toTeamMember(result.membership);
      domainEvents.emit('team:member-joined', { teamId: team.id, member });
      const admins = team.memberships.filter(({ role }) => role === 'OWNER' || role === 'CAPTAIN');
      await Promise.all(
        admins
          .filter(({ userId: adminId }) => adminId !== userId)
          .map(({ userId: adminId }) =>
            this.notifications.create(
              adminId,
              'TEAM_MEMBER_JOINED',
              'New team member',
              `${member.user.displayName} joined ${team.name}.`,
              `/teams/${team.id}`,
            ),
          ),
      );
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
    domainEvents.emit('team:formation-updated', { teamId: id, format, formation });
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
      domainEvents.emit('team:formation-updated', { teamId: id, format, formation });
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
  private async load(id: string) {
    const team = await this.teams.findById(id);
    if (!team) throw new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
    return team;
  }
  private async assertOwner(id: string, userId: string) {
    const team = await this.load(id);
    if (team.ownerUserId !== userId)
      throw new AppError(403, 'Only the Team owner can do that.', 'TEAM_OWNER_REQUIRED');
    return team;
  }
  private async assertAdmin(id: string, userId: string) {
    const team = await this.load(id);
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
