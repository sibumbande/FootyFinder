-- Gate 9 / TKT-904: personal team invites and their in-app notices. Enum values in their own
-- migration as usual. Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_INVITE_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_INVITE_ANSWERED';
CREATE TYPE "TeamMemberInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "TeamMemberInviteSource" AS ENUM ('FRIEND', 'LOOKING');
