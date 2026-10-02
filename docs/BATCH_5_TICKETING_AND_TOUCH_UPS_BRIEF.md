# FootyFinder: Batch 5 brief (Match Ticketing + final touch-ups)

**Author:** Sibulele Mbande (CEO), 2 Oct 2026
**Branch:** `ceo/finish-gate-5`
**Read with:** `CLAUDE.md`, `PRODUCT_REQUIREMENTS_TICKET_BREAKDOWN_2026-09-24.txt` (DEC-011, DEC-018, DEC-019), `docs/legal/TERMS_OF_SERVICE.md`, Gate 6 payments runbook.

**Precondition:** the account deletion / data download / retention work must be finished, tested and committed before this batch starts. That work assumes the wallet, so this batch adapts it (see A10).

---

## Why we're doing this

Paystack declined to onboard FootyFinder because of the **wallet** (prepaid stored value). Payment providers see that as a high chargeback risk: people top up, forget the balance and dispute it later. We are changing to **Sports & Recreation Event Ticketing (standard e-commerce)**, the same model GoodRec uses:

- Every payment is a **match ticket** for one named match, at a named venue, at a set date and time.
- **Nobody can load money onto the platform.** There are no top-ups, no team wallets and no rand balances.
- Refunds go back to the **original payment method** through the Paystack Refund API. The only non-cash option is a **match credit**, and it is only ever the player's choice.

After this batch ships, we reapply to Paystack (and PayFast / Peach Payments in parallel) with the new model. **Nothing in the app, the ToS or the payment metadata may describe a "wallet", "balance", "top-up" or "funds".**

This is recorded as **DEC-021 (Match Ticketing)**. It replaces the wallet parts of DEC-011, DEC-018 and DEC-019. Record it word for word in the ticket breakdown.

---

## Part A: Match Ticketing (DEC-021)

### A1. Quick matches (non-team): pay when you claim a position
1. A player taps an open position, sees a confirm sheet (match, venue, kickoff, position, **R80**, the cancellation policy in plain words and a required "I understand the cancellation policy" tick), then taps **Pay R80 · Card / Instant EFT**. Paystack hosted checkout opens.
2. While they pay, the position is **held for 10 minutes** (shown as "Being booked" to others). If checkout doesn't complete, the hold is released automatically by a durable job.
3. The player is placed in the position **only after a server-verified payment** (webhook or server-side verify). A client "success" redirect never confirms anything.
4. **Late payment edge case:** if the payment confirms after the hold expired and the position or the match is gone, the player gets an **automatic full refund** to the original method (not a credit) plus an email saying why.
5. One Paystack transaction = one ticket. Metadata: `matchId`, `ticketId`, `positionId`, venue, kickoff. Customer receipt and line item say "FootyFinder match ticket: <venue>, <date time>".
6. Free matches ("On FootyFinder"): an R0 ticket, no checkout, same placement rules. The promotions ledger stays as it is.
7. Subs pay R80 too (DEC-018 unchanged).

### A2. Player leaves a quick match
- **More than 24 hours before kickoff:** the player chooses between
  - **1 match credit** (recommended, the highlighted button: "Use it on any match"), or
  - **Refund R80 to my card / bank** (Paystack Refund API, original method).
- **24 hours or less before kickoff:** no refund and no credit. The spot is released for someone else to buy. The leave sheet says so clearly before they confirm.
- **After the T-30 lock:** the player can't leave (unchanged).
- The **old 12-hour rule and the "replacement credit" rule are removed.**

### A3. Match cancelled by FootyFinder, the venue, the Host, or automatically at T-30
- Every ticket holder gets the **choice: 1 match credit or a full refund.** They get an in-app and email alert with both buttons.
- **If they don't choose within 7 days, they're refunded automatically.** We never quietly turn money into credit, because silent credit causes chargebacks.
- The T-30 go/no-go rule (every position filled + a referee assigned) is unchanged for quick matches.
- Matches abandoned after kickoff: no refund (unchanged).

