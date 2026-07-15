# AdeHQ design system (app source of truth)

There is no separate design-package. **Tokens and primitives in this repo are authoritative** for the product UI. Mintlify may describe product concepts; when CSS and docs disagree, trust the code paths below.

## Tokens

| Layer | File | Role |
|-------|------|------|
| Channel tokens | [`src/app/globals.css`](../../src/app/globals.css) `:root` | `--c-*` as `R G B` channels for Tailwind alpha |
| Hex aliases | same file | `--canvas`, `--ink`, `--accent`, rail chrome (`--rail-*`) |
| Tailwind bridge | [`tailwind.config.ts`](../../tailwind.config.ts) | `canvas`, `surface`, `ink`, `accent`, `rail`, status colors |

**Theme:** light only. Do not introduce a dark theme unless product explicitly asks.

### Color usage (quick)

- **Canvas / surface / muted** — page and card backgrounds  
- **Ink / ink-2 / ink-3** — primary / secondary / tertiary text  
- **Accent** — actions, selection, active rail items  
- **Rail** — left workspace chrome (`bg-rail`, `--rail-ink*`)  
- **Green / amber / danger / info** — status (never purple glow defaults)

## Layout chrome

| Piece | Where | Notes |
|-------|--------|------|
| App shell | [`src/components/AppShell.tsx`](../../src/components/AppShell.tsx) | `h-screen`; Sidebar + main |
| Left rail | [`src/components/Sidebar.tsx`](../../src/components/Sidebar.tsx) | Pinned header (workspace → search) + scroll middle + pinned footer (hire + profile) |
| Resizable panes | [`src/components/layout/ResizablePane.tsx`](../../src/components/layout/ResizablePane.tsx) | Side panes only; main work column stays `flex-1` |
| Pane prefs | [`src/lib/layout/pane-prefs.ts`](../../src/lib/layout/pane-prefs.ts) | `localStorage` keys `adehq.pane.*` |

**Rules for agents**

- Prefer `min-w-0` + `truncate` on flex text inside resizable panes.  
- Do not pad pane content to “make room” for drag handles — handles overlay the seam.  
- Collapse is allowed for side rails; never collapse the main work view.

## UI primitives

[`src/components/ui.tsx`](../../src/components/ui.tsx) — `Button`, `Card`, `Badge`, `Modal`, `Toggle`, `Kbd`, `Progress`, etc.

Brand marks: [`src/components/brand/Brand.tsx`](../../src/components/brand/Brand.tsx) + [`public/brand/`](../../public/brand/).

Email visual system (transactional): [`../architecture/email-system.md`](../architecture/email-system.md) + `src/emails/` + `public/email/`.

## Scrollbars

Global thin scrollbars in `globals.css`. Prefer `.rail-scroll` / `.pane-scroll` for rail and side panes.

## Design mocks

HTML exports from design tools are **not** runtime source. They live under [`mocks/`](./mocks/) for reference only (`AdeHQ_Inbox.dc.html`).

## Frontend taste (product UI)

When changing branded or marketing surfaces, follow the repo’s frontend constraints (brand-first, avoid generic purple/cream AI aesthetics, avoid card clutter in heroes). Inside the app shell, **match existing AdeHQ patterns** rather than inventing a new visual language.
