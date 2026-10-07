import type { PaymentChannel } from '@footy-finder/shared';
import type { ProviderPayment } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import type { PaystackVerifiedTransaction } from './paystack.client.js';

export type SettlementSource = 'webhook' | 'expiry_job' | 'status_check';

export type VerificationOutcome =
  | { kind: 'CREDIT' }
  | { kind: 'FAIL'; reason: string }
  | { kind: 'WAIT' }
  | { kind: 'REVIEW'; reason: string };

type PaymentFacts = Pick<ProviderPayment, 'id' | 'userId' | 'reference' | 'amountCents' | 'createdAt'>;

/**
 * Decides what a Paystack verify result means for one payment (TKT-604; DEC-021 match ticket payments). CREDIT (the
 * payment counts) needs every fact to match our own record: status success, same reference, exact amount, ZAR, an
 * offered channel, and (when present) the metadata we sent at initialisation.
 */
export function evaluateVerification(
  payment: PaymentFacts,
  verified: PaystackVerifiedTransaction | null,
  options: { finalAttempt: boolean; channels?: readonly PaymentChannel[]; anyChannel?: boolean },
): VerificationOutcome {
  if (!verified) return options.finalAttempt ? { kind: 'FAIL', reason: 'not_found_at_provider' } : { kind: 'WAIT' };
  if (verified.reference !== payment.reference) return { kind: 'REVIEW', reason: 'reference_mismatch' };
  if (verified.status === 'success') {
    if (verified.amountCents !== payment.amountCents) return { kind: 'REVIEW', reason: 'amount_mismatch' };
    if (verified.currency !== 'ZAR') return { kind: 'REVIEW', reason: 'currency_mismatch' };
    // CEO touch-up batch 4, item 3 (D7): only a channel FootyFinder offers (PAYSTACK_CHANNELS) is credited. A PayFast
    // payment has no Paystack channel: its methods (card, Instant EFT) are set in the PayFast dashboard (anyChannel).
    if (!options.anyChannel && (!verified.channel || !(options.channels ?? env.PAYSTACK_CHANNELS).includes(verified.channel as PaymentChannel)))
      return { kind: 'REVIEW', reason: 'channel_not_offered' };
    const { providerPaymentId, userId } = verified.metadata;
    if (providerPaymentId !== undefined && providerPaymentId !== payment.id)
      return { kind: 'REVIEW', reason: 'metadata_payment_mismatch' };
    if (userId !== undefined && userId !== payment.userId) return { kind: 'REVIEW', reason: 'metadata_user_mismatch' };
    return { kind: 'CREDIT' };
  }
  if (verified.status === 'failed' || verified.status === 'reversed') return { kind: 'FAIL', reason: verified.status };
  if (options.finalAttempt)
    return verified.status === 'abandoned'
      ? { kind: 'FAIL', reason: 'abandoned' }
      : { kind: 'REVIEW', reason: `still_${verified.status || 'unknown'}_after_max_age` };
  return { kind: 'WAIT' };
}
