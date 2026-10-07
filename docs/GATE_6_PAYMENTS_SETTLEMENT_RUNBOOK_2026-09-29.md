# Gate 6 runbook: personal payments (Paystack) and venue settlement

Tickets TKT-601 to TKT-609, implemented 2026-09-29 on `ceo/finish-gate-5`, one commit per ticket.
Decisions: DEC-011 (Paystack personal payments), DEC-012 (weekly dual-control venue settlement), DEC-018 (a venue is owed money only for a match that went ahead), and the CEO's Gate 6 decisions D1–D12 recorded in the ticket breakdown (section 10).

## DEC-021 Match Ticketing (batch 5, 2026-10-02): read this first

There is no wallet. Every payment is a **match ticket** for one named match (DEC-021, batch 5 brief Part A). The wallet sections further down ("What players get", "How a top-up is credited", top-up refunds, "Return to wallet") describe the system before DEC-021 and are kept as history only; their routes return 404 and their tables are read-only (D13). Venue settlement (DEC-012, DEC-018) is unchanged.

**What players get**
- **Tickets & credits** (avatar menu): upcoming and past tickets (including places paid for teammates), match credits with their expiry, refunds and their status, and the payment method used. Old `/wallet` links open it.
- **Buying a place:** tap an open position (or a sub place) → confirm sheet with the match, venue, kick-off, place, R80 and the cancellation policy in plain words → tick "I understand the cancellation policy" → Paystack hosted checkout (or "Use 1 match credit" when they have one). The place is held for 10 minutes ("Being booked").
- **Teams:** any squad member pays for named teammates on the team's checklist; T-4h alert, T-2h cutoff (D1).

