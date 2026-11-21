# Session-agent publishing bridge

Sol implements and Astra independently reviews in the existing ChatGPT session. This bridge performs **no AI execution** and needs no OpenAI API key or separate AI API billing. It publishes already-written session results under the installed GitHub Apps. Normal GitHub Actions usage remains subject to your account's limits/billing. No unattended issue dispatcher, bot branch push, merge action, deployment or OIDC integration is included.

## Owner setup and trust

Install both Apps on this repository. Store these four repository **Actions secrets**, never in source/chat/local agent environment:

| Secret                     | Value                          |
| -------------------------- | ------------------------------ |
| `WORKER_APP_ID`            | `5864822`                      |
| `WORKER_APP_PRIVATE_KEY`   | Worker App's private PEM key   |
| `REVIEWER_APP_ID`          | `5864865`                      |
| `REVIEWER_APP_PRIVATE_KEY` | Reviewer App's private PEM key |

Expected slugs are `robmkr-agent-worker` and `robmkr-agent-reviewer`. Worker installation permissions needed: contents read, issues read, pull requests write. Reviewer: contents read, Actions read, pull requests write. Metadata read is implicit. Tokens are minted for this repository only and revoked by the pinned token action's post step. Do not grant contents write, administration or workflows write to these tokens. Additional installation permissions do not expand the explicitly requested token permissions.

The workflow is usable only after it is reviewed and merged into the default branch. Dispatch on **main** only. Both original actor and rerun actor must have repository `admin` or `maintain` roles, verified through GitHub's API before App tokens are minted. The run must still match the latest main SHA. Maintainers are trusted: these guards do not protect against a malicious maintainer rewriting a workflow that can access repository secrets. Future workflow/bridge/provisioning changes require human maintainer review; do not grant a bot unchecked power to provision itself. Use branch protections and environment/secret policies appropriate to your account; this change does not configure them.

## Dispatch operations

Open **Actions → Session agent publishing bridge → Run workflow**, select **main**, and choose:

1. **auth-check** first: leave other inputs blank/default. Validates expected App ID/slug, installation identifiers and exactly-one-repository token access. Logs identifiers only, never tokens/private keys. This is an authentication check, not proof of review or app behavior.
2. **create-pr** after Sol has already pushed an issue branch: provide `branch`, expected full lowercase 40-character `sha`, open `issue` number, `title`, and actual session-authored `body`. It requires a nondefault same-repository branch at that SHA. Repeated dispatch returns the existing matching open PR rather than duplicating it. GitHub creates PRs from mutable branches, not immutable SHAs: the bridge rechecks immediately before creation and verifies the response; if a concurrent push changes the created head, it reports an error for manual inspection rather than claiming expected-head success.
3. **review** after Astra has actually reviewed: provide `pr`, exact `sha`, the real independent review `body`, and `verdict` (`COMMENT`, `REQUEST_CHANGES`, or `APPROVE`). The bridge does not invent a review or infer approval. It checks an open, non-draft, same-repository PR against the default base and expected head, and binds the submitted review to that immutable commit. Repeated identical verdict/body/head reviews are skipped if the matching review remains in the appropriate state; dismissed approvals do not count.

Approval additionally requires a nonempty set of observed **push/pull_request runs of existing `ci.yml` for the exact head**, all completed successfully (latest attempts returned by the Actions API). Pending/failed/cancelled/missing results block approval; more than 100 runs fails closed for manual inspection. Repository protection rules and independent review requirements still apply. Bot approval is refused for workflow, bridge, `deploy/`, root Dockerfile/compose or EAS provisioning changes, including renames away from those paths; obtain human review instead. Comments/change requests can document findings without green CI.

Example for a maintainer CLI session with workflow-dispatch permission:

```sh
gh workflow run session-bridge.yml --repo RobMKR/betweenus-api --ref main -f action=auth-check
gh run list --repo RobMKR/betweenus-api --workflow session-bridge.yml --limit 5
```

For longer bodies, prefer a JSON input file passed to `gh workflow run --json < dispatch.json` rather than shell interpolation; keep secrets out of dispatch input. There are eight inputs total: `action`, `branch`, `sha`, `issue`, `title`, `body`, `pr`, `verdict`. If CLI/API dispatch returns 403, the session credential lacks the necessary access (Actions write for appropriately scoped credentials; classic-token restrictions may also apply). Use the owner's **Run workflow** UI or correct the credential scope deliberately. Never expose App private keys or use alternate execution to bypass a denied action.

## Boundaries and verification

- The trusted main commit is checked out with stored checkout credentials disabled. No PR/issue-branch code, dependency install or branch scripts execute in the job holding App tokens. Dispatch text travels through environment JSON and API JSON, never interpolated into shell code.
- Workflow runs are serialized per repository to limit duplicate races. Actions concurrency is not a durable queue: newer pending dispatches may replace older pending runs. Inspect run outcomes and rerun intentionally if needed.
- A push between review checks and submission cannot grant approval to a new commit: `commit_id` remains the reviewed SHA. A new head still needs new CI and review before merge. The bridge never merges.
- Commit authorship and push credentials remain separate. Use `Sol Agent <sol@betweenus.invalid>` for non-account agent attribution. Never invent a `users.noreply.github.com` address or guess a GitHub username: it may belong to an unrelated real account. An agent display name is not a verified GitHub bot identity. Existing GitHub connector operations still use their personal account. Only PR/review publication performed by the App token is attributed to the relevant installed bot.
- Backend deployment remains manual. Authenticated requests, release artifacts, database migrations and production credentials are outside this bridge.

Run dependency-free mocked regression checks with Node 24:

```sh
node --test --test-isolation=none .github/bridge/session-bridge.test.mjs
```

CI runs those tests in a separate secret-free job. Mocked tests cover trust/actor validation, stale/fork/draft heads, idempotency, protected-file renames, review state, CI gating, head races and safe errors. They do not prove installed App permissions or a successful live dispatch. After merging, run `auth-check` and record the real outcome before claiming the bridge is operational.
