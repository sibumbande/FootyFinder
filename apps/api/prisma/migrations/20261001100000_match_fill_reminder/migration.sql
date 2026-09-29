-- TKT-319: "not full yet" reminder before the DEC-018 T-30 go/no-go check. Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MATCH_FILL_REMINDER';
