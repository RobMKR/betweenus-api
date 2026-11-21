# Contributor workflow

Read [AGENTS.md](../AGENTS.md) first. Sol implements and Astra independently reviews. This is a manual issue-to-PR process; no unattended dispatcher, OIDC deployment or autonomous agent review is installed. The [manual session bridge](SESSION_BRIDGE.md) can publish already-written PR/review results under scoped Apps after owner setup; it does not perform AI work. Backend deployment remains a separate authorized manual operation. Publishing bridge implementation is tracked in [issue #2](https://github.com/betweenus-tech/betweenus-api/issues/2).

1. Create or select the canonical issue specification using the [work item template](../.github/ISSUE_TEMPLATE/work_item.md). Define the problem, desired behavior/examples, scope/non-goals, numbered AC1/AC2 acceptance criteria, relevant API/data/authorization constraints, verification and unresolved decisions. Detail scales with risk: a simple fix can state a concise problem, expected result, criterion and check; no separate full spec document is required. Mark irrelevant details N/A.
2. Fetch current remote state and create an isolated branch/worktree. For example, from the repository:

   ```sh
   git fetch origin main
   git worktree add -b feat/issue-N-description ../betweenus-api-issue-N origin/main
   ```

3. Inspect existing source, callers, API contracts, storage and tests against the issue before editing. Resolve material ambiguity before dependent implementation; continue useful independent work and record nonblocking assumptions. Capture clarified decisions and material scope/acceptance changes in the issue before implementing them. Implement only that specification in the new worktree. Install dependencies there with `npm ci` if needed; keep credentials in ignored private environment settings.
4. Validate the final change against each acceptance criterion. Commit and push the feature branch, then use the [manual Worker publishing bridge](SESSION_BRIDGE.md) to open a PR referencing `Closes #N` where configured. Map AC IDs to changes and observed checks/results using the [PR template](../.github/pull_request_template.md); explicitly mark unmet criteria, unavailable checks and limitations. Do not push directly to `main`.
5. Astra follows the [review procedure](../.agents/skills/review-pr/SKILL.md) against the exact latest head. Resolve findings on the same branch, then obtain an updated review and affected checks after new commits.
6. Merge only when acceptance, independent review, repository approval rules and required exact-head CI are satisfied and merge is authorized. Do not treat these documents as proof that branch protections exist. Do not use the shared author account to self-approve; record independent reviewer evidence and any formal-approval limitation honestly.

## Verification commands

Node 24 is required. Use focused tests for small code changes; use build and the relevant full suite for domain/auth/storage changes:

```sh
npm ci
npm run build
npm test
npm run format:check
```

`npm test` uses embedded PostgreSQL for SQL/migration behavior. The network PostgreSQL concurrency test requires `DATABASE_URL`; otherwise it explicitly skips. CI supplies PostgreSQL 17, runs `npm run migrate`, then the tests. Live Supabase Auth, TLS, email delivery and production deployment are separate evidence, not implied by this suite. Never point tests at a production database.

For durable integration checks with an isolated test database, export its `DATABASE_URL` privately and run `npm run migrate` before `npm test`. `.env` is not loaded implicitly; [Connect Supabase](CONNECT_SUPABASE.md) documents explicit Node `--env-file` usage. Deployment scripts can be syntax-checked with `for script in deploy/*.sh; do bash -n "$script" || exit; done`; see [EC2 deployment](DEPLOY_EC2.md) before any authorized release.

For documentation-only changes, verify commands against `package.json`, paths/links against source, and format the changed files. The existing format script does not include every hidden template or `AGENTS.md`; check those explicitly with:

```sh
npx prettier --check AGENTS.md .agents/skills/review-pr/SKILL.md .github/ISSUE_TEMPLATE/work_item.md .github/pull_request_template.md docs/CONTRIBUTING.md README.md
```

Do not add tests that only repeat implementation or rerun broad checks without a new reason. PR evidence should make it clear what changed, why it works, and what remains unverified.
