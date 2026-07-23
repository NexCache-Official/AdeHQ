# Voice billing and economics (PR-18.2E)

Voice has two customer-visible meters:

- Live-call minutes are counted once per call session, regardless of human or AI participant count.
- AI Work Hours include billable Brain work, premium voice work, and standard TTS above its per-call starter allowance. Included STT/captions do not add customer Work Hours.

The service-only `voice_usage_ledger` separates:

- `internal_cost_usd`: AdeHQ's provider-neutral COGS.
- `platform_absorbed_usd`: COGS included by the plan.
- `customer_charged_usd` / `customer_charged_wh`: passed-through customer usage.

Standard TTS receives a launch allowance of **$0.02 internal COGS per call**. AdeHQ absorbs actual TTS cost up to that amount; excess actual cost is converted to customer WH during idempotent call settlement. Premium TTS is customer charged. STT records internal cost while customer WH remains zero.

Calendar-month launch allowances are Free 0, Pro 120, Team 500, Business 2,000, and Enterprise `null` (contracted/unlimited). Plan values live under `platform_plan_configs.entitlements.voice` and are editable in AdeHQ Control → Plans.

`live_call_usage_periods` stores monthly counters. `burn_live_call_minutes` atomically inserts one idempotent ledger event and increments the period once. Both billing tables use RLS with no client policies; only service-role code and the service-only RPC can mutate them.

Superadmins can inspect internal COGS, subsidy, customer charges, WH, and minute breakdowns at AdeHQ Control → Voice Economics. Member receipts show duration, customer AI WH, and included transcripts/captions without exposing provider names or STT metering.
