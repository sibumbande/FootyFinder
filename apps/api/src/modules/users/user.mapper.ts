import type { AuthenticatedUser, PublicUser } from '@footy-finder/shared';

type SafeUserSource = {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  balanceCents: number;
  createdAt: Date;
};

export function toPublicUser(user: SafeUserSource): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toAuthenticatedUser(user: SafeUserSource): AuthenticatedUser {
  return { ...toPublicUser(user), balanceCents: user.balanceCents };
}
