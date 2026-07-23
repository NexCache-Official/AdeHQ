# AdeHQ engineering docs (in-repo)

Canonical **product / user / developer** documentation lives in Mintlify:

**[github.com/NexCache-Official/docs](https://github.com/NexCache-Official/docs)**

This folder is the **engineering companion** for AI agents and contributors working in the app repo: architecture notes, design-system map, inbox plans, audits, and ops runbooks.

## Layout

| Path | What belongs here |
|------|-------------------|
| [`architecture/`](./architecture/) | Living system design (inbox foundation, email, intelligence, [AdeHQ Brain](./architecture/adehq-brain.md), [human/hybrid calls](./architecture/human-hybrid-calls.md), [CPU voice worker](./architecture/voice-worker.md), [voice benchmark](./architecture/voice-benchmark.md), [voice Brain fast path](./architecture/voice-brain-fast-path.md), [Maya Workforce Studio](./architecture/workforce-studio.md), known issues) |
| [`product/`](./product/) | Product plans and feature-gap notes not yet in Mintlify |
| [`design-system/`](./design-system/) | How UI tokens + components work in this codebase |
| [`inbox/`](./inbox/) | Inbox-specific proof / slice notes |
| [`audits/`](./audits/) | QA / E2E evaluation logs (living + archive) |
| [`ops/`](./ops/) | How to run agent-driven product tests and similar ops |
| [`billing/`](./billing/) | Commercial policy, entitlement matrix, ledger domain, Revolut contract, promotions, Control Commerce, setup |

## Start here (agents)

1. [`../AGENTS.md`](../AGENTS.md) — stack, conventions, do-not-touch list  
2. [`design-system/README.md`](./design-system/README.md) — tokens, rail, panes, primitives  
3. [`architecture/workspace-inbox-foundation.md`](./architecture/workspace-inbox-foundation.md) — inbox slices  
4. [`../scripts/README.md`](../scripts/README.md) — test / audit / report scripts  

## Audits

- Living product QA log: [`audits/AUDIT_REPORT.md`](./audits/AUDIT_REPORT.md)  
- Historical runtime migration snapshots: [`audits/archive/`](./audits/archive/)  
