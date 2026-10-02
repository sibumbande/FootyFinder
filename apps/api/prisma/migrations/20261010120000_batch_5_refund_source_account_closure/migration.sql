-- CEO batch 5, item 3: refunds started by the final step of a self-service account deletion (ToS 20.2) are
-- recorded with their own source, so finance can tell them from admin refunds and player undos. They run
-- through the same Gate 6 refund path (wallet debited first; NEEDS_ATTENTION and FAILED stay for finance).
-- Enum value only. Additive only.
ALTER TYPE "RefundSource" ADD VALUE IF NOT EXISTS 'ACCOUNT_CLOSURE';
