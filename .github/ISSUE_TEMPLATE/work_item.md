---
name: Work item specification
about: Define the canonical, risk-proportionate specification before implementation
---

This issue is the implementation source of truth. Keep it concise for simple fixes: problem, expected result, acceptance criterion and check are enough; mark irrelevant sections N/A. Add detail for API, authorization, money or durable data changes. Never paste secrets or access tokens.

## Problem

Who is affected and what concrete problem occurs? For bugs, include reproduction and actual behavior.

## Desired behavior and examples

State the expected observable result, including a normal example and relevant invalid/error cases. Explain how behavior differs from today.

## Scope and non-goals

What is included, and what is explicitly outside this change?

## Acceptance criteria

Use numbered, observable criteria so implementation and PR evidence can refer to them.

- [ ] AC1: ...
- [ ] AC2: ...

## Constraints, contracts and data

Relevant API request/response/errors, client compatibility, integer money/currency rules, identity/object authorization, state transitions, history/transactions, schema/migration and rollout/rollback constraints. Describe changes or state N/A; preserve existing behavior unless explicitly changed.

## Verification

Map each AC to focused tests or inspection, expected outcomes and necessary integration evidence. Note dependencies and checks that cannot run; mocks do not prove live Auth/database behavior.

## Unresolved decisions

List material blockers needing clarification before dependent work. Record nonblocking assumptions and the owner/decision needed; use None if settled. Update this issue with clarified decisions and material scope/AC changes before implementation.

## Delivery

Sol inspects the repository and implements on an isolated issue branch; Astra independently reviews the latest head and AC evidence. Link the PR here. Session publishing and deployment remain manual; this template does not dispatch agents or provision services.
