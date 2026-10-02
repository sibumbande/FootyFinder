# Gate 6 runbook: personal payments (Paystack) and venue settlement

Tickets TKT-601 to TKT-609, implemented 2026-09-29 on `ceo/finish-gate-5`, one commit per ticket.
Decisions: DEC-011 (Paystack personal payments), DEC-012 (weekly dual-control venue settlement), DEC-018 (a venue is owed money only for a match that went ahead), and the CEO's Gate 6 decisions D1–D12 recorded in the ticket breakdown (section 10).

## What players get

- **Wallet page.** Open it from the avatar menu → Wallet, or click the header balance. It shows:
  - balance, available and on-hold amounts;
  - paginated history in plain words;
  - a link to the match for match-related rows;
  - card-refund and chargeback states.
- **Top-ups.**
  - Amount: whole rands, R50 to R5,000. Quick picks are R80, R160 (default), R240 and R400, plus a custom amount.
  - Payment: card only, through Paystack hosted checkout. FootyFinder pays the fees.
  - No withdrawals.
  - The wallet is credited only after our server confirms the payment with Paystack (see "How a top-up is credited").
- **Not enough balance to join.** The join dialog links to the wallet with the shortfall (at least R50) and a way back to the match. The old fixed "Add R500" button is gone.
- **Restricted spending.** A chargeback pauses spending (notice on the wallet page). The pause lifts automatically once the wallet is back at or above zero and no dispute is open.

## How a top-up is credited (single credit path)

1. `POST /wallet/top-ups` (with an `Idempotency-Key`, per user) atomically creates a PENDING `DEPOSIT_CREDIT` ledger row and a `ProviderPayment`, then calls Paystack `transaction/initialize` with:
   - `channels` exactly as configured in `PAYSTACK_CHANNELS` (CEO batch 4, item 3; default `card`) and `currency: 'ZAR'`;
   - our reference `ff_topup_<32 hex>`;
   - metadata `{ providerPaymentId, userId }`;
   - `callback_url = CLIENT_URL/wallet/top-up/return`.

   Only one concurrent request calls Paystack. The player is sent to `checkout.paystack.com`; any other host is refused.
2. **The browser never credits anything.** The return page only asks `GET /wallet/top-ups/:reference` for the status.
3. Three sources can settle a top-up, and all of them call `TopUpSettlementService.settleFromVerify`:
   - the signed webhook;
   - the `PAYSTACK_TOP_UP_EXPIRE` job (hourly, then closed after 24 h);
   - the player's status check (at most every 5 s per top-up).

   `settleFromVerify` calls Paystack `transaction/verify` from our server and credits only when all of these hold:
   - status is `success`;
   - the amount is exactly equal;
   - the currency is ZAR;
   - the channel is one of `PAYSTACK_CHANNELS` (anything else, such as QR, goes to REVIEW as `channel_not_offered`);
   - the reference and metadata match.

   The credit happens under the `ProviderPayment` row lock in a serializable transaction, through the idempotent PENDING → SUCCEEDED ledger transition. However the three sources interleave, a top-up is credited once. `smoke:payments` proves webhook→verify, verify→webhook and all three at once.
4. **REVIEW, never an automatic credit:** any mismatch, and a success reported after we closed the top-up.

## Paystack dashboard (TEST mode): what to set, and when

| Setting | Value | When |
| --- | --- | --- |
| Test Callback URL | `http://localhost:5173/wallet/top-up/return` | Any time. We also send it with every transaction. |
| Test Webhook URL | `https://<your-tunnel-host>/payments/paystack/webhook` | Only while a tunnel runs for a manual card test. Clear it afterwards. |
| IP whitelist | Leave **empty** in TEST | This limits which server IPs may call Paystack with your secret key. A home IP changes. In LIVE, set the production server's egress IP(s). |

The webhook can optionally be restricted to Paystack's source IPs with `PAYSTACK_WEBHOOK_IP_ALLOWLIST` (comma-separated). Take the current list from Paystack's webhook documentation when going live. The HMAC signature is always checked either way.

