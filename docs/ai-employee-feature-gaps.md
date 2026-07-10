# AI Employee Feature Gaps & Roadmap — a CEO's-eye view

**Purpose:** capture what's missing for AI employees to genuinely replace the manual, multi-tool workflow a CEO would otherwise rebuild by hand in ChatGPT/Claude + a pile of other SaaS tools. Written from hands-on testing as a real-estate CEO persona (see `ai-workforce-realestate-test-report.md` for the raw test log this is distilled from), but most of this generalizes to any SMB/startup/services business running a small team of AI + human employees together in AdeHQ.

**Framing:** the bar isn't "can the AI chat about it" — it's "can the AI *do* it, produce a real artifact I can hand to a human, and do it fast enough that delegating to an AI employee is actually less friction than doing it myself." Below is organized by: (1) what's broken today and blocking that bar, (2) what exists but is incomplete, (3) what's missing entirely.

---

## 1. Broken today — fix before anything else

### 1.1 Tool-calling / CRM / structured-effects requests can fail outright (Bug H)
CRM contact/deal creation, task creation via the structured path, and artifact generation all route through a `generateObject`-style structured call that — per this session's testing — burns its token budget on hidden model reasoning and aborts after 100+ seconds, roughly half the time. This is the single most damaging gap: it undermines the entire "AI employee as a real coworker who does real work" pitch. See the test report for full evidence and the recommended fix direction (verify SiliconFlow's thinking-mode toggle for tool-calling requests specifically, or move tool-calling onto the same fast plain-text architecture already proven for conversational replies).

### 1.2 No visible retry / recovery UX when a tool call fails
When "Actions not completed" (or the newer "operation was aborted") banner appears, the only recourse shown is "Ask again to retry" — meaning the user has to notice the failure, re-type essentially the same request, and hope it works the second time. There's no in-place "Retry" button on the failure card itself, no automatic backoff-retry with a faster/smaller model, and no partial-success handling (e.g. if 2 of 3 tool calls in one message succeeded and 1 failed, the user should see exactly which one to redo, not "nothing was saved" — verify this is accurate per-tool-call, not an all-or-nothing rollback message).

### 1.3 No visibility into *why* an employee can't do something
When an employee lacks a granted tool, it says so in the chat reply (good, honest), but there's no proactive UI signal (e.g. a small "Limited tools" badge next to the employee's name, or a settings nudge: "Elena doesn't have CRM access — grant it?") that would help a CEO self-serve instead of discovering the gap mid-conversation, or worse, silently getting a "no CRM tools" excuse when they expected it to just work.

---

## 2. Exists but incomplete

### 2.1 PDF / DOCX / Spreadsheet / Presentation artifacts
`artifact.createPdfReport`, `artifact.createDocx`, `artifact.createSpreadsheet`, `artifact.createPresentation` all exist as integration tools and generate real files saved to Drive. What's untested/unclear from this session (blocked by Bug H, since generation never completed):
- **In-chat PDF preview.** Does the chat bubble show an inline PDF viewer/thumbnail, or only a "generating…" chip that links out to Drive? A CEO on mobile wants to glance at the summary without leaving the conversation.
- **Round-trip editing.** Can the CEO ask "make the intro paragraph shorter" and have the SAME artifact updated in place, or does every edit request regenerate a new file (versioning confusion)?
- **Branded output.** Do generated PDFs/decks carry the company's own branding (logo, colors, letterhead) or are they generic templates? For anything client-facing (a deal summary sent to investors/partners), unbranded output undermines the whole point.

### 2.2 CRM
Contacts, companies, deals, pipeline stage updates, and listing exist as tools. Missing pieces a real estate business specifically would hit immediately:
- **Custom fields / object types.** Real estate deals need property address, square footage, cap rate, closing date, escrow status, 1031 exchange flags — none of which map to a generic "deal" object. Right now the AI has to cram all of this into free-text notes rather than structured, filterable fields.
- **Pipeline views.** Is there a Kanban/pipeline board view of CRM deals (like a lightweight Pipedrive), or only list/chat-based access? A CEO managing 10+ live deals wants a visual board, not just conversational recall.
- **Bulk import.** No way (observed) to import an existing CSV of contacts/deals from a spreadsheet or another CRM — every record has to be created one conversational request at a time.

