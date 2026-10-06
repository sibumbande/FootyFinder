/** DEC-018: platform-fixed Quick Match place fee (R80), paid by every joined player including subs. */
export const MATCH_FEE_CENTS = 8_000;

/**
 * CEO touch-up batch 4, item 3 (D7): the Paystack checkout channels FootyFinder can offer, by Paystack's own codes.
 * Which ones are switched on is a server setting (PAYSTACK_CHANNELS); checkout shows exactly those. QR, USSD and
 * the rest are never offered.
 */
export const PAYMENT_CHANNELS = ['card', 'apple_pay', 'capitec_pay', 'eft'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];
export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  card: 'Card',
  apple_pay: 'Apple Pay',
  capitec_pay: 'Capitec Pay',
  eft: 'Instant EFT',
};
/** The player-facing name of a Paystack channel (unknown channels are shown as they are). */
export const paymentChannelLabel = (channel: string | null | undefined) =>
  channel ? (PAYMENT_CHANNEL_LABELS[channel as PaymentChannel] ?? channel) : null;

/**
 * TKT-606 / DEC-021 A7: the state of a refund to the original payment method. A failed refund stays FAILED (or
 * NEEDS_ATTENTION for a bank payment) for finance; it never silently becomes a match credit. RESTORED_TO_WALLET is
 * kept only for earlier payment records from before DEC-021.
 */
export type CardRefundState = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'RESTORED_TO_WALLET' | 'NEEDS_ATTENTION';
