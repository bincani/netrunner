# Under-Owned Cards Report — Design

## Overview

A new report, alongside "Sets Missing Image" under the Reports nav
dropdown, that surfaces cards you own *some* copies of but fewer than a
full playset — the "I thought I was done with this set but I'm not"
case. Distinct from set-completion tracking (which already shows overall
percent-owned per set): this report lists the specific cards causing a
set to be short.

## Scope

In scope:
- A card qualifies when it's owned (`quantityOwned > 0`) but short of its
  printed quantity (`quantityOwned < quantity`).
- Cards with no declared printed quantity (`quantity: null` — unsized
  packs, per the existing "unsized pack" concept) are excluded: "under
  the expected amount" doesn't apply when there's no expected amount.
- Cards owned zero of are excluded — those are simply missing, a
  different (already-visible-elsewhere, via the set browser) concept
  from "short of a full playset."
- Results grouped by set, in the same cycle/position order used
  elsewhere (`computeAllSetsCompletion`, `listPacksMissingImage`). A set
  with no qualifying cards doesn't appear at all.
- Each set header links to its set page (`/sets/{packCode}`), matching
  the set browser.
- Each card row shows title, faction, and `{owned} of {quantity}`,
  styled with the same under-owned red highlight already used on the set
  page and in Deck section's per-card list.

Out of scope:
- Zero-owned ("missing") cards — a different report, not requested here.
- Any interaction beyond viewing (no inline quantity editing on this
  page — that already exists on the set page, which this report links
  to).
- Filtering/sorting controls — the set-grouped, cycle-ordered view is
  the only view for this round.

## Data layer

`listCardsUnderExpectedQuantity(prisma)` in `src/lib/reports.ts`, following
the same per-pack-loop pattern as `computeAllSetsCompletion` and
`listPacksMissingImage`:

```ts
export interface UnderOwnedCard {
  code: string
  title: string
  factionName: string
  quantityOwned: number
  quantity: number
}

export interface UnderOwnedSet {
  packCode: string
  packName: string
  cards: UnderOwnedCard[]
}

export async function listCardsUnderExpectedQuantity(
  prisma: PrismaClient
): Promise<UnderOwnedSet[]>
```

For each pack (ordered `[{ cycle: { position: 'asc' } }, { position: 'asc' }]`,
matching every other set-ordered report), query its cards with
`quantity: { not: null }` and their `collectionEntry`, filter to
`0 < quantityOwned < quantity`, sort matching cards by title. Packs with
zero matches are omitted from the result entirely.

## Component

`src/app/reports/under-owned-cards/page.tsx` — server component, same
shape as `src/app/reports/sets-missing-image/page.tsx`: `force-dynamic`
(reflects live collection state), calls `listCardsUnderExpectedQuantity`,
renders an empty state ("No under-owned cards — every set you've started
is either complete or untouched.") when the result is empty, otherwise
one section per set:

- Set header: pack name as a link to `/sets/{packCode}`.
- Card list below it: each row shows title, faction, and
  `{owned} of {quantity}`, in `text-danger` (matching the set page and
  Deck section's existing short-card styling).

`ReportsNavDropdown`'s `REPORTS` array gets a new entry:
`{ href: '/reports/under-owned-cards', label: 'Under-Owned Cards' }`.

## Testing

- `reports.test.ts` (existing file, extended) —
  `listCardsUnderExpectedQuantity` against a real seeded test DB:
  an under-owned card is included, a fully-owned card is excluded, a
  zero-owned card is excluded, a card with `quantity: null` is excluded
  even if partially owned, a set with no qualifying cards doesn't appear
  in the result, and multiple sets come back in cycle/position order.
- No new component test file — the page is a thin server-rendered
  data-fetching wrapper with no client interaction, matching this
  codebase's existing convention of not unit-testing that shape of page
  (`builder/page.tsx`, `reports/sets-missing-image/page.tsx` have none
  either); verified instead by a manual check during implementation.