### 2.3 Tasks
`tasks.createTask` works (confirmed — task creation succeeded even when CRM failed in the same message, showing partial-success IS possible at the tool level, which argues for surfacing that partial success in the UI per 1.2 above). Missing:
- **Recurring tasks** (e.g. "remind me every Monday to check on open escrows").
- **Task dependencies / blocking relationships** (can't model "can't close until title search completes").
- **Assigning a task to a human teammate**, not just an AI employee — the schema has `assigneeType: "human" | "ai"` but nothing in this session's testing exercised assigning to and notifying a real person.

### 2.4 Team collaboration (@mention handoff, team.coordinate)
Works well for what it does — real @mentions only (no hallucinated colleagues, confirmed fixed this session), honest refusal when no one has the right expertise. Missing:
- **Cross-room visibility for the CEO.** When Elena hands off to Sofia in a room, does the CEO get a lightweight notification, or do they have to remember to go check that room later? A real Slack-native CEO expects an @-mention-me-when-it's-done signal.
- **Standing delegation rules** ("always loop in the research employee before pricing decisions") rather than one-off handoffs the CEO has to explicitly request every time.

---

## 3. Missing entirely — the "what should exist" list

### 3.1 Universal artifacts (any industry)
- **E-signature / contract workflow.** Generate a document, route it for signature (DocuSign/HelloSign-style), track status (sent/viewed/signed), and notify when complete. This is the single highest-value "artifact" for any services business (real estate LOIs/purchase agreements, freelance contracts, vendor agreements) and doesn't exist today.
- **Financial model / spreadsheet templates with live formulas**, not just static rows — e.g. a real cap-rate calculator, a runway model, a deal-comparison sheet where changing one input recalculates everything. Today's `artifact.createSpreadsheet` appears to produce static row/column data, not a working formula-driven model.
- **Voice/call summaries.** The UI already has "Call — soon" buttons throughout (workforce calls are clearly planned) — when that ships, auto-generated call summaries + action items as a first-class artifact type, not just chat text, would close the loop with tasks/CRM automatically.
- **Comparison/decision matrices** — a CEO constantly says "compare these 3 options and recommend one" (I tested exactly this — "cap rate vs push for lower price" — and got a good verdict from the model, but it was chat prose, not a structured, shareable, reusable artifact).
- **Slide deck with real design**, not just text-in-boxes — if `artifact.createPresentation` only produces bullet-point text slides, it's not something a CEO would confidently forward to an investor without redoing it.
- **One-click "share externally" for any artifact** — a signed/read-only public link, not just internal Drive access, so a generated PDF/deck can go straight to a client/investor without manual export.

### 3.2 Real-estate-specific (illustrates the "vertical pack" pattern other industries would want too)
- **Property/listing object type** in the CRM (distinct from generic "deal") — address, MLS number, list price, square footage, property type, comps, photos.
- **Deal timeline / calendar auto-population** — closing date, inspection deadline, financing contingency date, 1031 exchange deadline — all extracted from conversation and placed on a shared calendar with reminders, not just mentioned in chat text (I explicitly gave a 1031 deadline in nearly every test message; nothing in this session showed it landing on an actual calendar).
- **Comparable sales / market data lookup as a structured artifact**, not just a cited chat answer — a real CEO wants a saved, reusable "comps sheet," not to re-ask the same market question in three different chats (which is exactly what happened in this session's cap-rate test).
- **Due diligence checklist templates** per deal type (residential purchase, commercial lease, 1031 exchange) that auto-generate the right checklist from a single "this is a 1031 exchange" signal, with tasks pre-populated.

### 3.3 Startup / SMB-general
- **Investor/fundraising CRM** already exists (`investor.*` tools) — good — but there's no equivalent generic "vendor/partner" relationship tracker for SMBs that aren't fundraising.
- **Expense/invoice tracking artifact** — most SMB CEOs' actual daily grind is invoices and expense approval, not deal negotiation; an AI employee that can draft/track invoices and flag anomalies would be extremely high-leverage and is entirely absent today.
- **Competitive intelligence report as a living document** — not a one-time chat answer, but a artifact that gets refreshed/updated on a schedule ("check competitor pricing monthly and update this doc") — ties into the existing `scheduleTopicSummaryRefresh`/background-job infrastructure, which already proves the platform CAN do scheduled background work.
- **Meeting-prep briefs** — "I have a call with X in 10 minutes, brief me" pulling from CRM + memory + recent messages into one scannable artifact — the raw ingredients (CRM, memory, recent messages) all already exist in the prompt-building code; this is a packaging/UX gap, not a new capability.

### 3.4 Platform-level (would improve every artifact/ability above)
- **A generic "generate any document from a template + data" primitive** so new artifact types (property comps sheet, due-diligence checklist, expense report) can be added by defining a template + required fields, not by writing a whole new integration tool each time.
- **Artifact versioning and diffing** — "what changed between this draft and the last one" for any generated document.
- **Cross-artifact linking** — a CRM deal should link to its generated PDF summary, its tasks, its calendar dates, and its source chat thread, all navigable from one place, not four separate systems that happen to share a topic.

---

## Priority read for a real-estate-focused MVP-plus

If forced to rank the highest-leverage next builds specifically for a real-estate CEO persona:

1. **Fix Bug H** (tool-calling reliability) — nothing else matters if CRM/tasks/artifacts silently fail half the time.
2. **E-signature workflow** — the single most valuable missing artifact for this industry (LOIs, purchase agreements).
3. **Deal timeline → calendar auto-population** — every test message in this session had a hard deadline (1031 exchange) that never made it onto an actual calendar.
4. **Property/listing CRM object type + comps-as-artifact** — the generic "deal" object doesn't fit real estate's actual data shape.
5. **PDF/artifact in-chat preview** (once Bug H is fixed and generation actually completes reliably enough to test this UX).
