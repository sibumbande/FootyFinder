import type { AuthenticatedUser, FootballPosition, PublicUser } from '@footy-finder/shared';

type SafeUserSource = {
  id: string;
  email: string;
  username: string;
  accountStatus?: 'ACTIVE' | 'SUSPENDED' | 'BANNED';
  createdAt: Date;
  profile?: {
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    dominantFoot: 'LEFT' | 'RIGHT' | 'BOTH' | null;
    homeArea: string | null;
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

export function toPublicUser(user: SafeUserSource): PublicUser {
  const profile = user.profile;
  return {
    id: user.id,
    userId: user.id,
    username: user.username,
    displayName: profile?.displayName ?? user.username,
    avatarUrl: profile?.avatarUrl,
    bio: profile?.bio,
    preferredPositions: profile?.preferredPositions.map(({ position }) => position) ?? [],
    dominantFoot: profile?.dominantFoot,
    homeArea: profile?.homeArea,
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
  return {
    ...toPublicUser(user),
    email: user.email,
    balanceCents: user.walletAccount?.balanceCents ?? 0,
    currency: user.walletAccount?.currency === 'ZAR' ? 'ZAR' : 'ZAR',
    accountStatus: user.accountStatus ?? 'ACTIVE',
  };
}
