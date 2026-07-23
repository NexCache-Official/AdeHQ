# AdeHQ design system (app source of truth)

There is no separate design-package. **Tokens and primitives in this repo are authoritative** for the product UI. Mintlify may describe product concepts; when CSS and docs disagree, trust the code paths below.

## Tokens

| Layer | File | Role |
|-------|------|------|
| Channel tokens | [`src/app/globals.css`](../../src/app/globals.css) `:root` | `--c-*` as `R G B` channels for Tailwind alpha |
| Hex aliases | same file | `--canvas`, `--ink`, `--accent`, rail chrome (`--rail-*`) |
| Tailwind bridge | [`tailwind.config.ts`](../../tailwind.config.ts) | `canvas`, `surface`, `ink`, `accent`, `rail`, status colors |

**Theme:** light only. Do not introduce a dark theme unless product explicitly asks.

**Current visual system (2026 overhaul):** warm neutral canvas (`#fbfaf8`), near-white rail (`#fefdfd`), charcoal ink/accent (`#241e1a`), Geist + Geist Mono. Source mocks: [`../../new designs/`](../../new%20designs/) (`Home.dc.html`, shared rail across pages).

### Color usage (quick)

- **Canvas / surface / muted** — page and card backgrounds  
- **Ink / ink-2 / ink-3** — primary / secondary / tertiary text  
- **Accent** — primary actions & selection (charcoal; not blue)  
- **Rail** — left workspace chrome (`bg-rail`, `--rail-ink*`)  
- **Green / amber / danger / info** — status

## Typography

| Role | Font | Where |
|------|------|--------|
| UI sans | Geist (`--font-geist-sans`) | `src/app/layout.tsx` via `geist` package |
| Mono labels / meters | Geist Mono (`--font-geist-mono`) | section labels, work hours, badges |
| Serif (rare) | Newsreader | marketing / editorial accents only |

## Layout chrome

| Piece | Where | Notes |
|-------|--------|------|
| App shell | [`src/components/AppShell.tsx`](../../src/components/AppShell.tsx) | `h-screen`; Sidebar + main |
| Left rail | [`src/components/Sidebar.tsx`](../../src/components/Sidebar.tsx) | Pinned header (workspace → work hours → search) + scroll middle + pinned footer (hire + profile). Default width **260px**. |
| Home | [`src/app/(app)/page.tsx`](../../src/app/(app)/page.tsx) | Wired to `Home.dc.html` (hero, stats, workforce + activity) |
| Inbox | [`src/app/(app)/inbox/page.tsx`](../../src/app/(app)/inbox/page.tsx) + `src/components/inbox/*` | Wired to `Inbox.dc.html` (folders pulse, list, reader, compose sheet). Demo seed: `src/lib/inbox/demo-seed.ts` |
| Resizable panes | [`src/components/layout/ResizablePane.tsx`](../../src/components/layout/ResizablePane.tsx) | Side panes only; main work column stays `flex-1` |
| Pane prefs | [`src/lib/layout/pane-prefs.ts`](../../src/lib/layout/pane-prefs.ts) | `localStorage` keys `adehq.pane.*` |

**Rules for agents**

- Prefer `min-w-0` + `truncate` on flex text inside resizable panes.  
- Do not pad pane content to “make room” for drag handles — handles overlay the seam.  
- Collapse is allowed for side rails; never collapse the main work view.
- Match the unified rail from `new designs/*.dc.html` before inventing nav chrome.

## UI primitives

[`src/components/ui.tsx`](../../src/components/ui.tsx) — `Button`, `Card`, `Badge`, `Modal`, `Toggle`, `Kbd`, `Progress`, etc.

Brand marks: [`src/components/brand/Brand.tsx`](../../src/components/brand/Brand.tsx) + [`public/brand/`](../../public/brand/).

Email visual system (transactional): [`../architecture/email-system.md`](../architecture/email-system.md) + `src/emails/` + `public/email/`.

## Scrollbars

Global thin scrollbars in `globals.css`. Prefer `.rail-scroll` / `.pane-scroll` for rail and side panes.

## Design mocks

HTML exports from design tools are **not** runtime source. Reference:

- New overhaul mocks: [`../../new designs/`](../../new%20designs/) (`Home.dc.html`, `Inbox.dc.html`, `Chat.dc.html`, …)
- Older mocks: [`mocks/`](./mocks/) (`AdeHQ_Inbox.dc.html`, `Login.dc.html`)

## Frontend taste (product UI)

When changing branded or marketing surfaces, follow the repo’s frontend constraints. Inside the app shell, **match the new AdeHQ warm-neutral system** (Geist, charcoal accent, shared rail) rather than inventing a parallel language.
