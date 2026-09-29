-- Gate 7 / TKT-706: in-app notification kinds for DEC-019 team matches (opponent found, no
-- opponent yet, opponent withdrew, fill-meter reminder). Enum values only, in their own
-- migration as usual. Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_MATCH_OPPONENT_FOUND';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_MATCH_NO_OPPONENT_WARNING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_MATCH_OPPONENT_WITHDRAWN';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_METER_REMINDER';
