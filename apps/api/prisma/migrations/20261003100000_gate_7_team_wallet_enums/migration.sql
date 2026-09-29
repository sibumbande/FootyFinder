-- Gate 7 / TKT-701: personal-ledger kinds for money moving between a player's wallet and a
-- Team Wallet (DEC-014, DEC-019). Enum values are added in their own migration so they are
-- committed before 20261003110000_gate_7_team_wallet refers to them in a CHECK. Additive only.
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'TEAM_CONTRIBUTION_DEBIT';
ALTER TYPE "WalletTransactionType" ADD VALUE IF NOT EXISTS 'TEAM_CONTRIBUTION_REFUND_CREDIT';
