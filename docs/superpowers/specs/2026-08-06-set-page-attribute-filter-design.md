# Set Page Attribute Filter — Design

## Overview

The set page (`/sets/[packCode]`) lists every card in a set via
`SetCardGrid`, with an existing All/Owned/Missing filter row above the grid.
This adds a left-hand sidebar that also filters by card attributes —
Faction, Type, Side, and Cost — and absorbs the existing Ownership filter
into the same panel, so there's one unified place to filter a set's cards
instead of two separate filter UIs.

## Scope

In scope:
- A new filter sidebar on `/sets/[packCode]` covering Ownership (existing
  All/Owned/Missing, relocated), Faction, Type, Side, and Cost.
- Multi-select checkboxes for Faction/Type/Side/Cost; OR within a category,
  AND across categories.
- Facet options are derived from the cards actually in the pack being
  viewed (a Runner-only pack shows no "Corp" checkbox), each with a count.
- A category with only one distinct value present is hidden entirely
  (checking it could never change the result).
- Cards with no cost value (e.g. Identities, Agendas) get an explicit
  "No cost" checkbox rather than silently ignoring the Cost filter.
- A "Clear all" action, shown only when a non-default filter is active.
- Responsive layout: full-width, stacked above the grid on narrow screens;
  a sticky ~14rem left column at the `lg:` breakpoint and up.

Out of scope:
- Any change to the dashboard's existing set-type filter
  (`SetProgressList.tsx`) — unrelated page.
- Filtering by strength, influence cost, keywords, or free-text search —
  not requested; can be added later the same way if needed.
- Persisting filter selections across navigation/reload (URL params, etc.)
  — the existing Ownership filter doesn't do this either, so the new
  filters follow the same plain-`useState` precedent.

## Data

No schema or data-layer changes. `PackCardEntry`
(`src/lib/cards.ts`) already carries `factionCode`/`factionName`,
`typeCode`/`typeName`, `sideCode`, and `cost` for every card, and
`SetCardGrid` already receives the full per-pack card list as a client-side
prop. All facet options, counts, and filtering are computed client-side
from that existing list — no new server queries.

## Components

- **`SetCardGrid.tsx`** (modified) — keeps owning filter state, now
  including faction/type/side/cost selections alongside the existing
  ownership filter; computes `visibleCards` by applying all of them; lays
  out sidebar + grid responsively. The existing All/Owned/Missing button
  row is removed from here and becomes the sidebar's first section.
- **`SetCardFilterSidebar.tsx`** (new, colocated in
  `src/app/sets/[packCode]/`) — receives the full unfiltered `cards` list
  (to compute facet options + counts) plus the current filter state and
  setters from `SetCardGrid`; renders each section as a `<fieldset>` with
  a `<legend>`, and a "Clear all" action. Purely presentational/interactive
  — no data fetching of its own.

### Filter state shape

```ts
type OwnershipFilter = 'all' | 'owned' | 'missing'

interface AttributeFilters {
  factionCodes: Set<string>
  typeCodes: Set<string>
  sideCodes: Set<string>
  costs: Set<number | null> // null represents the "No cost" bucket
}
```

### Filtering semantics

For a given category, an empty selection set means "no restriction from
this category" (matches the current Ownership default of `'all'`). A
non-empty set means "card's value must be one of the selected values."
A card must pass every category to be visible — i.e. AND across
categories, OR within one.

## Layout

Mirrors the responsive pattern already used for the dashboard's cycle-jump
nav (`SetProgressList.tsx`), but the sidebar is never hidden on mobile,
since filtering is core functionality here rather than a secondary nav
aid:

- Below `lg:`, the sidebar renders full-width, stacked above the card
  grid (which is itself single-column below `lg:`).
- At `lg:` and up, it becomes a `w-56 shrink-0` sticky left column
  (`lg:sticky lg:top-8 lg:self-start`), matching the existing sidebar's
  sticky behavior elsewhere in the app, and the card grid switches to
  2 columns. Both switches were moved from `sm:` to `lg:` together so the
  sidebar+2-column combination never activates in the cramped
  ~640–830px range.
- The sidebar also caps its height at `lg:` with
  `lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto`, since real sets (e.g.
  Core Set, ~32 checkboxes) can render more filter checkboxes than fit in
  a typical laptop viewport — without the cap, sticky positioning made
  the bottom section (usually Cost) unreachable.

## Testing

Extend `SetCardGrid.test.tsx` (or add a sibling test file for
`SetCardFilterSidebar`) to cover:
- Facet options and counts are computed correctly from the card list.
- OR-within-category and AND-across-category combination logic.
- The "No cost" bucket includes cards with `cost === null` and excludes
  them correctly when unchecked alongside other cost values.
- A category with only one distinct value present renders no checkboxes
  for that category.
- "Clear all" resets every filter (including Ownership) back to default
  and only renders while a non-default filter is active.
- Existing Ownership-filter and quantity-editing tests continue to pass
  unchanged, since that logic is relocating, not changing.
