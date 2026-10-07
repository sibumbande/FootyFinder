import { PayfastClient, PayfastError } from './payfast.client.js';
import { PaystackError, type PaystackGateway } from './paystack.client.js';

/** Every card provider fits the gateway shape Paystack defined: initialize, verify, refund. */
export type PaymentGateway = PaystackGateway;

/** Picks the gateway for a payment by the provider recorded on it, never by today's PAYMENT_PROVIDER. */
export type GatewayResolver = (provider: string) => PaymentGateway;

let payfast: PayfastClient | undefined;
const defaultPayfast = () => (payfast ??= new PayfastClient());

/**
 * A payment is always verified and refunded through the provider it was made with: a Paystack payment stays with
 * Paystack after a switch to PayFast, and the other way round. `paystack` is the gateway services were given (tests
 * and smokes pass a fake one).
 */
export const gatewayResolver =
  (paystack: PaymentGateway, payfastGateway: () => PaymentGateway = defaultPayfast): GatewayResolver =>
  (provider) =>
    provider === 'payfast' ? payfastGateway() : paystack;

/** The provider's error code (never its message, which can echo request data), or undefined for other errors. */
export const providerErrorCode = (error: unknown) => (error instanceof PaystackError || error instanceof PayfastError ? error.code : undefined);

/** The provider has no record of the payment yet (Paystack 404, or no validated PayFast ITN). */
export const isProviderNotFound = (error: unknown) => {
  const code = providerErrorCode(error);
  return code === 'PAYSTACK_NOT_FOUND' || code === 'PAYFAST_NOT_FOUND';
};
