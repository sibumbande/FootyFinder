import type { PaymentOperator } from './payment-operator.js';

export class DemoPaymentOperator implements PaymentOperator {
  readonly name = 'demo';

  async deposit(request: Parameters<PaymentOperator['deposit']>[0]) {
    return { status: 'success' as const, providerReference: `demo-${request.idempotencyKey}` };
  }
}
