-- Gate 9 / TKT-909: team recruitment board, join requests and their reports and notices. Enum
-- values in their own migration as usual. Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_JOIN_REQUEST_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_JOIN_REQUEST_ANSWERED';
ALTER TYPE "ModerationReportTargetType" ADD VALUE IF NOT EXISTS 'RECRUITMENT_POST';
ALTER TYPE "ModerationReportTargetType" ADD VALUE IF NOT EXISTS 'LOOKING_CARD';
CREATE TYPE "RecruitmentLevel" AS ENUM ('CASUAL', 'COMPETITIVE');
CREATE TYPE "TimeOfDay" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');
CREATE TYPE "RecruitmentPostStatus" AS ENUM ('OPEN', 'CLOSED', 'REMOVED');
CREATE TYPE "TeamJoinRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'EXPIRED');
