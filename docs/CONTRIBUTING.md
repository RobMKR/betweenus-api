# Contributor workflow

Read [AGENTS.md](../AGENTS.md) first. Sol implements and Astra independently reviews. This is a manual issue-to-PR process; no unattended dispatcher, GitHub App, OIDC deployment or automated agent approval is installed. Backend deployment remains a separate authorized manual operation. Future automation is tracked in [issue #2](https://github.com/RobMKR/betweenus-api/issues/2).

1. Create or select an issue with a concrete problem, acceptance criteria and a risk-appropriate validation plan.
2. Fetch current remote state and create an isolated branch/worktree. For example, from the repository:

   ```sh
   git fetch origin main
   git worktree add -b feat/issue-N-description ../betweenus-api-issue-N origin/main
   ```

3. Implement only that issue in the new worktree. Install dependencies there with `npm ci` if needed. Keep credentials in ignored private environment settings.
4. Validate the final change, commit, push the feature branch and open a PR referencing `Closes #N`. Report actual results and limitations; do not push directly to `main`.
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

For durable integration checks with an isolated test database, export its `DATABASE_URL` privately and run `npm run migrate` before `npm test`. `.env` is not loaded implicitly; [Connect Supabase](CONNECT_SUPABASE.md) documents explicit Node `--env-file` usage. Deployment scripts can be syntax-checked with `bash -n deploy/*.sh`; see [EC2 deployment](DEPLOY_EC2.md) before any authorized release.

For documentation-only changes, verify commands against `package.json`, paths/links against source, and format the changed files. The existing format script does not include every hidden template or `AGENTS.md`; check those explicitly with:

```sh
npx prettier --check AGENTS.md .agents/skills/review-pr/SKILL.md .github/ISSUE_TEMPLATE/work_item.md .github/pull_request_template.md docs/CONTRIBUTING.md README.md
```

Do not add tests that only repeat implementation or rerun broad checks without a new reason. PR evidence should make it clear what changed, why it works, and what remains unverified.
