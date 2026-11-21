# Engineering standards

These instructions apply throughout this repository. Keep changes understandable to the next maintainer and verify claims against the actual source, diff, and command output.

## Ownership and workflow

- Start new development from a GitHub issue with a concrete problem, scope, acceptance criteria and validation plan. Link it in the PR. If scope changes materially, update the issue before expanding work.
- Sol implements; Astra manages and independently reviews. Use an isolated branch and worktree from current `origin/main`; never include unrelated local commits or edit another agent's workspace. Do not push directly to `main`.
- Keep commits and PRs focused. Submit the final diff, exact head SHA, tests run and remaining limitations for review. Do not claim that a check passed unless its result was observed.
- Astra reviews the latest head independently using [.agents/skills/review-pr/SKILL.md](.agents/skills/review-pr/SKILL.md). An author cannot approve their own change. After a new commit, review its changes and rerun affected checks; prior approval is not evidence for the new head.
- Merge only after the issue acceptance criteria are met, actionable review findings are resolved, required CI has succeeded for the exact latest head, and the session authorizes merge. Missing, pending, cancelled or failing required checks are not success. Do not bypass repository protections. Branch protection enforcement must be checked, not assumed.

## Architecture and correctness

- Keep one modular Fastify/TypeScript monolith: routes validate and authenticate, domain code defines invariants, and storage owns persistence. Prefer small existing patterns over new frameworks, services, abstractions or shared platforms without a concrete need.
- Trace user-visible behavior through callers and storage before editing. Preserve API compatibility or coordinate a documented contract change with the client. Do not silently promise notifications, payments, settlement or automation that is not implemented.
- Authenticate verified Supabase identity; never trust client email/user headers. Enforce object authorization on every read and mutation, scoped database queries, and stable user identity after borrower binding. Keep local fake auth explicitly gated and forbidden in production.
- Money stays integer minor units with explicit currency allowlists and bounded input. Pending/disputed principal never enters accepted balances. Preserve the state machine and history; do not silently rewrite agreed amounts.
- State changes and their audit/history record must commit atomically. Use row locks or equivalent concurrency control for competing responses. Test denied access, invalid transitions, concurrent behavior where relevant, and failure paths that could corrupt data.
- Durable changes require versioned migrations, database constraints and compatible application/storage behavior. Plan rolling upgrade and code rollback compatibility; never auto-downgrade schemas. Separate one-time migrations from service startup. Do not expose debt tables to browser roles.

## Security, testing and evidence

- Keep secrets in ignored environment files or server secret settings, never source, issues, logs, bundles or PR descriptions. Publishable keys are not user identity. Redact credentials and tokens; treat database owner credentials, Supabase Auth, reverse proxy headers and deployment scripts as trust boundaries.
- Read untrusted input with bounds; preserve parameterized SQL, safe error messages, request limits and exact CORS origins. Any new dependency must have a clear purpose and a reviewed lockfile change.
- Test the behavior and realistic regressions, including authorization and data integrity, rather than mirroring private implementation. Use the smallest meaningful checks for the risk; docs-only edits generally need formatting, links and command/source verification, not a redundant application test run.
- For code changes, run the relevant focused tests and `npm run build`; run `npm test` for domain/auth/storage changes. Changes to deployment require shell syntax checks and meaningful artifact/permission checks. Explain unavailable integration checks precisely: embedded PostgreSQL is not proof of live network/TLS behavior.
- Report findings with source evidence and practical impact. Record exact commands, outcomes, skipped checks and residual risks. Fix a regression at its cause; avoid unrelated refactors or speculative hardening.

## Operational limits

Issue intake, implementation, independent review and backend deployment are currently manual. Unattended dispatch, automatic agent review, GitHub App permissions and OIDC deployment are not configured. These instructions are a workflow, not a claim of installed automation. Never provision infrastructure, send messages, change credentials or deploy without task authorization. Follow-up automation is tracked in [issue #2](https://github.com/RobMKR/betweenus-api/issues/2). See [contributor workflow](docs/CONTRIBUTING.md).
