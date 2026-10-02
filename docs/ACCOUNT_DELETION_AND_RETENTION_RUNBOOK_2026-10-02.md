# CEO batch 5 runbook: account deletion, data download and retention

Implemented 2026-10-02 on `ceo/finish-gate-5`, one commit per item. The CEO approved decisions D1–D14 as recommended.

## Decisions (CEO, 2026-10-02)

| # | Decision |
| --- | --- |
| D1 | The wallet is refunded newest successful top-up first, each up to what it has not already refunded, through the Gate 6 refund path (`source = ACCOUNT_CLOSURE`). An amount no top-up covers stays visible to finance. It is never kept or wiped. |
| D2 | After anonymisation, only the email address is kept (`AccountDeletionRequest.contactEmail`, admin-only). It is erased once every closure refund is settled and the final email has been sent. A settle check runs daily. |
| D3 | A host is blocked while an upcoming Quick Match they host has other players. Hosted matches nobody joined are cancelled on confirm. |
| D4 | On confirm, the player leaves upcoming matches under clause 14.3 and is taken out of upcoming Team Match lineups. The looking card is switched off and join requests are withdrawn. Friends, blocks, memberships and messages are kept but hidden. The wallet is frozen. |
| D5 | If something blocks the final step at day 14, the request is `WAITING` with a reason and is checked again daily. |
| D6 | Signing in with the right password during the grace period cancels the deletion (screen and email). A password reset works during grace. |
| D7 | The email becomes `deleted-<random uuid>@deleted.invalid`, with no hash kept. The same email can sign up again. |
| D8 | Reviews the player wrote are marked `DELETED`, their text is erased, and they stop counting. |
| D9 | Admins, referees, and suspended or banned accounts cannot self-delete; they contact support. |
| D10 | A deleted player's profile shows "This player has left FootyFinder". Past lineups and results show "Deleted player" with no link. Deleted players are not on leaderboards. |
| D11 | Closed-account data kept for 12 months covers deletion records and leftovers on deleted accounts. Banned accounts are only listed for review. |
| D12 | Retention starts as report-only. An admin switches a category to purge with fresh MFA. Financial records stay report-only. Audit and security records (batch 5 brief, B4) are a category of their own: kept 5 years after the event, then purged once an admin switches the category to purge, except entries linked to an open payment dispute, an unsettled refund, an unsettled deletion, an open booking dispute or an open report. The `AdminAuditLog` trigger (migration `20261011100000_batch_5_audit_retention`) still refuses every UPDATE and any DELETE of a row under 5 years old, and allows the older DELETE only inside the retention job's transaction (`footy.audit_purge`). Anything under investigation is always kept. |
| D13 | "Download my data" needs the password and gives JSON plus a printable summary in the browser. It is limited to once every 24 hours and is audited. |
| D14 | One commit per item. Item 1 includes "Transfer ownership to a Captain". |

## For players

- **Account settings** is on your own profile page. It has two links:
  - **Download my data** (`/account/data`)
  - **Delete my account** (`/account/delete`)
- **The delete summary** shows:
  - every blocker, with a link to fix it;
  - what happens to each upcoming match (14.3 credit), each team, and the money;
  - what is deleted and what is kept, and why.

  To confirm, the player enters their password and types `DELETE`.
- **Team owners** can now make a Captain the Owner from the team page ("Make Owner").

## How it works

| Step | Where |
| --- | --- |
| Preview and blockers | `modules/account/account-deletion.preview.ts` (also re-run inside the confirm transaction and by the final step) |
| Confirm | `POST /account/deletion` sets `PENDING_DELETION`, revokes every session and schedules `ACCOUNT_DELETION_FINALISE` for 14 days later |
| Hidden everywhere | `users/hidden-account.ts`: `toPublicUser` and social cards show "Deleted player"; `blockedEitherWay` also hides deleting or deleted accounts; lineup snapshot names are replaced when read |
| Cancel | `auth.service.ts` login → `account-deletion.cancel.ts` |
| Final step | `account-deletion.finalise.ts`: returns Team Wallet money, closes empty owned teams, refunds (D1), anonymises, sends the final email, runs the settle check |
| Data download | `POST /account/data-export` (`data-export.service.ts`) |
| Retention | `modules/retention/*`: the `RETENTION_DAILY` job at 02:00 Johannesburg |

## Admin

- **People and safety → Deletion requests**
  - Shows requests that are in grace, waiting (with the reason), completed (refunds, uncovered amount, finance contact), refused (blocked reasons) and cancelled.
  - It is read-only: nothing can speed up a deletion or undo one.
  - Finance can only **Mark money settled**. This needs a written note and fresh MFA, and is audited. It is refused while a closure refund is still open.
- **Finance → Refunds needing attention**
  - Lists `NEEDS_ATTENTION` refunds, `FAILED` refunds and refunds flagged for review.
  - For a closure refund it shows the player's contact email.
  - The existing actions apply here: bank details, retry, and return to wallet.
  - Reconciliation now flags `NEEDS_ATTENTION` refunds and `ACCOUNT_CLOSURE_UNREFUNDED`.
- **System → Data retention**
  - Shows each category's rule, its mode, and its last five runs.
  - "Report now" is always a dry run.
  - "Switch to purge" needs fresh MFA. Financial records cannot be switched to purge.

## Migrations (additive, hand-written)

| Migration | Adds |
| --- | --- |
| `20261010100000_batch_5_account_deletion_enums` | `AccountStatus` values `PENDING_DELETION` and `DELETED` |
| `20261010110000_batch_5_account_deletion_requests` | `AccountDeletionRequest`, with partial unique indexes so each player has at most one live request and one blocked row |
| `20261010120000_batch_5_refund_source_account_closure` | `RefundSource` value `ACCOUNT_CLOSURE` |
| `20261010130000_batch_5_retention` | `RetentionMode`, `RetentionPolicySetting` (a CHECK keeps FINANCIAL report-only), `RetentionRun` |

## Verification

All smokes run on `footy_finder_test`:
- `smoke:account-deletion`: blocked cases, cancel within grace, delete with a balance, anonymisation, admin and finance views.
- `smoke:retention`
- `smoke:data-export`

Unit tests:
- `hidden-account.test.ts` is the privacy test: a deleting or deleted player exposes nothing personal. It includes a negative control.
- `retention.policy.test.ts`

Playwright: `e2e/account-deletion.spec.ts`.

**Retained test records (by design).** The append-only audit log names the deleting players and the smoke admins. Their anonymised accounts therefore stay in the disposable database, tagged with the smoke marker. Their money rows are removed.

## Known limits

- An anonymised account cannot be deleted outright: the ledger, Terms acceptances and audit log must keep pointing at it.
- Audit-log metadata written before the deletion is immutable. It may contain non-identifying details such as a bank name and the last four digits of an account number.
- If finance returns a closure refund to the wallet, the money sits in the deleted account's wallet. It shows on the Deletion requests page until finance pays it out and marks the case settled.
