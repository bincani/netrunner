# Settings Menu, Theme, and Hidden Builder Sets — Design

## Overview

Adds a settings menu (cog icon, top right of the nav bar) leading to a new
`/settings` page with two controls: a Light/Dark theme switch, and a
multi-select list of sets to hide from the Collection Builder's card
search. This is the app's first configuration surface — today every page
hardcodes a single dark palette with no user-adjustable settings at all.

## Scope

In scope:
- A `SettingsMenu` nav component (cog icon, dropdown, mirrors the existing
  `ReportsNavDropdown` pattern) linking to `/settings`.
- A `/settings` page with a **Theme** section (Light/Dark) and a **Hide
  Sets from Builder** section (searchable multi-select checkbox list of
  every set).
- A full light-mode re-skin: every component that currently hardcodes dark
  colors gets a light-mode equivalent, via a small set of semantic color
  tokens (not inline `dark:`-prefixing of every individual class).
- Theme preference persisted in the browser (`localStorage`), applied
  before first paint to avoid a flash of the wrong theme.
- Hidden-set list persisted in the database (one new table), enforced
  server-side in `searchCards` so the Collection Builder's search results
  transparently exclude cards from hidden sets.

Out of scope:
- Per-user settings — this remains a single-user, no-login app; there's
  exactly one theme preference and one hidden-set list, not per-account.
- An "Auto/System" theme option that follows OS preference — Light/Dark
  are both explicit, user-selected choices.
- Hiding sets from anywhere other than Builder search. The dashboard and
  a hidden set's own `/sets/[packCode]` page are unaffected — you can
  still browse the set and edit owned quantities directly; "hidden" only
  means it won't surface in Builder's search-as-you-add-to-collection flow.
- Cross-device sync of the theme preference — it's intentionally
  per-browser/device (`localStorage`), unlike the hidden-set list, which
  is collection data and stays consistent everywhere via the database.

## Data model

One new table:

```prisma
model HiddenBuilderPack {
  packCode String @id
  pack     Pack   @relation(fields: [packCode], references: [code])
}
```

A pack's presence in this table means "excluded from Builder search."
`Pack` gains the inverse relation field. Requires a new Prisma migration.

## Theme system

No component today has a light-mode variant — colors like `bg-neutral-900`,
`border-neutral-700`, and `text-neutral-100` repeat verbatim across roughly
a dozen files. Prefixing every individual occurrence with `dark:` would
double every className and create a maintenance trap (fixing one color
means hunting down every copy). Instead, this introduces a small set of
**semantic color tokens** via Tailwind v4's CSS `@theme`, each redefined
under a `.dark` class selector:

