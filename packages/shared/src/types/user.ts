export const FOOTBALL_POSITIONS = ['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD'] as const;
export type FootballPosition = (typeof FOOTBALL_POSITIONS)[number];
export const DOMINANT_FEET = ['LEFT', 'RIGHT', 'BOTH'] as const;
export type DominantFoot = (typeof DOMINANT_FEET)[number];

export interface PublicPlayerProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  preferredPositions: FootballPosition[];
  dominantFoot?: DominantFoot | null;
  homeArea?: string | null;
  createdAt: string;
  updatedAt: string;
  teams?: Array<{
    id: string;
    name: string;
    shortName?: string | null;
    profileImageUrl?: string | null;
    role: 'OWNER' | 'CAPTAIN' | 'MEMBER';
  }>;
}

/** Public football identity. It intentionally contains no contact or billing data. */
export interface PublicUser extends PublicPlayerProfile {
  id: string;
}

export interface AuthenticatedUser extends PublicUser {
  email: string;
  balanceCents: number;
  currency: 'ZAR';
}

/** Internal database-only account shape. Never return this from the API. */
export interface DatabaseUser {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}