## Local card test with a real webhook (optional)

Automated tests do not need this: they use a local fake Paystack and signed synthetic webhooks. To try a real TEST card payment end to end:

1. In `apps/api/.env`:
   - set `PAYMENT_PROVIDER=paystack`;
   - keep your `sk_test_…` / `pk_test_…` keys (outside production the API refuses anything else).
2. Start the API and web app (`npm run dev:api`, `npm run dev:web`).
3. Install a tunnel once: `winget install --id Cloudflare.cloudflared`.
4. Run `cloudflared tunnel --url http://localhost:3000`. Copy the `https://….trycloudflare.com` address it prints.
5. In the Paystack dashboard (Test mode) → Settings → API Keys & Webhooks, set Test Webhook URL to `https://….trycloudflare.com/payments/paystack/webhook`.
6. In the web app go to Wallet → pick an amount → Pay. On Paystack's page, use a Paystack **test card** (from Paystack's "Test payments" documentation).
7. You return to `/wallet/top-up/return`. The wallet is credited once the webhook arrives, or at the latest on the next status check. The admin Finance page shows the top-up with "credited by webhook".
8. Stop the tunnel (Ctrl+C) and **clear the Test Webhook URL**. The quick-tunnel address changes every run and exposes your local API while it runs.

`npm run smoke:paystack-sandbox --workspace=@footy-finder/api` checks the real TEST API without a card:
- it initialises a card-only ZAR checkout;
- it verifies that checkout is not paid;
- it checks the signature logic.

It never prints the key and refuses anything but a test key.

## Refunds and chargebacks (admin Finance page)

- **Refund to card.** Admin only, **fresh MFA** (CEO batch 3, D9), with a reason, only on a credited top-up without a dispute, and only up to unspent credit. Partial amounts are allowed.
- **Player "Undo top-up" (CEO batch 3, item 6b; ToS 13.5).** Within 24 hours of the credit (`verifiedAt`), once per top-up (`ProviderRefund.source = PLAYER_UNDO`, partial unique index), the player refunds up to: top-up − earlier refunds − net spending since the top-up, capped at the available balance (D7). Not while the wallet is restricted or the payment is disputed. It runs through the same path below (debit first, then Paystack), so a failed refund stays FAILED for finance. The top-up form also asks "You're adding R800 to your wallet. Correct?" with an extra warning from R500. Smoke: `npm run smoke:top-up-undo` (includes a double-submit race).
  1. The wallet is debited at initiation (`TOP_UP_REFUND_DEBIT`).
  2. Paystack `/refund` is called.
  3. `refund.*` webhooks move it to PROCESSING, PROCESSED or FAILED.
- **Refunds by payment method (CEO batch 4, item 3, D8).**
  - Card and Apple Pay: refunded back automatically. These are the only top-ups the player can undo in the app.
  - Capitec Pay and Instant EFT: the player contacts support; finance refunds them from the admin Finance page. If Paystack did not receive the customer's bank account, the refund comes back as **needs attention** (status `NEEDS_ATTENTION`, the player is told support will contact them). Support asks the player for their bank and account number; finance enters them in the "Needs the player's bank details" form (fresh MFA). They go to Paystack's `refund/retry_with_customer_details` only. FootyFinder never stores the account number; the audit entry `TOP_UP_REFUND_BANK_DETAILS_SENT` keeps the bank name and the last 4 digits. Finance can instead return the money to the wallet with a reason.
  - Account closure (ToS 20.2) is a support process using the same admin refund, so it works for every method.
  - Chargebacks are matched by payment reference, whatever the method.
  - Wallet history shows how each top-up was paid ("Paid with Capitec Pay") and where a refund goes ("Back to Capitec Pay").
  - Smoke: `npm run smoke:payment-methods`.
