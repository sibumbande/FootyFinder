import type { GuestPlayerProfile, PublicTeamView } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import { TeamReviewsService } from '../team-reviews/team-reviews.service.js';
import { playerAvatarUrl } from '../users/user.mapper.js';
import { UsersService } from '../users/users.service.js';
import { teamStats } from '../teams/team-stats.js';

const notFoundTeam = () => new AppError(404, 'Team not found.', 'TEAM_NOT_FOUND');
const notFoundPlayer = () => new AppError(404, 'Player profile not found.', 'PLAYER_NOT_FOUND');

/**
 * Gate 9 / TKT-910 (CEO guest browsing): the read-only views anyone can open without an account.
 * Each one is built from an explicit list of guest-safe fields: never an email address, date of
 * birth, chat, message, friends list, wallet or payment data, or any venue cost.
 */
export class PublicBrowseService {
  constructor(
    private readonly users = new UsersService(),
    private readonly reviews = new TeamReviewsService(),
  ) {}

  async team(teamId: string): Promise<PublicTeamView> {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true, name: true, shortName: true, profileImageUrl: true, primaryFormat: true, locationText: true, description: true,
        primaryColor: true, secondaryColor: true, archivedAt: true,
        memberships: {
          orderBy: { joinedAt: 'asc' },
          select: {
            role: true,
            user: {
              select: {
                id: true, username: true, accountStatus: true,
                profile: { select: { displayName: true, avatarUrl: true, photo: { select: { hiddenAt: true } }, preferredPositions: { orderBy: { sortOrder: 'asc' }, select: { position: true } } } },
              },
            },
          },
        },
      },
    });
    if (!team) throw notFoundTeam();
    // CEO touch-up batch 4, item 2: the same statistics members see (D6).
    const [stats, reviews] = await Promise.all([teamStats(teamId), this.reviews.teamSummary(teamId)]);
    return {
      id: team.id,
      name: team.name,
      shortName: team.shortName,
      profileImageUrl: team.profileImageUrl,
      primaryFormat: team.primaryFormat,
      locationText: team.locationText,
      description: team.description,
      primaryColor: team.primaryColor,
      secondaryColor: team.secondaryColor,
      closed: Boolean(team.archivedAt),
      members: team.memberships
        .filter(({ user }) => user.accountStatus === 'ACTIVE')
        .map(({ role, user }) => ({
          userId: user.id,
          username: user.username,
          displayName: user.profile?.displayName ?? user.username,
          avatarUrl: playerAvatarUrl(user.id, user.profile),
          role,
          positions: user.profile?.preferredPositions.map(({ position }) => position) ?? [],
        })),
      stats,
      reviews: { enoughReviews: reviews.enoughReviews, averageRating: reviews.averageRating, reviewCount: reviews.reviewCount },
    };
  }

  /** The guest profile: display name, username, photo, positions, city, bio, teams and stats only. */
  async player(userId: string): Promise<GuestPlayerProfile> {
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { accountStatus: true, onboardingCompletedAt: true } });
    if (!account || account.accountStatus !== 'ACTIVE' || !account.onboardingCompletedAt) throw notFoundPlayer();
    const profile = await this.users.get(userId);
    return {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      preferredPositions: profile.preferredPositions,
      city: profile.city?.name ?? null,
      teams: profile.teams ?? [],
      statistics: profile.statistics,
    };
  }
}
