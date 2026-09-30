-- Gate 7 / TKT-710/711: in-app notice for unread team chat (one per member until they read it).
-- Enum value in its own migration as usual. Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_CHAT_UNREAD';
