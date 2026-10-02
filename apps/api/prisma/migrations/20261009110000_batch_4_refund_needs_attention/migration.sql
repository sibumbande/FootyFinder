-- CEO touch-up batch 4, item 3 (D8): a refund of a bank payment (Instant EFT, Capitec Pay) that Paystack cannot
-- complete until it has the customer's bank account. Finance adds the details (sent to Paystack, never stored) or
-- returns the money to the wallet. Additive: a new enum value only.
ALTER TYPE "ProviderRefundStatus" ADD VALUE IF NOT EXISTS 'NEEDS_ATTENTION';
