export interface PublicUser {
  id: string;
  email: string;
  username: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
}

export interface AuthenticatedUser extends PublicUser {
  balanceCents: number;
}

/** Internal database-only user shape. Never return this from the API. */
export interface DatabaseUser {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  balanceCents: number;
  createdAt: Date;
  updatedAt: Date;
}
