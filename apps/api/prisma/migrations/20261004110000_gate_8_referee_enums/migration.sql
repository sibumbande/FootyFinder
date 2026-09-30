-- Gate 8 / TKT-802 (DEC-020): referee assignment notices and admin alerts.
-- Enum values in their own migration as usual (ADD VALUE cannot share a transaction with their use).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFEREE_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REFEREE_UNASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ADMIN_ALERT';
CREATE TYPE "RefereeAssignmentAction" AS ENUM ('ASSIGNED', 'AUTO_ASSIGNED', 'REMOVED', 'DECLINED', 'ROLE_REVOKED');
