# BetweenUs API

A small Fastify + TypeScript monolith for friends and family debt acknowledgements. The sibling `betweenus-mobile` repository contains the Expo client. This repository is independently buildable and deployable. Node 24 is required.

## Development starts with the issue specification

Each development issue is the canonical implementation specification: problem, desired behavior with examples, scope/non-goals, numbered acceptance criteria, relevant constraints/contracts/data and authorization changes, verification, and unresolved decisions. Use the [issue template](.github/ISSUE_TEMPLATE/work_item.md) and [contributor workflow](docs/CONTRIBUTING.md).

Sol inspects the repository against that specification before implementing; clarify material blockers before dependent work, record assumptions, and update the issue before implementing material scope or acceptance changes. Keep detail proportional: a simple fix needs a concise problem, expected result, acceptance criterion and check, not a separate full specification document. The flow is issue/spec → isolated implementation branch → Astra independent review → required CI on the latest SHA → authorized merge. The PR maps changes and observed checks to the issue's acceptance criteria.

For bugs, including defects found during implementation/review: report to Astra → Astra immediately files one issue per distinct bug (or links an exact duplicate) → delegates Sol to independently investigate/fix → Sol opens the linked PR → Astra reviews → Sol resolves comments → Astra re-reviews the latest head, approves and merges after passing CI and authorization. Filing records symptoms and expected behavior, not an unverified prescribed cause; optional missing details do not delay it. See the [seven-step bug lifecycle](AGENTS.md#bug-report-to-merge).

## Run the local pilot

```sh
npm ci
npm run dev:demo
```

API: `http://127.0.0.1:3001`. Demo is explicitly enabled, loopback only, and refuses `NODE_ENV=production`. Data is held in memory and disappears when the process stops. Never put this demo behind a public proxy. The production Docker image disables demo mode. `.env.example` documents settings; the app does not load `.env` implicitly. Export variables in your shell or use Node's `--env-file=.env` when invoking compiled code.

Fake bearer tokens are `demo-lender` (`alex@example.com`), `demo-borrower` (`john@example.com`), and `demo-other` (`sam@example.com`). They exist only in demo mode. Headers claiming an email or user ID are never authentication.

```sh
curl http://127.0.0.1:3001/v1/debts \
  -H 'Authorization: Bearer demo-lender' -H 'Content-Type: application/json' \
  -d '{"borrowerEmail":"john@example.com","amountMinor":12550,"currency":"AED","description":"Dinner"}'
```

For step-by-step project connection, email OTP settings and private environment setup, see [Connect Supabase](docs/CONNECT_SUPABASE.md).

## Persistent setup

1. Create a PostgreSQL database under your own account. For local Docker: export a strong `POSTGRES_PASSWORD`, run `docker compose up -d`, then export `DATABASE_URL=postgresql://betweenus:YOUR_PASSWORD@localhost:5432/betweenus` (URL-encode special characters). The named volume keeps data across restarts. Removing the volume deletes data.
2. Run `npm ci && npm run build`, then `npm run migrate`. The migration runner is transactional and records applied filenames under an advisory lock. Production image equivalent: `node dist/migrate.js`, run once as a release step before starting the service. Back up before future schema changes; no automated downgrade is provided.
3. Create a Supabase project and enable confirmed email sign-in. Use an asymmetric signing key (ES256 or RS256); legacy shared-secret HS256 tokens are intentionally unsupported. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (publishable/anon key). Set the auth redirect allowlist for the real client. Configure production email delivery in Supabase before a real pilot.
4. Set `DEMO_MODE=false`, `NODE_ENV=production`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, exact comma-separated `CORS_ORIGINS`, and `HOST=0.0.0.0` behind your host's HTTPS ingress. Port defaults to 3001. Store database credentials only in server secrets. Use your database provider's TLS connection string and trusted certificate settings; do not disable certificate verification.

The API verifies JWT signature, issuer, expiry, algorithm and `authenticated` audience, then calls Supabase `/auth/v1/user` to confirm current identity and confirmed email. Unverified accounts are rejected. Auth outages fail closed. Use a valid Supabase access token as the bearer token. Social login is not configured by this repository. The bundled client currently demonstrates fake local identities; connecting its real sign-in UI is follow-up work.

The database is server-only. The migration enables RLS with no browser policies and revokes `anon` and `authenticated` grants if those Supabase roles exist. Connect the API using the trusted table owner/server database role, never an anon client connection. The API enforces row authorization. Do not expose database credentials in Expo or create direct client table policies. Use a separate database/project per application initially.

## API contract

All `/v1/*` routes require `Authorization: Bearer <token>`. `/health` returns process liveness plus mode and storage; it does not test database or auth connectivity.

| Route                        | Request                                            | Response                                                        |
| ---------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| GET `/v1/me`                 | —                                                  | `{id,email}`                                                    |
| GET `/v1/debts`              | —                                                  | `{debts: Debt[]}`                                               |
| POST `/v1/debts`             | `{borrowerEmail,amountMinor,currency,description}` | 201 `{debt: Debt}`                                              |
| POST `/v1/debts/:id/accept`  | `{}`                                               | `{debt: Debt}`                                                  |
| POST `/v1/debts/:id/dispute` | `{reason}`                                         | `{debt: Debt}`                                                  |
| GET `/v1/balances`           | —                                                  | `{balances:[{currency,receivableMinor,payableMinor,netMinor}]}` |

`Debt` has `id`, `lenderId`, `lenderEmail`, `borrowerEmail`, nullable `borrowerId`, `status` (`pending`, `accepted`, `disputed`), `amountMinor`, `currency`, `description`, ISO timestamps `createdAt`/`updatedAt`, and `history`. Each history entry has `id`, `action` (`created`, `accepted`, `disputed`), `actorId`, `createdAt`, and optional dispute `reason`. No debt or history edit/delete endpoint exists.

AED is the initial explicit currency whitelist. AED 125.50 is integer `12550` minor units. Amounts must be positive integers up to 1,000,000,000 minor units; description is 1–500 characters, reason 1–1000, email at most 254. Email matching trims and lowercases; do not remove plus aliases or provider-specific dots. Self invitations and unknown request fields are rejected. Pending invitations are visible by verified email; once answered, borrower ownership binds to stable user ID. A later owner of the email cannot read the bound debt. Accepted records remain visible after an account changes email.

Only the invited verified borrower may respond, once, from `pending`. A disputed record stays outside balances. Only accepted principal enters balances; there is no settlement/repayment behavior yet. `netMinor = receivableMinor - payableMinor`; currencies are never converted or combined. Authorized lists include the user's own records only. Unknown/inaccessible IDs return 404; lender responses 403; repeated responses 409; malformed input 400; missing/invalid/unverified auth 401. Errors are `{error:{code,message}}`.

## Checks and implementation limits

```sh
npm run build
npm test
npm run format:check
```

Tests cover authorization, untrusted identity headers, validation, response transitions, dispute reasons, balances, bound identity changes, and production SQL executed against embedded PostgreSQL (PGlite). CI also runs migrations and competing-response row-lock tests against PostgreSQL 17 (`DATABASE_URL` enables the network test, otherwise it skips); production networking, TLS, concurrent row-lock behavior and live Supabase credentials need deployment smoke checks. Embedded PostgreSQL does not exercise network connections. No external services were provisioned.

The durable store uses typed columns, indexed scoped authorization queries, and a row lock for the response transaction, which saves state and history atomically. It loads a user's records for totals and does not paginate yet; suitable for a small pilot, add pagination and database aggregation before higher volume. The in-process rate limit is 100 requests per IP per minute and resets on restart; configure a trusted ingress and shared limiting if scaling beyond one instance. Proxy trust is intentionally disabled by default. No payment handling, email invitation delivery, reminder jobs, dispute resolution, instalments, CSV export, or account deletion workflow is implemented.

See [pilot architecture and ownership](docs/PILOT.md) for deployment and next steps.

For an existing Ubuntu EC2 instance, see [EC2 release deployment](docs/DEPLOY_EC2.md). Build the release locally; the server only installs production dependencies.

For development, follow the [issue-to-PR contributor workflow](docs/CONTRIBUTING.md) and [engineering standards](AGENTS.md). Sol implements; Astra independently reviews the latest commit before merge. This process and backend deployments are currently manual.

The [manual session publishing bridge](docs/SESSION_BRIDGE.md) can post actual session-authored PRs and independent reviews under scoped GitHub Apps. It does no AI work, merges or deployments, and requires no AI API billing.

Account saved People and owner-private vault rosters are documented in [People and vault contracts](docs/PEOPLE_VAULTS.md). Apply migration `002_people_vaults.sql` before using the new endpoints. These base routes do not implement account event persistence or grant members access.

[Account events and repayment history](docs/ACCOUNT_EVENTS.md) add owner-private equal/manual splits, idempotent payments/undo, archive/reactivate and separate vault balances. Apply migration `003_account_events.sql` before new code; these records never auto-create confirmed debts or grant roster members account access.
