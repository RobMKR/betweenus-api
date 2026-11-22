# Private account events, splits and repayments

[Issue #13](https://github.com/betweenus-tech/betweenus-api/issues/13) records the API/mobile-agreed contract. The owner requires these features in both account and offline modes; this API stores the account version, while mobile owns its separate backward-compatible device ledger. There is no paid/free gating or automatic upload/merge of offline data.

Every route requires existing verified bearer auth and enforces the signed-in **owner ID**. Saved People, rosters and events do not grant other accounts access, verify contact phone/email, send invitations or create borrower-confirmed debts. Account vaults are private records, not multi-user collaboration. Money never moves through this API.

## Event contract

| Route                                          | Input                                         | Response                  |
| ---------------------------------------------- | --------------------------------------------- | ------------------------- |
| GET `/v1/vaults/:vaultId/events`               | —                                             | `{events: Event[]}`       |
| POST `/v1/vaults/:vaultId/events`              | Event input below                             | 201 `{event}`             |
| GET `/v1/events/:id`                           | —                                             | `{event}`                 |
| POST `/v1/events/:id/payments`                 | `{clientRequestId,participantId,amountMinor}` | `{event}`                 |
| POST `/v1/events/:id/payments/:paymentId/undo` | `{clientRequestId}`                           | `{event}`                 |
| POST `/v1/vaults/:id/archive`                  | `{archived:boolean}`                          | `{vault,members,history}` |
| GET `/v1/vault-balances`                       | —                                             | `{balances: Balance[]}`   |

Event input:

```json
{
  "clientRequestId": "<UUID generated once for this save intent>",
  "title": "Friday Football",
  "date": "2026-11-21",
  "currency": "AED",
  "totalMinor": 63000,
  "participantIds": ["self", "<saved Person UUID>", "<another Person UUID>"],
  "payerId": "self",
  "splitMode": "equal",
  "partialPayments": false
}
```

Manual mode also requires `allocations: [{participantId,shareMinor}, ...]`. Equal mode rejects that field. Unknown fields are rejected. Title is trimmed, 1–200 characters, and rejects NUL before storage. Date is a real `YYYY-MM-DD` date (years 0001–9999), without timezone conversion; there is no vault date. Total is a positive integer up to 1,000,000,000 AED minor units. Event creation permits up to 32 KiB JSON so valid 100-person manual allocations fit; the normal API body limit remains 8 KiB.

Select 1–100 distinct ordered IDs, each `self` or an owner-saved Person UUID. Same names are allowed for distinct IDs. The roster is a candidate pool, not a requirement to include every member or restrict selection to roster members. Server snapshots names and shares; later roster changes do not rewrite events. New custom/contact participants use the explicit [saved People flow](PEOPLE_VAULTS.md) first, submitting selected fields only. A Person explicitly saved there remains saved if a later event draft is cancelled. `self` is the authenticated owner, never inferred from a matching name/email or stored as a saved Person.

Include me means `self` appears in participantIds. It can be absent even when `payerId` is `self`. Every nonself payer must be a selected participant. Equal mode floors total/count and gives one remainder minor unit to each earliest participant in saved order. Manual mode requires exactly one nonnegative integer share per selected ID, each <=1,000,000,000, with sum exactly total. Zero individual shares are allowed. The server does not rebalance manual shares; mobile preserves draft values and requires reconciliation after changes. Saved expense snapshots have no edit/delete endpoint in this slice.

`partialPayments` is an optional boolean on creation. Sending `true` allows partial amounts. Sending `false` requires the participant's full current remaining amount. Omission defaults to `true` for older clients and existing events. Every event response includes the effective boolean.

Event DTO:

```text
{id,vaultId,title,date,currency,totalMinor,payerId,splitMode,partialPayments,
 participants:[{participantId,name,isSelf,shareMinor,remainingMinor}],
 payments:[{id,participantId,amountMinor,createdAt,reversesId?}],
 createdAt,updatedAt,
 balance:{currency,receivableMinor,payableMinor,netMinor}}
```

Timestamps are ISO UTC. Payment history is append-only and ordered; a reversal is a server-created equal negative row referencing the original positive payment. No negative client amount is accepted. Payer own share has remainingMinor zero and cannot receive a payment. Other remaining amounts are allocated share minus signed payment history. If self pays, other participants' remaining amounts are receivable; if another person pays and self participates, only self's remaining share is payable; if self is neither, the owner's balance contribution is zero. AED 630 divided among 14 including the payer gives AED 45 each and AED 585 receivable.

## Retry, concurrency and archive behavior

Generate a UUID clientRequestId **once per money-write intent** (event, payment or undo). Preserve that UUID and parsed request data across uncertain retries; use a new UUID for a new intent. UUID resource, participant, payer, payment and request IDs are case-insensitive and canonicalized to lowercase before comparison, lookup or fingerprinting; reserved `self` remains the exact literal. An owner-scoped fingerprint covers the normalized action/resource/data. Manual allocation row order is not meaningful: identical participant→share mappings with the same ordered participantIds are the same intent. Changed shares or participant order remain a conflict (including equal splits, where order affects remainder allocation). Identical retries create no second operation and return the same event ID with **fresh current event state**, including subsequent payments/undo. Reusing an ID for different data/action/resource returns 409. Failed transactions reserve no ID and publish no partial event, payment or correction. New saved People/vault creation still follows its base contract, which is not automatically deduplicated.

Positive payments above the current remaining amount return 409 `OVERPAYMENT`. A lower amount on an event with `partialPayments: false` returns 409 `FULL_PAYMENT_REQUIRED`. Successful payment retries return current event state before checking the remaining amount. For create retries, keep the original `partialPayments` value or omission. Explicit values enter the fingerprint, while omission preserves compatibility with stored fingerprints from before the field was added.

Undo targets an unreversed positive payment on the same event and appends exactly one equal reversal. A matching retry is safe; a new second undo intent or undo of a reversal is 409. PostgreSQL locks vault before event, serializes money checks/writes, and enforces a unique reversal link. In-memory demo writes are serialized too. Idempotency records persist with the ledger; they are not an expiring cache.

Archive/reactivate changes state and vault history once; repeating the same state is a no-op. Archived records remain readable and included in outstanding totals. New event/payment/undo writes fail 409 until reactivation. A retry of an already-successful money intent may still read its current result while archived because it creates no new operation. Roster management remains separate from financial mutation guards.

All Vault DTOs now also contain `eventCount` and per-vault `balances: Balance[]`, preserving their existing fields and detail shape. GET `/v1/vault-balances` aggregates all owner events, including archived outstanding amounts, and returns AED zeros when empty. Vault updatedAt describes container/roster/archive changes; Event updatedAt describes its creation/payment history. **Keep private vault totals separate from GET `/v1/balances`**, which remains accepted borrower-confirmed principal only. Mobile must label the two ledgers distinctly and never double-count or auto-confirm one as the other.

Errors retain `{error:{code,message}}`: invalid input 400; invalid/unverified auth 401; missing/inaccessible event/vault/participant 404; archived writes, overpayment, payer payments, already-reversed payments and conflicting request IDs 409.

## Persistence and verification

Apply migration `003_account_events.sql` after `002_people_vaults.sql`, using the existing explicit migration runner **before new server code**. It adds event/payment/idempotency tables, owner indexes/FKs, RLS and revoked browser table/sequence privileges, and broadens existing vault-history constraints for archive/reactivation without removing old rows. The API uses the trusted server database role. Event snapshots store selected names/shares; they do not copy contact phone/email. Client requests never choose owner IDs or verified-user claims.

The prior application remains compatible with the added tables and existing history values; code rollback never automatically drops the schema. Back up and review release compatibility; no deployment is performed by this change. Device-only storage/migration, native contacts and wizard UX are coordinated mobile work, not database-side imports.

Apply `004_event_partial_payments.sql` before running server code that reads the policy. It adds a non-null boolean with default `true` without altering historical amounts or idempotency records. Old API code can still create legacy events with the database default, but rejects the new request field and skips the full-share check. Roll out the updated API to every writer before enabling the mobile toggle. Rolling back to old API code after full-share events exist suspends their enforcement until the updated code is restored, while the database retains their setting.

Focused tests exercise equal/manual rounding and malformed requests, owner isolation, duplicate-name snapshots, partial/full payment/undo, idempotent fresh-state retries, archive guards/totals, 100-person manual payloads and separate debt totals. Embedded PostgreSQL executes actual migrations/queries, verifies old debt/vault data and browser-role restrictions, and injects late transaction failures to prove event/payment/undo rollback. Optional network PostgreSQL tests run when DATABASE_URL points at an isolated migrated test database, covering simultaneous duplicate creates/payments/undo and overpayment. Embedded tests are not live Supabase/TLS/native-device evidence; CI supplies PostgreSQL for the network path.
