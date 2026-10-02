-- DEC-021 Match Ticketing (batch 5 brief, Part A). Enum values only, in their own migration so they are committed
-- before any statement uses them. Additive only.
--   RefundSource: why a ticket (or a credit that came from one) is refunded to the original payment method.
--   NotificationType: the in-app notices ticketing adds (choose credit or refund, a refund needs attention,
--   the team payment deadline, a payment dispute).
ALTER TYPE "RefundSource" ADD VALUE IF NOT EXISTS 'TICKET_LEFT';
ALTER TYPE "RefundSource" ADD VALUE IF NOT EXISTS 'MATCH_CANCELLED';
ALTER TYPE "RefundSource" ADD VALUE IF NOT EXISTS 'CHOICE_TIMEOUT';
ALTER TYPE "RefundSource" ADD VALUE IF NOT EXISTS 'LATE_PAYMENT';
ALTER TYPE "RefundSource" ADD VALUE IF NOT EXISTS 'DUPLICATE_PAYMENT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_CHOICE_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET_REFUND_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_PAYMENT_DUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_DISPUTE_OPENED';
