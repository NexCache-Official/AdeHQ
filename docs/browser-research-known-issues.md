# Browser research — known issues (parked)

## SiliconFlow + Stagehand LLM incompatibility (diagnosed V20.0.2a)

**Status:** Diagnosed, not solved. **Do not chase** unless product requires SiliconFlow for live browse reasoning.

### Symptom

Live Browserbase runs that use Stagehand `extract()` / `observe()` fail against SiliconFlow with `AI_APICallError: Not Found` (HTTP 404). Auth succeeds (would be 401 if the key were wrong).

### Root cause (plausible)

- Normal AdeHQ AI calls use our **ai v7** stack + `siliconFlowChatModel()` from `src/lib/ai/siliconflow-client.ts`.
- Stagehand v3 uses its **own bundled AI SDK client** (`openai/{model}` + `baseURL`) for `generateObject`.
- That client path does not match what SiliconFlow serves for structured output — endpoint or route mismatch, not missing credentials.

### Current behavior

- Stagehand LLM candidates try SiliconFlow models from the **same model-id list** as `adapters/siliconflow.ts` (not the runtime catalog long-context pick).
- On 404, the provider falls through to **Vercel AI Gateway** (`gateway/openai/gpt-4o-mini`), which succeeds.
- **Live browse reasoning** therefore runs on gateway pricing; **everything else** in AdeHQ stays on SiliconFlow when configured.

### Cost / shadow ledger implication

- Live `browser_research` work-minute and cost estimates must reflect the **provider that actually ran** Stagehand (usually `vercel_gateway` + gateway model id), not SiliconFlow catalog pricing.
- See `stagehandLlmProvider` / `stagehandModelId` on completed run metadata and work-unit completion fields.

### Later / maybe never

- Investigate SiliconFlow OpenAI-compatible `generateObject` / chat-completions parity with Stagehand’s bundled SDK.
- Only worth doing if gateway cost or latency becomes a problem; gateway path is production-viable today.