- **Failed refund (D3).** It stays FAILED and is flagged in reconciliation. It is never re-credited automatically. Finance either:
  - **retries it**, after first checking the Paystack dashboard that a timed-out attempt was not in fact processed; or
  - **returns it to the wallet**, with a written reason (audited).

  If Paystack later reports a card refund that was already returned to the wallet, it is flagged `processed_after_restore` so finance can recover the money.
- **Chargeback (D2).**
  - `charge.dispute.create` reverses the disputed amount (`CHARGEBACK_DEBIT`), even below zero, and restricts spending.
  - A resolution of `declined` (merchant won) restores it (`CHARGEBACK_REVERSAL_CREDIT`).
  - An `accepted` resolution leaves the reversal in place.
  - An admin may lift a restriction on a wallet that is not below zero (audited, with reason).
- The database allows a negative balance **only** while spending is restricted.

## Venue settlement (admin "Venue settlement" page)

- **Payable (D1, D4).** Created in the same transaction that starts a confirmed go/no-go Quick Match at kickoff:
  - exactly one per reservation;
  - equal to the admin-only `priceCentsSnapshot`;
  - status DUE.

  No payable is ever created for a T-30 auto-cancelled or host-cancelled match (it never kicks off), nor for a legacy match without go/no-go. Legacy matches are listed in reconciliation as `LEGACY_RESERVATION_UNSETTLED`. A database trigger refuses any ineligible payable.
- **Bank details (D8).**
  - Encrypted at rest (AES-256-GCM bound to the row id, key `VENUE_BENEFICIARY_ENCRYPTION_KEY`).
  - Shown masked (last 4 digits).
  - A different admin must approve new details before they can be paid.
  - "Reveal for payment" is audited and never cached.
  - Never in player or host APIs, or in logs.
  - **Use only fake details outside production.**
- **Weekly batch (D9, D10).** Monday–Monday in Johannesburg time, once the week has ended.
  1. Admin P prepares it.
  2. A different admin approves it.
  3. After making the EFT, an admin other than P marks it paid with the payout reference and evidence.

  Approve and mark-paid also need an MFA verification from the last 15 minutes. A batch can be cancelled before it is paid; that returns its payables to the queue. Once paid, a batch and its payables cannot change (database trigger).
- **Adjustments.** Reasoned and audited. On an unpaid payable they may not take it below zero. On a paid payable they carry into the venue's next batch.

## Configuration (names only; never commit values)

| Variable | Notes |
| --- | --- |
| `PAYMENT_PROVIDER` | `demo` (development/test only; credits instantly) or `paystack`. Production must be `paystack`. |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` | `sk_test_`/`pk_test_` outside production, `sk_live_`/`pk_live_` only in production. Owned by Platform Operations. Error messages never echo them. |
| `PAYSTACK_BASE_URL` | Pinned to `https://api.paystack.co` in production. |
| `PAYSTACK_CHANNELS` | CEO batch 4, item 3. Comma-separated Paystack channel codes checkout offers, exactly: `card`, `apple_pay`, `capitec_pay`, `eft` (Instant EFT through Ozow). Default `card`. Any other value (`qr`, `ussd`, `bank_transfer`, …) stops the API from starting. A payment through a channel not listed goes to REVIEW. |
| `PAYSTACK_WEBHOOK_IP_ALLOWLIST` | Optional, comma-separated. |
| `TOP_UP_PENDING_EXPIRY_MINUTES`, `TOP_UP_MAX_PENDING_HOURS` | Default 60 and 24. |
| `VENUE_BENEFICIARY_ENCRYPTION_KEY` | Required in production and must differ from `ADMIN_MFA_ENCRYPTION_KEY`. Losing it makes stored bank details unreadable. |
| `ADMIN_SETTLEMENT_MFA_MAX_AGE_MINUTES` | Default 15. |

`apps/api/.env` is git-ignored (`.gitignore`: `.env`).

## Migrations (additive, hand-written)

