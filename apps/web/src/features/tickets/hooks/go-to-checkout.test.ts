import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutNavigation, goToCheckout, isPayfastCheckoutUrl, isPaystackCheckoutUrl } from './useTickets.js';

afterEach(() => vi.restoreAllMocks());

describe('goToCheckout (DEC-021: Paystack, or PayFast)', () => {
  it('sends a Paystack checkout as a plain redirect', () => {
    const go = vi.spyOn(checkoutNavigation, 'go').mockImplementation(() => undefined);
    goToCheckout('https://checkout.paystack.com/abc');
    expect(go).toHaveBeenCalledWith('https://checkout.paystack.com/abc');
  });

  it('posts PayFast\'s signed form with the fields exactly as the server signed them, in order', () => {
    const post = vi.spyOn(checkoutNavigation, 'post').mockImplementation(() => undefined);
    goToCheckout('https://sandbox.payfast.co.za/eng/process?merchant_id=10000100&return_url=http%3A%2F%2Flocalhost%3A5173%2Ftickets%2Freturn%3Freference%3Dff_ticket_1&item_name=FootyFinder+match+ticket&signature=abc');
    expect(post).toHaveBeenCalledWith('https://sandbox.payfast.co.za/eng/process', [
      ['merchant_id', '10000100'],
      ['return_url', 'http://localhost:5173/tickets/return?reference=ff_ticket_1'],
      ['item_name', 'FootyFinder match ticket'],
      ['signature', 'abc'],
    ]);
  });

  it('refuses any other address', () => {
    const go = vi.spyOn(checkoutNavigation, 'go').mockImplementation(() => undefined);
    const post = vi.spyOn(checkoutNavigation, 'post').mockImplementation(() => undefined);
    for (const url of ['https://evil.example/eng/process', 'https://sandbox.payfast.co.za.evil.example/eng/process', 'http://www.payfast.co.za/eng/process', 'https://www.payfast.co.za/other'])
      expect(() => goToCheckout(url)).toThrow('Checkout could not be started');
    expect(go).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(isPayfastCheckoutUrl('https://www.payfast.co.za/eng/process?a=1')).toBe(true);
    expect(isPaystackCheckoutUrl('https://www.payfast.co.za/eng/process')).toBe(false);
  });
});
