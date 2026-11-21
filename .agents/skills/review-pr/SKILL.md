---
name: review-pr
description: Independently review a BetweenUs API pull request against its issue, exact head commit, source behavior and CI evidence before merge.
---

# Independent PR review

Use this procedure when assigned to review a PR. Astra reviews Sol's implementation; do not approve your own work or present author self-checks as independent review.

For each distinct bug discovered in review, Astra immediately files an issue before delegating investigation or implementation to Sol, or links an existing exact duplicate. Capture observed symptoms, available reproduction, expected/actual behavior, platform/context and acceptance criteria; keep unknowns explicit and do not wait for optional details. Do not prescribe an unverified root cause or implementation. Corrections for the already-tracked bug stay with its issue. Sol independently investigates and resolves comments; Astra re-reviews the latest head before approving and performing an authorized merge after CI. Never silently fix code as the reviewer or treat session delegation as an autonomous runner/Sol GitHub account.

1. Read `AGENTS.md`, the linked issue, acceptance criteria and PR description. Verify base/head branches, exact head SHA and all changed filenames. Review in a separate worktree or read-only view; do not mix fixes into the author's worktree.
2. Inspect the full base-to-head diff and relevant surrounding code/callers, tests, contracts and migrations. Trace the concrete user action through authentication, object authorization, validation, transition, storage and response. Check denied/unverified identities, stable borrower binding, integer money/currency, accepted-only balances and atomic history where applicable.
3. For storage/migrations, assess constraints, row locking/races, persisted data compatibility, browser-role access, migration execution, and whether old/new code can coexist or roll back safely. For deployment, check artifact paths and permissions as the service user, private environment preservation, explicit migrations and failure handling. For dependencies/config, inspect the lockfile and trust/secret boundaries. Apply only relevant checks; do not invent scope.
4. Independently run focused verification appropriate to the diff. Inspect actual CI results for the exact head, including the PostgreSQL service path when relevant. Reproduce suspected failures where feasible. Distinguish source-confirmed findings from untested concerns. Do not claim a deployment, live Auth, network database or external delivery was validated by a mock/embedded test.
5. Report actionable findings first. Each finding includes severity, `path:line`, concrete trigger, resulting incorrect behavior, supporting evidence and a source-supported fix direction. Label hypotheses; do not prescribe an unverified diagnosis. Use P0 for immediate critical compromise/data loss, P1 for serious likely production failure/security/integrity defects, P2 for material bounded correctness/maintainability defects, and P3 for minor actionable issues. Keep optional style suggestions separate; omit speculative or duplicate findings.
6. Record reviewed SHA, scope, commands/results, CI status and limitations. If no actionable findings remain, say so without claiming absence of all bugs. Request changes for unresolved material defects. A written independent review can record the result when GitHub cannot accept a formal approval from the shared account; never impersonate another reviewer or self-approve. State that limitation explicitly and obey any repository approval rules.
7. Before Astra approves and performs an authorized merge, re-fetch the head. If it changed, inspect the new diff, verify affected checks and update the reviewed SHA. Require issue acceptance, resolved findings and successful required CI on the latest SHA. Missing CI, failed checks or unavailable required approval block merge; report the exact missing evidence. Review does not itself authorize deployment or external actions.

Suggested review output:

```text
Reviewed head: <sha>
Findings: <severity, file:line, trigger, impact, evidence, fix direction; or none>
Verification: <commands/results and exact-head CI status>
Limits: <unverified integrations or approval limitations>
Recommendation: <changes required / ready subject to stated gates>
```
