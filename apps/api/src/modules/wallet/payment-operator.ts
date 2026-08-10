export type PaymentResult =
  | { status: 'success'; providerReference: string }
  | { status: 'failure'; message: string; providerReference?: string }
  | { status: 'error'; message: string; providerReference?: string };

export interface DepositRequest {
  amountCents: number;
  currency: 'ZAR';
  customerId: string;
  idempotencyKey: string;
}

export interface PaymentOperator {
  readonly name: string;
  deposit(request: DepositRequest): Promise<PaymentResult>;
}