### A4. Match credits (replace the wallet)
- A credit is counted in **matches, not rands**: "You have 2 match credits." **1 credit = 1 ticket** to any paid match, whatever its price. Never show a rand value.
- A credit can be used at checkout instead of paying. When a player has credits, the confirm sheet shows "Use 1 match credit" as the main button, with "Pay R80 instead" below it.
- Credits are **personal and non-transferable**, can't be bought, and **can't be cashed out once chosen**. The refund choice happens at the moment of leaving or cancellation, not afterwards.
- **Expiry: at least 3 years from issue** (Consumer Protection Act s63 minimum for prepaid vouchers). Recommend simply "valid for 3 years".
- Every credit is a ledger entry (issued / used / expired) linked to the ticket it came from, for reconciliation and audit.
- A credit used on a match that is later cancelled is returned as a credit (it was never cash).

### A5. Team matches: pay for named teammates
Replaces the Team Wallet and fill meter.
- Team fee = R80 × (starters + that team's chosen subs) (DEC-019 unchanged).
- When a squad member taps **Pay match fee**, show a **named roster checklist**, not a "how many people?" prompt:

```
Select who you are paying for:

[✓] Myself (Sibulele) ................. R80
[✓] Sipho Ndlovu (Unpaid) ............. R80
[✓] Thabo Mokoena (Unpaid) ............ R80
[ ] David Khumalo (Unpaid) ............ R80
[ ] Lwazi Jacobs (Unpaid) ............. R80

Total: R240
[ PAY R240 VIA CARD / INSTANT EFT ]
```

- Already-paid players show "Paid by Thabo" and can't be ticked. Players another person is currently paying for show "Being paid for" (10-minute hold, like A1), so nobody pays twice. If a double payment slips through anyway, the extra seat is refunded automatically.
- One Paystack transaction can cover several players. Each covered player gets their own ticket with `payerId` and `playerId`. Refunds are partial (`amount` on the Refund API), **always to the payer, never to the player.**
- Players can use their own match credit for **their own seat only**.
- The team page shows a progress bar of named players: "11 of 14 paid · R240 still needed".
- **Deadlines (recommended, CEO to confirm in D1):**
  - **Team payment deadline: T-4 hours.** At T-4h, if the team isn't fully paid, the **captain** (and the HOME host) gets an in-app + email + push alert: "Pay the remaining R160 by 13:30 to confirm your team." The captain gets the same named checklist with the unpaid players pre-ticked.
  - **Final cutoff: T-2 hours.** Still not fully paid → the fixture is cancelled automatically, and every payer gets the A3 choice (credit or refund) for each seat they paid for.
  - Why not "cutoff at T-2h then 2 more hours for the captain": that runs into kickoff and the T-30 lock, and the venue and referee need notice.
- A player who leaves a team match: same 24-hour rule as A2, but the credit or refund goes **to whoever paid for that seat**. If the payer isn't the player, both get an email.
- A team withdrawing (loading team) or HOME cancelling: A3 applies to every payer.

### A6. Remove the wallet completely
- Remove: top-ups (R50–R5,000, quick picks R200/R400/R800), Undo top-up, team wallet contributions and take-backs, fill meter, field-booking funding pools if they only serve the wallet (check `modules/bookings`), the negative-balance spending restriction, and every "wallet / balance / funds / top up" string in web, admin, emails and ToS.
- The **Wallet** page becomes **Tickets & credits**: upcoming tickets, past tickets, credits (with expiry), refunds and their status, and the payment method used.
- Data: we are pre-launch and there is no real money. **Additive migrations only.** Keep old wallet tables read-only for history (or retire them through an additive migration). The local `footy_finder` mock world must keep working: convert mock balances to match credits or zero them in a dev-only script, Claude Code to propose (D-decision). **Never reset the local DB.**
- Admin finance: replace wallet reconciliation with **ticket reconciliation** (every confirmed ticket has a verified provider transaction or a credit or an R0 free-match reason; every refund matches a provider refund event; credits issued = used + expired + outstanding).

### A7. Refunds
- Paystack Refund API with `amount` for partial refunds. Handle `refund.pending / processing / needs-attention / failed / processed` webhooks idempotently.
- Reuse the existing **NEEDS_ATTENTION** flow for bank-method refunds (admin "retry with customer bank details"; details sent to Paystack, never stored).
- A failed refund never silently becomes a credit. It stays in the admin "Refunds needing attention" queue.
- FootyFinder absorbs fees (unchanged). Note that providers may not return the original fee on a refund, which is one more reason the credit is the highlighted option.

### A8. Chargeback protection (what providers will ask about)
- Required policy tick at checkout, stored with a timestamp, ToS version, IP and user agent.
- An emailed **ticket receipt** straight after payment (match, venue, address, kickoff, position, amount, cancellation policy, "Manage my ticket" link).
- **No new reminder notifications** (CEO decision: keep notifications to a minimum). The 24-hour rule is shown clearly **before they pay** (confirm sheet + required tick) and repeated in the ticket receipt email. The existing T-2h reminder stays as it is.
- Billing descriptor / statement name set to something recognisable, e.g. `FOOTYFINDER MATCH`. Document this in the Gate 6 runbook (it's a Paystack dashboard setting).
- Paystack **dispute webhooks** (`charge.dispute.create` / `remind` / `resolve`) → an admin **Disputes** queue with an auto-built **evidence pack**: ticket, policy acceptance record, emails sent, the referee's attendance record (who played / who didn't), and any cancellation or refund history. A disputed ticket's player is flagged; booking is restricted until the dispute is resolved.

### A9. ToS and copy
Per the CLAUDE.md rule, update `docs/legal/TERMS_OF_SERVICE.md` in the same work: payments become ticket purchases, the 24-hour rule, credits (3-year validity, non-transferable, no cash value once chosen), the refund-on-cancellation choice and the 7-day auto-refund, team payer rules, team deadlines, disputes. Remove every wallet clause. The version stays v2.4 "Launch version".

### A10. Account deletion (built in commits `1075258`–`5f7a6b9`, runbook `docs/ACCOUNT_DELETION_AND_RETENTION_RUNBOOK_2026-10-02.md`)
Adapt it to tickets:
- Unused match credits → a warning in the delete summary. Recommended: credits are forfeited on deletion, and the screen says so and offers "Use your credits first".
- Upcoming paid tickets follow the normal A2 rules (more than 24h before kickoff: the delete flow asks credit-or-refund, and because credits are forfeited it defaults to the refund; 24h or less: forfeited, and the summary says so).
- Pending refunds and open disputes remain blockers.
- Remove the "Team Wallet money back to wallet, then refund the balance across top-ups newest first" step at day 14, and **remove finance's "Return to wallet" option on closure refunds** (it leaves money in a deleted account). A closure refund is either retried to the original method or retried with bank details through NEEDS_ATTENTION.
- Update ToS 20.2 ("Your money on closure") to the ticket wording.

---

## Part B: Final touch-ups

### B1. Team colour picker: mobile-first
The current input opens a desktop-style floating colour picker that covers the live preview, needs pixel-precise dragging, opens the keyboard for the RGB fields and shows an eyedropper that doesn't work on iOS Safari.
- Replace it with a **swatch grid of the standard colours football kits actually come in** (CEO decision: **no custom colour, no hex field, no RGB fields, no eyedropper**. People pick the colour of their kit, not a code). About 16–20 swatches, each with its plain name shown under it: White, Black, Grey, Red, Maroon, Orange, Gold, Yellow, Lime, Green, Dark green, Sky blue, Royal blue, Navy, Purple, Pink, Brown, Beige/cream (Claude Code to propose the final list and exact shades as a D-decision). Each swatch is at least 44×44px with a tick on the selected one and an accessible name.
- On phones, open it as a **bottom sheet** that leaves the **live preview visible** (sheet ≤ 50% of the viewport height, or a mini preview pinned inside the sheet that updates instantly). No text input anywhere in the picker, so the keyboard never opens.
- **Existing teams** whose saved colour isn't in the list: map it to the nearest swatch (one-off, additive; Claude Code to propose how as a D-decision).
- Warn if primary and secondary are too similar (contrast check), and auto-pick readable text colour on the preview.
- One shared component for primary + secondary. On desktop the same component can show as a popover. Behind the scenes the colours can still be stored as they are today; players only ever see names and swatches.

### B2. No browser pop-ups anywhere
Cancelling a match uses the browser's `window.confirm` ("localhost:5173 says…").
- Build one shared **in-app ConfirmDialog**, styled like the "Choose your team" sheet: a bottom sheet on phones and a centred dialog on desktop, title, plain-English consequences, primary/destructive button (red for destructive), "Keep match" secondary button, loading state, inline error, focus trap, Esc/back closes it, safe with the keyboard.
- **Replace every** `window.confirm`, `window.alert` and `window.prompt` in web and admin with it (search the whole codebase). Add an ESLint rule (`no-alert` / `no-restricted-globals`) so it can't come back.
- New cancel-match copy (Part A): "Cancel this match? All N players will be asked to choose a match credit or a full refund, and are notified by email."

### B3. Leaderboards
Screenshot: the player names don't show (only avatars), and the left-hand numbers (1,1,1,1,1,1,7…) are shared "competition" ranks that read like nonsense.
- **Find the root cause of the missing names.** It may be the shared `PlayerName` component from batch 4 (`62bb3fd`) collapsing to zero width in a flex row, or the leaderboard DTO not including the display name. Fix it, and add a test that a name renders.
- **Ranks: show a clear 1, 2, 3… order using tie-breakers** (CEO to confirm in D-decision):
  - Most matches: matches ↓, then goals + assists ↓, then whoever reached the total first.
  - Most goals: goals ↓, then fewer matches played, then assists ↓, then reached first.
  - Most assists: assists ↓, then fewer matches, then goals ↓, then reached first.
  - Replace the subtitle with "Ranked by …; ties go to …".
- Add a header row (`#  Player  Matches/Goals/Assists`), medal styling for 1–3, highlight "You", show the top 10 plus "Your position: 14th" if the viewer is outside it.
- On phones, show the three boards as **tabs** (Matches · Goals · Assists) instead of three squeezed columns.
- Guests see names as public profiles already allow (privacy rules unchanged).

### B4. Audit record retention (wording decision from the account-deletion batch)
The retention table currently says audit records are kept permanently. POPIA s14 says personal information must not be kept longer than necessary, and "permanently" is hard to defend. Change it to: **"Audit and security records are kept for 5 years after the event, or longer only while needed for an open dispute, investigation or legal claim, then deleted."** Money records stay as they are (5 years).
- Add an audit category to the nightly retention jobs, **report-only** like the others. Admin can switch it to purge with fresh MFA, but never for entries linked to an open dispute or finance case.
- If the audit table is protected against deletes by a DB rule, propose the safest additive way (D-decision) and don't weaken the protection for anything newer than 5 years.

---

## Build order (one commit per item)
0. B4 audit retention wording + job
1. B3 leaderboards → 2. B1 colour picker → 3. B2 ConfirmDialog + remove all browser pop-ups → 4. A (ticketing), in small commits: schema/migrations → ticket checkout + holds → webhooks/verify → leave + cancellation choice → credits → team roster payments + deadlines → refunds → disputes + evidence pack → remove wallet UI/API → reconciliation → ToS → e2e → 5. Update the cancel-match copy in B2 to the final Part A wording.

## Standing rules (unchanged)
Plan first with D1, D2… decisions and wait for CEO approval. One commit per item, files staged by name. Never commit `.env`/keys. Never `prisma migrate dev`; additive hand-written migrations proven with `migrate deploy` on `footy_finder_test`. Never reset local `footy_finder`. ToS updated in the same work. Venue costs never reach players. Don't push. Unit tests + `npm run smoke:all` + full Playwright as one clean run at the end (ask before stopping dev servers). Add mobile (≤420px) Playwright checks for B1, B2, B3 and the checkout sheets.
