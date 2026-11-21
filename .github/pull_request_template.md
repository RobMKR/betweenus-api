## Problem and result

Closes #<issue>

The linked issue is the canonical specification. Describe the concrete problem and final behavior; confirm material scope/acceptance changes were recorded there before implementation. Note relevant API/storage/migration compatibility, or N/A.

## Acceptance evidence

Map the issue's actual numbered criteria to changes and observed verification; a concise row suffices for a simple fix. Explicitly mark unmet/blocked criteria rather than claiming completion.

| Issue AC | Change | Check and observed result | Limits / unmet work |
| -------- | ------ | ------------------------- | ------------------- |
| AC1      | ...    | ...                       | ...                 |

List actual commands/results and any skipped checks with reasons. Do not include secrets or imply mocks prove live integrations.

## Review and rollout

- [ ] Sol inspected the issue/source and implemented only its scope in an isolated branch.
- [ ] Blocking decisions are resolved; material changes and assumptions are recorded in the issue.
- [ ] Astra independently reviewed the latest head SHA and AC evidence (record SHA and review result/link).
- [ ] Actionable findings are resolved; required CI succeeds on that same head.
- [ ] Migration/rollback and security implications are addressed, or N/A.

Note residual limitations and authorized manual rollout steps. The session bridge can publish actual session-written PR/review results; it does no AI work. Merge and deployment are separate actions. No unattended dispatch, autonomous review or OIDC deployment is configured.
