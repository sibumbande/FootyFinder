import type { AccountStatus } from '../../generated/prisma/client.js';
import { DELETED_PLAYER_NAME, type AuthenticatedUser, type FootballPosition, type PublicUser } from '@footy-finder/shared';
import { isHiddenAccount } from './hidden-account.js';
import { env } from '../../config/env.js';

type SafeUserSource = {
  id: string;
  email: string;
  username: string;
  accountStatus?: AccountStatus;
  platformRole?: 'USER' | 'ADMIN';
  /** Active referee grants only (safeUserInclude filters revokedAt null). */
  refereeGrants?: Array<{ id: string }>;
  emailVerifiedAt?: Date | null;
  emailVerificationRequired?: boolean;
  onboardingCompletedAt?: Date | null;
  createdAt: Date;
  profile?: {
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    dominantFoot: 'LEFT' | 'RIGHT' | 'BOTH' | null;
    homeArea: string | null;
    dateOfBirth?: Date | null;
    gender?: 'MALE' | 'FEMALE' | null;
    yearsExperience?: number | null;
    onboardingStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';
    city?: {
      id: string;
      code: string;
      name: string;
      countryCode: string;
      timezone: string;
      supportStatus: 'ACTIVE' | 'WAITLIST';
    } | null;
    photo?: { hiddenAt: Date | null } | null;
    createdAt: Date;
    updatedAt: Date;
    preferredPositions: Array<{ position: FootballPosition }>;
  } | null;
  walletAccount?: { balanceCents: number; currency: string } | null;
  teamMemberships?: Array<{
    role: 'OWNER' | 'CAPTAIN' | 'MEMBER';
    team: {
      id: string;
      name: string;
      shortName: string | null;
      profileImageUrl: string | null;
    };
  }>;
};

/** The player photo proxy URL, or null while an admin has hidden the photo. */
export const playerAvatarUrl = (
  userId: string,
  profile: { avatarUrl: string | null; photo?: { hiddenAt: Date | null } | null } | null | undefined,
) =>
  profile?.photo
    ? profile.photo.hiddenAt
      ? null
      : `${env.PUBLIC_API_URL.replace(/\/$/, '')}/players/${userId}/photo`
    : profile?.avatarUrl;

/** CEO batch 5: how a hidden (deleting or deleted) account appears anywhere it is still referenced. */
export const deletedPublicUser = (id: string, createdAt: Date): PublicUser => ({
  id,
  userId: id,
  username: '',
  displayName: DELETED_PLAYER_NAME,
  avatarUrl: null,
  bio: null,
  preferredPositions: [],
  dominantFoot: null,
  homeArea: null,
  yearsExperience: null,
  city: null,
  createdAt: createdAt.toISOString(),
  updatedAt: createdAt.toISOString(),
  teams: [],
  deleted: true,
});

export function toPublicUser(user: SafeUserSource): PublicUser {
  if (isHiddenAccount(user.accountStatus)) return deletedPublicUser(user.id, user.createdAt);
  const profile = user.profile;
  const avatarUrl = playerAvatarUrl(user.id, profile);
  return {
    id: user.id,
    userId: user.id,
    username: user.username,
    displayName: profile?.displayName ?? user.username,
    avatarUrl,
    bio: profile?.bio,
    preferredPositions: profile?.preferredPositions.map(({ position }) => position) ?? [],
    dominantFoot: profile?.dominantFoot,
    homeArea: profile?.homeArea,
    yearsExperience: profile?.yearsExperience,
    city: profile?.city,
    createdAt: (profile?.createdAt ?? user.createdAt).toISOString(),
    updatedAt: (profile?.updatedAt ?? user.createdAt).toISOString(),
    teams: user.teamMemberships?.map(({ role, team }) => ({
      id: team.id,
      name: team.name,
      shortName: team.shortName,
      profileImageUrl: team.profileImageUrl,
      role,
    })),
  };
}

export function toAuthenticatedUser(user: SafeUserSource): AuthenticatedUser {
  const profile = user.profile;
  const missingOnboardingRequirements = [
    ...(user.emailVerificationRequired !== false && !user.emailVerifiedAt ? ['EMAIL_VERIFICATION'] : []),
    ...(!profile?.dateOfBirth ? ['DATE_OF_BIRTH'] : []),
    ...(!profile?.gender ? ['GENDER'] : []),
    ...(profile?.yearsExperience === null || profile?.yearsExperience === undefined
      ? ['EXPERIENCE']
      : []),
    ...(!profile?.city || profile.city.supportStatus !== 'ACTIVE' ? ['CITY'] : []),
    ...(!profile?.preferredPositions.length ? ['POSITIONS'] : []),
    ...(!profile?.photo || profile.photo.hiddenAt ? ['PHOTO'] : []),
    ...(!user.onboardingCompletedAt ? ['LEGAL_ACCEPTANCE'] : []),
  ];
  return {
    ...toPublicUser(user),
    email: user.email,
    balanceCents: user.walletAccount?.balanceCents ?? 0,
    currency: user.walletAccount?.currency === 'ZAR' ? 'ZAR' : 'ZAR',
    accountStatus: user.accountStatus ?? 'ACTIVE',
    platformRole: user.platformRole ?? 'USER',
    isReferee: Boolean(user.refereeGrants?.length),
    emailVerified: Boolean(user.emailVerifiedAt),
    emailVerificationRequired: user.emailVerificationRequired ?? true,
    onboardingStatus: profile?.onboardingStatus ?? 'NOT_STARTED',
    onboardingComplete: Boolean(user.onboardingCompletedAt),
    dateOfBirth: profile?.dateOfBirth?.toISOString().slice(0, 10) ?? null,
    // CEO touch-up batch 4, item 1: the player's own gender, only in their own account data.
    gender: profile?.gender ?? null,
    missingOnboardingRequirements,
  };
}
