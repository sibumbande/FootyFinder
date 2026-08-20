export const NOTIFICATION_TYPES = [
  'INFO',
  'DIRECT_MESSAGE',
  'MATCH_INVITATION',
  'DEPOSIT_SUCCEEDED',
  'MATCH_JOINED',
  'PLAYER_CANCELLED',
  'REPLACEMENT_FOUND',
  'WALLET_CREDIT',
  'MATCH_CANCELLED',
  'MATCH_STARTED',
  'RESULT_SUBMITTED',
  'TEAM_MEMBER_JOINED',
  'TEAM_UPDATED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  targetPath?: string | null;
  readAt?: string | null;
  createdAt: string;
}
