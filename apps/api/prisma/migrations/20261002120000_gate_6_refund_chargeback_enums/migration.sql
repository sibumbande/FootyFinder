-- Gate 6 / TKT-606: new ledger and notification kinds for card refunds and chargebacks.
-- Enum values are added in their own migration so they are committed before the constraints in
-- 20261002130000_gate_6_refunds_chargebacks refer to them. Additive only.
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'TOP_UP_REFUND_DEBIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'TOP_UP_REFUND_RESTORE_CREDIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'CHARGEBACK_DEBIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'CHARGEBACK_REVERSAL_CREDIT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WALLET_DEBIT';