**How a ticket is confirmed**
1. `POST /matches/:id/tickets/checkout` (or `/team-sides/:side/tickets/checkout`, with an `Idempotency-Key`) creates the `TicketCheckout`, the HELD ticket(s) and a `ProviderPayment` with `purpose = TICKETS`, then calls Paystack `transaction/initialize` with `channels` from `PAYSTACK_CHANNELS`, `currency: 'ZAR'`, our reference `ff_ticket_<32 hex>`, `callback_url = CLIENT_URL/tickets/return`, and metadata `{ providerPaymentId, checkoutId, matchId, ticketId, positionId, venue, kickoff }` plus `custom_fields` "FootyFinder match ticket: <venue>, <date time>" (the only line-item text Paystack's checkout and receipt can show).
2. **The browser never confirms anything.** `/tickets/return` only asks `GET /tickets/checkouts/by-reference/:reference`.
3. The signed webhook, the hold-expiry job and the status check all call `TicketSettlementService.settleFromVerify`, which verifies with Paystack from our server under the same rules as before (`payment-verification.ts`: success, exact amount, ZAR, an offered channel, matching reference and metadata). The player is placed once. A payment confirmed after the hold ended is placed if the same place is still free and the player is still eligible; otherwise it is refunded in full to the original method with an email saying why (A1.4, D5).
4. A late `charge.success` for an earlier top-up is recorded and ignored (`retired_top_up_ignored`).

**Refunds (A7):** Paystack Refund API with `amount` (partial: one R80 place of a team payment), always to the payer. `refund.pending/processing/processed/failed` and "needs attention" are applied idempotently by Paystack's refund id. NEEDS_ATTENTION is completed with the customer's bank details (Finance → Refunds needing attention; never stored). A failed refund stays with finance and is retried; it never becomes a credit. There is no admin free-form refund and no "Return to wallet".

**Disputes (A8, D9):** `charge.dispute.create/remind/resolve` → Admin → Payment disputes, with the evidence pack (tickets, policy acceptance with IP and browser, emails, the referee's attendance record, cancellation and refund history). The payer cannot buy tickets or use credits while a dispute is open; tickets stay valid. Won: the restriction lifts by itself. Lost: an admin lifts it with a reason (fresh MFA, audited).

**Reconciliation (A6):** Admin → Finance and `npm run tickets:reconcile` (read-only). See ADMIN_BACK_OFFICE_IMPLEMENTATION.md.

**Paystack dashboard changes for DEC-021**

| Setting | Value | When |
| --- | --- | --- |
| Test / Live Callback URL | `<CLIENT_URL>/tickets/return` (locally `http://localhost:5173/tickets/return`) | Now. We also send it with every transaction. |
| Billing descriptor / statement name | `FOOTYFINDER MATCH` (CEO-approved, 6 October 2026) | Before going live; it is a Paystack dashboard / business setting, not something the app sends |
| Webhook URL | Unchanged (`/payments/paystack/webhook`) | As before |

**Settings retired:** `TOP_UP_PENDING_EXPIRY_MINUTES` and `TOP_UP_MAX_PENDING_HOURS`. The 10-minute hold, the 24-hour rule, the 7-day choice and the 3-year credit validity are fixed constants in `packages/shared/src/config/ticketing.ts`.

**Smokes:** `smoke:tickets`, `smoke:ticket-refunds`, `smoke:ticket-leave`, `smoke:match-credits`, `smoke:ticket-disputes`, `smoke:team-go-no-go`, `smoke:payment-to-settlement` (now on tickets) and `smoke:paystack-sandbox` (a ticket reference against the real TEST API). `smoke:payments` and `smoke:payment-methods` (top-ups) are retired.

**Terms:** the DEC-021 Terms were **v2.5 (Launch version)**; v2.6 adds PayFast as a second Payment Provider (see the PayFast section). Published versions are immutable, and the earlier v2.4 text (with the wallet) was already published from `legal-launch.json` wherever `legal:publish` ran, so the ticketing text is a new version (CEO decision, 6 October 2026). Publish it with `legal:publish` and `docs/legal/legal-launch.json`; it is material and every account re-accepts it once.

---

## PayFast (alternative Payment Provider)

`PAYMENT_PROVIDER=payfast` takes match ticket payments on PayFast instead of Paystack, through the same checkout, settlement and refund paths. Each payment records its provider (`ProviderPayment.provider`), and it is always verified and refunded with that provider, so switching providers never strands a payment.

**Terms.** Terms of Service v2.6 (CEO decision, 7 October 2026) name PayFast (DPO Payfast, part of Network International) as a Payment Provider and POPIA operator alongside Paystack. They say FootyFinder pays all PayFast fees (players pay exactly R80), that PayFast takes card (Visa, Mastercard) and Instant EFT, and that refunds go back to the original payment method through PayFast's Refund API (clauses 2, 8.4, 13.2, 13.3, 14.7 and the summary). Production accepts `PAYMENT_PROVIDER=payfast` with `PAYFAST_SANDBOX=false`.

**Payment methods are a PayFast dashboard setting.** PayFast's payment form can name only one `payment_method`, so the form leaves it out and PayFast shows the methods switched on for the merchant. Switch on **only Card and Instant EFT** in the PayFast dashboard (live and sandbox); anything else would not match Terms clause 13.3.

| Setting | Value |
|---|---|
| `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY` | From the PayFast dashboard (sandbox: the sandbox merchant). The merchant key is part of the checkout form, as PayFast requires. |
| `PAYFAST_PASSPHRASE` | The passphrase set in the PayFast dashboard. It salts every signature and is never sent, logged or shown. Required. |
| `PAYFAST_SANDBOX` | `true` (default): `sandbox.payfast.co.za` for checkout and ITN validation, and the Refund API with `?testing=true`. Must be `true` outside production and `false` in production (like Paystack's test and live keys). |
| `PUBLIC_API_URL` | Must be reachable by PayFast: the ITN goes to `PUBLIC_API_URL/payments/payfast/itn`. Locally, use a tunnel. |

**Flow.**
1. Checkout (`POST /matches/:id/tickets/checkout`, or the team checkout) holds the place for 10 minutes and returns PayFast's signed payment form as a checkout address on `/eng/process`. The web app posts it to PayFast. Fields: `merchant_id`, `merchant_key`, `return_url` (`CLIENT_URL/tickets/return?reference=<our reference>`), `cancel_url` (the match lobby), `notify_url`, `email_address`, `m_payment_id` (our `ff_ticket_…` reference), `amount`, `item_name` ("FootyFinder match ticket: venue, date and time"), `custom_str1` (our payment id), `custom_str2` (the checkout id) and `signature` (MD5 with the passphrase).
2. ITN: `POST /payments/payfast/itn` checks the signature and the merchant id on the exact posted fields, stores the notice once, queues `PAYFAST_ITN_PROCESS` and answers 200. A forged notice gets 400 and is recorded without its body.
3. The ITN job posts the signed fields back to PayFast's `/eng/query/validate`. Only a notice PayFast answers `VALID` for is marked validated, and then ticket settlement applies it: the amount, ZAR and our payment id must match our record (otherwise REVIEW), and `payment_status=COMPLETE` places the player. If PayFast cannot be reached, the job retries.
4. The return page polls our server by reference and takes the player to the match lobby once their place is confirmed. The status check and the hold-expiry job use the same settlement path; they read only validated ITNs, so the browser never confirms anything.
5. Refunds (leaving more than 24 hours out, a cancelled match, a late or duplicate payment) go to PayFast's Refund API (`POST https://api.payfast.co.za/refunds/{pf_payment_id}`) with the merchant id, `version: v1`, a timestamp and a signature over the sorted header and body values plus the passphrase. PayFast sends no refund webhooks, so an accepted refund is recorded as PROCESSED. A refused or failed one stays FAILED for finance, as with Paystack: for example an Instant EFT refund for which PayFast needs the player's bank details (support asks the player, clause 14.7). Finance should reconcile PayFast refunds against the PayFast dashboard.

**Before switching production to PayFast:** publish Terms v2.6 (`legal:publish`), switch on only Card and Instant EFT in the PayFast dashboard, and run a sandbox card payment, a sandbox Instant EFT payment and a sandbox refund of each end to end. The Refund API request fields and timestamp format follow PayFast's documentation and have only been exercised against a fake server here. Also decide whether to add PayFast's source-host check for ITNs (today: signature, merchant id and server-side validation), and set up a PayFast dispute (chargeback) process, because the Paystack dispute webhooks do not cover PayFast.

**Smoke:** `npm run smoke:payfast --workspace=@footy-finder/api` (PayFast's servers faked; everything else real, on the test database). It is part of `smoke:all`.

## Before DEC-021 (history)

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
| Test Callback URL | *(before DEC-021)* `http://localhost:5173/wallet/top-up/return`; now `/tickets/return` (see above) | Any time. We also send it with every transaction. |
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
  - Account closure (ToS 20.2): since CEO batch 5 the player deletes their own account in the app; 14 days later the final step refunds the balance through this same refund path (source `ACCOUNT_CLOSURE`, newest top-up first). Anything that needs finance appears under Finance > "Refunds needing attention" and on the admin "Deletion requests" page. See `docs/ACCOUNT_DELETION_AND_RETENTION_RUNBOOK_2026-10-02.md`.
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
- Publish Terms of Service v2.6 (Launch version) with `legal:publish` and `docs/legal/legal-launch.json`.
- External alerting for REVIEW ticket payments, failed refunds and reconciliation issues. Today these are visible on the admin Finance page only.

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
- **Fees.** FootyFinder pays Paystack's fee for every method (D9); players always pay exactly the ticket price. Paystack keeps its fee when a payment is refunded.
- **Sandbox check.** `npm run smoke:paystack-sandbox` sends the configured channels to the Paystack test API with the test keys in `apps/api/.env` and reports which channels Paystack accepts.