| Token (Tailwind class) | Purpose | Dark value (today's look) | Light value |
|---|---|---|---|
| `bg-app` | Page background | `neutral-950` | `white` |
| `bg-surface` | Cards, inputs, dropdowns, popups | `neutral-900` | `white` |
| `bg-surface-hover` | Hover state for surface elements | `neutral-800` | `neutral-100` |
| `border-default` | Standard borders | `neutral-700` | `neutral-300` |
| `border-subtle` | Dimmer borders (dividers, dimmed/missing-card borders) | `neutral-800` | `neutral-200` |
| `text-primary` | Main content text | `neutral-100` | `neutral-900` |
| `text-muted` | Secondary text (faction names, counts, nav links) | `neutral-400` | `neutral-600` |
| `text-faint` | De-emphasized text (legends, disabled controls, zero-count filter options) | `neutral-500` | `neutral-400` |

Accent colors (blue for active/selected states and links, red for errors
and the under-owned highlight, green for success messages, yellow for the
unique-card marker) are **not** tokenized — they stay as direct Tailwind
classes unchanged, since mid-tone accent colors read acceptably against
both a near-black and a white surface without remapping.

Every component currently using the raw `neutral-*` classes covered by
the table above is migrated to the corresponding semantic class (e.g.
`bg-neutral-900` → `bg-surface`). Files affected: `layout.tsx`, dashboard
`page.tsx`, `SetProgressList.tsx`, `builder/CardBuilderForm.tsx`,
`sets/[packCode]/page.tsx`, `SetCardGrid.tsx`, `SetCardFilterSidebar.tsx`,
`reports/sets-missing-image/page.tsx`, `CardDetailPopup.tsx`,
`CardThumbnail.tsx`, `SetCoverImage.tsx`, `SetThumbnail.tsx`,
`ReportsNavDropdown.tsx`.

**Mechanism:** a `dark` class on `<html>`, toggled by the Theme control on
`/settings` and persisted to `localStorage` under a single key. An inline,
non-module `<script>` in `<head>` (rendered by `layout.tsx`) reads that key
synchronously and applies the class before first paint — the standard
technique to avoid a flash of the wrong theme, since the server can't know
a browser's stored preference ahead of time. Default when unset: dark,
matching today's look for every existing user.

The Theme control itself needs no server round-trip and no React context —
it's a plain client component that, on click, updates `localStorage` and
toggles the class on `document.documentElement` directly, reading the
current value from `document.documentElement.classList` on mount for its
initial selected state.

## Settings menu

New `SettingsMenu` component in `src/components/`, structurally mirroring
`ReportsNavDropdown.tsx`: a button (cog icon, `aria-label="Settings"`)
toggles a `role="menu"` dropdown containing one item, a "Configuration"
link to `/settings`. Added to `layout.tsx`'s nav bar, pushed to the right
via `justify-between` (Dashboard/Builder/Reports stay left-aligned).

## `/settings` page

A server component (`src/app/settings/page.tsx`) fetches every pack
(`prisma.pack.findMany`) plus the current `HiddenBuilderPack` rows, and
renders a client form with two sections:

- **Theme** — Light/Dark buttons as described above.
- **Hide Sets from Builder** — a checkbox per set, pre-checked for
  currently-hidden ones, with a text filter above the list (reusing the
  case-insensitive name-filter pattern already built for the dashboard's
  set list, since scrolling through ~75 unfiltered sets is unwieldy).
  Saving calls a new server action,
  `updateHiddenBuilderPacks(packCodes: string[])` (in
  `src/actions/settingsActions.ts`), which replaces the full hidden-set
  list in one transaction (delete all existing rows, insert the new set) —
  simplest to reason about given the table only ever holds a subset of ~75
  rows.

## Builder search filtering

`searchCards` (`src/lib/cards.ts`) excludes any card whose `packCode`
appears in `HiddenBuilderPack`, enforced directly in its Prisma query
(`packCode: { notIn: hiddenPackCodes }`). `CardBuilderForm` and the
`/api/cards/search` route need no changes — filtering happens transparently
inside `searchCards` itself.

## Testing

- `searchCards`: extend `cards.test.ts` to verify a card in a hidden pack
  is excluded from results, and unaffected when no packs are hidden.
- `updateHiddenBuilderPacks`: a DB-backed test (matching the existing
  `createTestDb`/`seedCard` pattern) verifying it replaces the full list
  correctly — adding, removing, and clearing hidden packs.
- `SettingsMenu`: open/close and link behavior, matching how
  `ReportsNavDropdown.test.tsx` already tests its own dropdown.
- Theme control: clicking Light/Dark updates `document.documentElement`'s
  class list and `localStorage`, and reflects the current value correctly
  on mount for both starting states.
- `/settings` page's hidden-sets form: checkbox toggling, the name filter,
  and that saving calls the server action with the expected pack-code list
  (mocking the action, matching how `CardBuilderForm.test.tsx` mocks
  `addToCollection`).
- No dedicated tests for the color-token migration itself (a CSS/visual
  change) — verified by the existing component test suite continuing to
  pass (structure/behavior unchanged, only class names change) plus a
  manual/structural check against real rendered output, since no headless
  browser is available in this environment for true visual QA.