| Migration | Adds |
| --- | --- |
| `20261002100000_gate_6_provider_payments` | `ProviderPayment`. |
| `20261002110000_gate_6_payment_webhooks` | `PaymentWebhookEvent`. |
| `20261002120000_gate_6_refund_chargeback_enums` | Enum values only (committed before use). |
| `20261002130000_gate_6_refunds_chargebacks` | `ProviderRefund`, `ProviderDispute`, the wallet restriction. Widens the non-negative-balance and ledger-sign CHECKs. |
| `20261002140000_gate_6_venue_payables` | Beneficiary, payable and adjustment tables, plus the eligibility trigger. |
| `20261002150000_gate_6_settlement_batches` | Batches, dual-control CHECKs, paid-immutability triggers. |
| `20261009110000_batch_4_refund_needs_attention` | CEO batch 4: the `NEEDS_ATTENTION` refund status (enum value only). |

No index uses a function; the partial unique indexes use plain `WHERE` predicates.

## Verification

Run on disposable `footy_finder_test` only (see `docs/TEST_DATABASE.md`); results for this gate are in the ticket breakdown, section 10:
- `smoke:payments`
- `smoke:venue-settlement`
- `smoke:payment-to-settlement` (end to end, including injected-inconsistency detection)
- `smoke:paystack-sandbox`
- `smoke:financial-integrity`
- `smoke:go-no-go`
- the Playwright `wallet.spec.ts`

- **Privacy.** `venue-cost-privacy.test.ts` checks the wallet, top-up, payable and beneficiary DTOs. Player/host money DTOs are scanned for venue-only keys and the fixture amounts, with a negative control.
- **Retained test records (by design).** Paid settlement batches and the admin audit log are immutable, so the settlement smokes leave their paid match, venue, host and admin accounts in the disposable test database, tagged with the smoke marker.

## Before going live

- Platform Operations:
  - live Paystack keys and a live webhook URL;
  - the IP whitelist set to the production egress IP(s);
  - optionally `PAYSTACK_WEBHOOK_IP_ALLOWLIST`.
- Real, approved venue bank details and venue facts (DEC-005 / TKT-302). Entered by one admin and approved by another.
- A production `VENUE_BENEFICIARY_ENCRYPTION_KEY`, stored and backed up by Platform Operations.
- Publish Terms of Service v2.2 with `legal:publish`.
- External alerting for REVIEW top-ups, failed refunds and reconciliation issues. Today these are visible on the admin Finance page only.

## More ways to pay (CEO batch 4, item 3)

- **Capitec Pay and Instant EFT.** Paystack's extra KYC review must be approved on the FootyFinder account first (Paystack: "Pay with Bank South Africa"; about 3 business days after approval). Then add them to the setting, for example `PAYSTACK_CHANNELS=card,capitec_pay,eft`, and restart the API. Nothing else changes. Until then, checkout keeps offering card only.
- **Apple Pay.** Card-based, so refunds go back automatically and Undo is offered. Kept off until launch. To switch it on:
  1. Paystack dashboard → Settings → Apple Pay → Web Domains → **Add new domain**: the live web domain (and any subdomain checkout runs on).
  2. Download Paystack's domain verification file.
  3. Put it at `apps/web/public/.well-known/` with the file name Paystack gives, deploy the web app, and check it loads at `https://<live domain>/.well-known/<file>` (served as plain text).
  4. Click **Verify** in the Paystack dashboard.
  5. Add `apple_pay` to `PAYSTACK_CHANNELS` and restart the API.
  - Ask Paystack to confirm whether their hosted checkout page (`checkout.paystack.com`, which FootyFinder redirects to) needs our domain verified; their docs describe it for checkout on your own site.
- **QR, USSD and bank transfer** stay off; the API refuses to start if they are configured.
- **Fees.** FootyFinder pays Paystack's fee for every method (D9); players always pay exactly the top-up amount. Paystack keeps its fee when a payment is refunded.
- **Sandbox check.** `npm run smoke:paystack-sandbox` sends the configured channels to the Paystack test API with the test keys in `apps/api/.env` and reports which channels Paystack accepts.
