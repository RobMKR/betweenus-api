# Saved People and private account vaults

The base contract for [API issue #11](https://github.com/betweenus-tech/betweenus-api/issues/11) is coordinated with mobile People/membership issues. All routes use existing verified bearer authentication. These records belong to the signed-in owner only. A person added to a roster receives **no account access, invitation or notification**. Phone/email/contact provenance is not verified account identity and never automatically links to Supabase users.

## Selected People

`GET /v1/people` returns `{people: Person[]}`. `POST /v1/people` accepts:

```json
{
  "name": "Friday friend",
  "source": "contact",
  "email": "friend@example.com",
  "phone": "+971 50 123 4567"
}
```

Create returns 201 `{person}`. Person has `id` (server UUID), `name`, `source` (`custom` or `contact`), nullable `email`, nullable `phone` and ISO `createdAt`. Name is trimmed, 1–100 characters. Optional email is trimmed/lowercased and must be valid, at most 254 characters. Optional phone is trimmed, at most 40 characters, only digits/space/`+().-`, with at least one digit; this checks stored formatting, not number ownership or deliverability. Omit absent fields rather than sending empty strings or null.

The mobile app asks contact permission only in the native selection flow. It submits only the **explicitly selected name and at most one phone/email**. No device contact ID, photo, arrays, address book, arbitrary metadata, owner ID or verified-user claim is accepted. Custom entry remains available when contacts are denied/unavailable. Same-name people are separate UUID records; no automatic identity deduplication occurs. Contact source is owner-provided provenance, not proof of native permission or identity.

## Vaults and roster

`GET /v1/vaults` returns `{vaults: Vault[]}`. `POST /v1/vaults` accepts `{title,kind,memberIds}` and returns 201 `{vault,members,history}`. Title is trimmed, 1–100 characters; kind is `temporary` or `permanent`; memberIds is an ordered array of 0–100 distinct UUIDs from this owner's saved People. There is no vault date. The owner is implicit and never a saved Person/roster slot.

Vault has `id`, `title`, `kind`, `archived` (initially false), ordered `memberIds`, ISO `createdAt` and `updatedAt`. This slice has no archive transition. Initial creation validates every selected person and commits vault, roster and history together; a foreign/missing person rolls back the entire creation.

- `GET /v1/vaults/:id` returns `{vault,members: Person[],history}`.
- `POST /v1/vaults/:id/members` `{personId}` adds a saved Person at the end.
- `POST /v1/vaults/:id/members/remove` `{personId}` removes that saved Person from the roster.

Both mutations return the detail shape and are idempotent: retries do not change history or updatedAt when the requested membership already holds. Removing someone does not delete their saved Person or earlier history; re-adding appends them after existing members. History entries have `id`, `action` (`created`, `member_added`, `member_removed`), nullable `personId`, `actorId` and ISO `createdAt`. Mutation/history writes are one row-locked transaction.

UUID resource/member inputs are case-insensitive and normalized to lowercase before lookup, comparison and duplicate detection. A member repeated with different UUID letter case is still a duplicate and returns 400. Name/title strings containing NUL are rejected with 400 before either memory or PostgreSQL writes.

Missing or other-owner vault/person references return 404. Invalid UUIDs, duplicate member input, unknown fields and invalid values return 400. Missing/invalid/unverified auth returns 401. Errors retain `{error:{code,message}}`. The owner cannot grant access by adding another person's email. New person/vault creation is not automatically deduplicated on retries; clients should prevent double submission and reconcile lists after an uncertain response. Member changes are retry-safe.

## Persistence, compatibility and boundaries

Apply additive migration `002_people_vaults.sql` with the existing migration runner before serving these routes. Tables have owner indexes, composite owner foreign keys, RLS and revoked browser-role grants. The trusted server database role owns access; clients call the API. An older application can run against this additive schema; code rollback does not downgrade/drop the new tables. Existing debt rows/history and accepted-only `/balances` behavior are unchanged.

Demo mode exposes the same routes with ephemeral memory, isolated by its fake identities. Real account mode uses PostgreSQL; storage survives restarts. Device-only People/vaults are separate mobile records and are not automatically uploaded or merged with account data. No People edit/delete, collaborative membership permissions, automatic borrower/debt creation, messaging or notification is implemented here. A debt still requires an explicit borrower email and that verified borrower's acceptance.

**Account events are implemented separately in [issue #13](https://github.com/betweenus-tech/betweenus-api/issues/13), not by these base endpoints.** The owner requires all requested features in both account and offline modes; this base slice is a foundation, not the completed event flow. The linked event work includes immutable participant/name/share snapshots, explicit self/payer semantics, equal/manual integer allocations, atomic idempotent saves, and repayment/reversal history. Roster changes must not rewrite event history. Existing accepted debt balances remain separate from the private vault-event ledger. Do not describe roster storage alone as event sync or restrict the full requested feature to offline-only. No paid/free gating or automatic device-data upload is introduced.

## Verification

`npm test` includes authenticated route tests and a shared memory/SQL directory lifecycle. The SQL test applies the original debt migration, seeds an accepted debt, applies the additive migration, verifies owner foreign keys/RLS/grant revocation, and injects failed history writes to prove vault creation/member removal roll back. Existing debt data remains identical. Embedded PostgreSQL tests execute the actual queries but do not prove network/TLS, live Auth, native contacts or production deployment. No deployment is performed here.
