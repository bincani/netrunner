# Set Page Attribute Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a left-hand sidebar to `/sets/[packCode]` that filters the card list by Faction, Type, Side, and Cost (multi-select, OR within a category / AND across categories), absorbing the existing All/Owned/Missing ownership filter into the same panel.

**Architecture:** A new pure logic module (`attributeFilters.ts`) computes facet options/counts and filter-matching from the existing `PackCardEntry[]` list already passed into `SetCardGrid` — no server/data-layer changes. A new presentational component (`SetCardFilterSidebar.tsx`) renders that logic as checkboxes/buttons. `SetCardGrid.tsx` is modified to own the combined filter state and lay out sidebar + grid responsively.

**Tech Stack:** Next.js (App Router) client components, TypeScript, Tailwind CSS, Vitest + React Testing Library.

## Global Constraints

- No changes to the Prisma schema or `src/lib/cards.ts` — `PackCardEntry` already has every field needed (`factionCode`/`factionName`, `typeCode`/`typeName`, `sideCode`, `cost`).
- Filter state is plain `useState`, not persisted across navigation — matches the existing Ownership filter's precedent.
- A facet category with only one distinct value present in the pack renders no checkboxes for that category.
- Existing tests in `SetCardGrid.test.tsx` must keep passing unmodified — the Ownership buttons keep the same accessible names (`All`/`Owned`/`Missing`) and role (`button`) after relocating into the sidebar.
- Spec: `docs/superpowers/specs/2026-08-06-set-page-attribute-filter-design.md`.

---

### Task 1: Pure attribute-filter logic

**Files:**
- Create: `src/app/sets/[packCode]/attributeFilters.ts`
- Test: `src/app/sets/[packCode]/attributeFilters.test.ts`

**Interfaces:**
- Consumes: `PackCardEntry` from `@/lib/cards` (fields: `factionCode`, `factionName`, `typeCode`, `typeName`, `sideCode`, `cost`).
- Produces (used by Tasks 2 and 3):
  - `type OwnershipFilter = 'all' | 'owned' | 'missing'`
  - `interface AttributeFilters { factionCodes: Set<string>; typeCodes: Set<string>; sideCodes: Set<string>; costs: Set<number | null> }`
  - `createEmptyAttributeFilters(): AttributeFilters`
  - `isAttributeFiltersEmpty(filters: AttributeFilters): boolean`
  - `matchesAttributeFilters(card: PackCardEntry, filters: AttributeFilters): boolean`
  - `interface FacetOption<T> { value: T; label: string; count: number }`
  - `interface CardFacets { factions: FacetOption<string>[]; types: FacetOption<string>[]; sides: FacetOption<string>[]; costs: FacetOption<number | null>[] }`
  - `computeCardFacets(cards: PackCardEntry[]): CardFacets`

- [ ] **Step 1: Write the failing tests**

Create `src/app/sets/[packCode]/attributeFilters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  createEmptyAttributeFilters,
  isAttributeFiltersEmpty,
  matchesAttributeFilters,
  computeCardFacets,
} from './attributeFilters'
import type { PackCardEntry } from '@/lib/cards'

function makeCard(overrides: Partial<PackCardEntry> & Pick<PackCardEntry, 'code' | 'title'>): PackCardEntry {
  return {
    factionCode: 'anarch',
    factionName: 'Anarch',
    typeCode: 'program',
    typeName: 'Program',
    sideCode: 'runner',
    cost: null,
    factionCost: null,
    strength: null,
    deckLimit: null,
    keywords: null,
    text: null,
    uniqueness: false,
    position: 1,
    ownedQuantity: 0,
    ...overrides,
  }
}

describe('createEmptyAttributeFilters / isAttributeFiltersEmpty', () => {
  it('starts empty', () => {
    expect(isAttributeFiltersEmpty(createEmptyAttributeFilters())).toBe(true)
  })

  it('is not empty once a set has a value', () => {
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    expect(isAttributeFiltersEmpty(filters)).toBe(false)
  })
})

describe('matchesAttributeFilters', () => {
  it('matches everything when all filter sets are empty', () => {
    const card = makeCard({ code: '1', title: 'Card' })
    expect(matchesAttributeFilters(card, createEmptyAttributeFilters())).toBe(true)
  })

  it('matches within a category using OR', () => {
    const card = makeCard({ code: '1', title: 'Card', factionCode: 'anarch' })
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    filters.factionCodes.add('shaper')
    expect(matchesAttributeFilters(card, filters)).toBe(true)
  })

  it('excludes a card whose faction is not selected', () => {
    const card = makeCard({ code: '1', title: 'Card', factionCode: 'criminal' })
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    expect(matchesAttributeFilters(card, filters)).toBe(false)
  })

  it('combines categories using AND', () => {
    const card = makeCard({ code: '1', title: 'Card', factionCode: 'anarch', typeCode: 'event' })
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    filters.typeCodes.add('program')
    expect(matchesAttributeFilters(card, filters)).toBe(false)
  })

  it('matches a null cost against the "No cost" bucket', () => {
    const card = makeCard({ code: '1', title: 'Card', cost: null })
    const filters = createEmptyAttributeFilters()
    filters.costs.add(null)
    expect(matchesAttributeFilters(card, filters)).toBe(true)
  })

  it('excludes a null-cost card when only numeric costs are selected', () => {
    const card = makeCard({ code: '1', title: 'Card', cost: null })
    const filters = createEmptyAttributeFilters()
    filters.costs.add(3)
    expect(matchesAttributeFilters(card, filters)).toBe(false)
  })
})

describe('computeCardFacets', () => {
  it('counts and labels each distinct faction, type, side, and cost', () => {
    const cards: PackCardEntry[] = [
      makeCard({ code: '1', title: 'A', factionCode: 'anarch', factionName: 'Anarch', cost: 1 }),
      makeCard({ code: '2', title: 'B', factionCode: 'anarch', factionName: 'Anarch', cost: 1 }),
      makeCard({
        code: '3',
        title: 'C',
        factionCode: 'shaper',
        factionName: 'Shaper',
        typeCode: 'hardware',
        typeName: 'Hardware',
        cost: null,
      }),
    ]

    const facets = computeCardFacets(cards)

    expect(facets.factions).toEqual([
      { value: 'anarch', label: 'Anarch', count: 2 },
      { value: 'shaper', label: 'Shaper', count: 1 },
    ])
    expect(facets.types).toEqual([
      { value: 'hardware', label: 'Hardware', count: 1 },
      { value: 'program', label: 'Program', count: 2 },
    ])
    expect(facets.sides).toEqual([{ value: 'runner', label: 'Runner', count: 3 }])
    expect(facets.costs).toEqual([
      { value: 1, label: '1', count: 2 },
      { value: null, label: 'No cost', count: 1 },
    ])
  })

  it('sorts numeric costs ascending with "No cost" last', () => {
    const cards: PackCardEntry[] = [
      makeCard({ code: '1', title: 'A', cost: 3 }),
      makeCard({ code: '2', title: 'B', cost: null }),
      makeCard({ code: '3', title: 'C', cost: 0 }),
    ]

    const facets = computeCardFacets(cards)

    expect(facets.costs.map((option) => option.label)).toEqual(['0', '3', 'No cost'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/sets/\[packCode\]/attributeFilters.test.ts`
Expected: FAIL — `attributeFilters.ts` does not exist yet (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/app/sets/[packCode]/attributeFilters.ts`:

```ts
import type { PackCardEntry } from '@/lib/cards'

export type OwnershipFilter = 'all' | 'owned' | 'missing'

export interface AttributeFilters {
  factionCodes: Set<string>
  typeCodes: Set<string>
  sideCodes: Set<string>
  costs: Set<number | null>
}

export function createEmptyAttributeFilters(): AttributeFilters {
  return {
    factionCodes: new Set(),
    typeCodes: new Set(),
    sideCodes: new Set(),
    costs: new Set(),
  }
}

export function isAttributeFiltersEmpty(filters: AttributeFilters): boolean {
  return (
    filters.factionCodes.size === 0 &&
    filters.typeCodes.size === 0 &&
    filters.sideCodes.size === 0 &&
    filters.costs.size === 0
  )
}

export function matchesAttributeFilters(card: PackCardEntry, filters: AttributeFilters): boolean {
  if (filters.factionCodes.size > 0 && !filters.factionCodes.has(card.factionCode)) return false
  if (filters.typeCodes.size > 0 && !filters.typeCodes.has(card.typeCode)) return false
  if (filters.sideCodes.size > 0 && !filters.sideCodes.has(card.sideCode)) return false
  if (filters.costs.size > 0 && !filters.costs.has(card.cost)) return false
  return true
}

export interface FacetOption<T> {
  value: T
  label: string
  count: number
}

export interface CardFacets {
  factions: FacetOption<string>[]
  types: FacetOption<string>[]
  sides: FacetOption<string>[]
  costs: FacetOption<number | null>[]
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
}

export function computeCardFacets(cards: PackCardEntry[]): CardFacets {
  const factionCounts = new Map<string, { label: string; count: number }>()
  const typeCounts = new Map<string, { label: string; count: number }>()
  const sideCounts = new Map<string, { label: string; count: number }>()
  const costCounts = new Map<number | null, number>()

  for (const card of cards) {
    const faction = factionCounts.get(card.factionCode)
    factionCounts.set(card.factionCode, { label: card.factionName, count: (faction?.count ?? 0) + 1 })

    const type = typeCounts.get(card.typeCode)
    typeCounts.set(card.typeCode, { label: card.typeName, count: (type?.count ?? 0) + 1 })

    const side = sideCounts.get(card.sideCode)
    sideCounts.set(card.sideCode, { label: capitalize(card.sideCode), count: (side?.count ?? 0) + 1 })

    costCounts.set(card.cost, (costCounts.get(card.cost) ?? 0) + 1)
  }

  const toSortedOptions = (map: Map<string, { label: string; count: number }>): FacetOption<string>[] =>
    [...map.entries()]
      .map(([value, { label, count }]) => ({ value, label, count }))
      .sort((a, b) => a.label.localeCompare(b.label))

  const costs: FacetOption<number | null>[] = [...costCounts.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1
      if (b === null) return -1
      return a - b
    })
    .map(([value, count]) => ({ value, label: value === null ? 'No cost' : String(value), count }))

  return {
    factions: toSortedOptions(factionCounts),
    types: toSortedOptions(typeCounts),
    sides: toSortedOptions(sideCounts),
    costs,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/sets/\[packCode\]/attributeFilters.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/sets/[packCode]/attributeFilters.ts" "src/app/sets/[packCode]/attributeFilters.test.ts"
git commit -m "Add pure attribute-filter logic for the set page"
```

---

### Task 2: `SetCardFilterSidebar` component

**Files:**
- Create: `src/app/sets/[packCode]/SetCardFilterSidebar.tsx`
- Test: `src/app/sets/[packCode]/SetCardFilterSidebar.test.tsx`

**Interfaces:**
- Consumes: everything produced by Task 1 (`AttributeFilters`, `OwnershipFilter`, `createEmptyAttributeFilters`, `isAttributeFiltersEmpty`, `computeCardFacets`), plus `PackCardEntry` from `@/lib/cards`.
- Produces (used by Task 3):
  - `SetCardFilterSidebar(props: { cards: PackCardEntry[]; ownership: OwnershipFilter; onOwnershipChange: (value: OwnershipFilter) => void; attributeFilters: AttributeFilters; onAttributeFiltersChange: (value: AttributeFilters) => void }): JSX.Element`
  - Ownership buttons render with visible text/accessible name exactly `All`, `Owned`, `Missing` (role `button`).
  - Each facet checkbox's accessible name is `"<label> (<count>)"` (e.g. `"Anarch (2)"`), so it can be targeted with `getByRole('checkbox', { name: '...' })`.
  - A "Clear all" button (role `button`, name `Clear all`) renders only when `ownership !== 'all'` or `!isAttributeFiltersEmpty(attributeFilters)`; clicking it calls `onOwnershipChange('all')` and `onAttributeFiltersChange(createEmptyAttributeFilters())`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/sets/[packCode]/SetCardFilterSidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetCardFilterSidebar } from './SetCardFilterSidebar'
import { createEmptyAttributeFilters } from './attributeFilters'
import type { PackCardEntry } from '@/lib/cards'

function makeCard(overrides: Partial<PackCardEntry> & Pick<PackCardEntry, 'code' | 'title'>): PackCardEntry {
  return {
    factionCode: 'anarch',
    factionName: 'Anarch',
    typeCode: 'program',
    typeName: 'Program',
    sideCode: 'runner',
    cost: null,
    factionCost: null,
    strength: null,
    deckLimit: null,
    keywords: null,
    text: null,
    uniqueness: false,
    position: 1,
    ownedQuantity: 0,
    ...overrides,
  }
}

const cards: PackCardEntry[] = [
  makeCard({ code: '1', title: 'A', factionCode: 'anarch', factionName: 'Anarch', cost: 1 }),
  makeCard({
    code: '2',
    title: 'B',
    factionCode: 'shaper',
    factionName: 'Shaper',
    typeCode: 'hardware',
    typeName: 'Hardware',
    cost: 2,
  }),
]

describe('SetCardFilterSidebar', () => {
  it('renders a checkbox with a count for each distinct faction', () => {
    render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={() => {}}
        attributeFilters={createEmptyAttributeFilters()}
        onAttributeFiltersChange={() => {}}
      />
    )

    expect(screen.getByRole('checkbox', { name: 'Anarch (1)' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Shaper (1)' })).toBeInTheDocument()
  })

  it('hides a category with only one distinct value', () => {
    render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={() => {}}
        attributeFilters={createEmptyAttributeFilters()}
        onAttributeFiltersChange={() => {}}
      />
    )

    // Both fixture cards are Runner-side, so Side has only one distinct value.
    expect(screen.queryByText('Side')).not.toBeInTheDocument()
  })

  it('checking a faction checkbox adds it to the filter set', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={() => {}}
        attributeFilters={createEmptyAttributeFilters()}
        onAttributeFiltersChange={handleChange}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: 'Anarch (1)' }))

    expect(handleChange).toHaveBeenCalledTimes(1)
    const updated = handleChange.mock.calls[0][0]
    expect(updated.factionCodes.has('anarch')).toBe(true)
  })

  it('unchecking a previously-selected checkbox removes it from the filter set', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')
    render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={() => {}}
        attributeFilters={filters}
        onAttributeFiltersChange={handleChange}
      />
    )

    await user.click(screen.getByRole('checkbox', { name: 'Anarch (1)' }))

    const updated = handleChange.mock.calls[0][0]
    expect(updated.factionCodes.has('anarch')).toBe(false)
  })

  it('shows "Clear all" only once a filter is active, and resets everything when clicked', async () => {
    const user = userEvent.setup()
    const handleOwnershipChange = vi.fn()
    const handleFiltersChange = vi.fn()
    const filters = createEmptyAttributeFilters()
    filters.factionCodes.add('anarch')

    const { rerender } = render(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={handleOwnershipChange}
        attributeFilters={createEmptyAttributeFilters()}
        onAttributeFiltersChange={handleFiltersChange}
      />
    )
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument()

    rerender(
      <SetCardFilterSidebar
        cards={cards}
        ownership="all"
        onOwnershipChange={handleOwnershipChange}
        attributeFilters={filters}
        onAttributeFiltersChange={handleFiltersChange}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(handleOwnershipChange).toHaveBeenCalledWith('all')
    expect(handleFiltersChange).toHaveBeenCalledTimes(1)
    expect(handleFiltersChange.mock.calls[0][0].factionCodes.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/sets/\[packCode\]/SetCardFilterSidebar.test.tsx`
Expected: FAIL — `SetCardFilterSidebar.tsx` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/app/sets/[packCode]/SetCardFilterSidebar.tsx`:

```tsx
'use client'

import type { PackCardEntry } from '@/lib/cards'
import {
  computeCardFacets,
  createEmptyAttributeFilters,
  isAttributeFiltersEmpty,
  type AttributeFilters,
  type OwnershipFilter,
} from './attributeFilters'

interface SetCardFilterSidebarProps {
  cards: PackCardEntry[]
  ownership: OwnershipFilter
  onOwnershipChange: (value: OwnershipFilter) => void
  attributeFilters: AttributeFilters
  onAttributeFiltersChange: (value: AttributeFilters) => void
}

const OWNERSHIP_OPTIONS: { value: OwnershipFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Missing' },
]

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

const legendClassName = 'mb-1 text-xs font-semibold uppercase text-neutral-500'
const checkboxLabelClassName = 'flex cursor-pointer items-center gap-2 text-sm'

export function SetCardFilterSidebar({
  cards,
  ownership,
  onOwnershipChange,
  attributeFilters,
  onAttributeFiltersChange,
}: SetCardFilterSidebarProps) {
  const facets = computeCardFacets(cards)
  const showClearAll = ownership !== 'all' || !isAttributeFiltersEmpty(attributeFilters)

  function toggleFaction(code: string) {
    onAttributeFiltersChange({ ...attributeFilters, factionCodes: toggleInSet(attributeFilters.factionCodes, code) })
  }

  function toggleType(code: string) {
    onAttributeFiltersChange({ ...attributeFilters, typeCodes: toggleInSet(attributeFilters.typeCodes, code) })
  }

  function toggleSide(code: string) {
    onAttributeFiltersChange({ ...attributeFilters, sideCodes: toggleInSet(attributeFilters.sideCodes, code) })
  }

  function toggleCost(value: number | null) {
    onAttributeFiltersChange({ ...attributeFilters, costs: toggleInSet(attributeFilters.costs, value) })
  }

  return (
    <aside className="w-full shrink-0 space-y-4 sm:sticky sm:top-8 sm:w-56 sm:self-start">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">Filters</h2>
        {showClearAll && (
          <button
            type="button"
            onClick={() => {
              onOwnershipChange('all')
              onAttributeFiltersChange(createEmptyAttributeFilters())
            }}
            className="cursor-pointer text-xs text-blue-400 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <fieldset>
        <legend className={legendClassName}>Ownership</legend>
        <div className="flex flex-wrap gap-2">
          {OWNERSHIP_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onOwnershipChange(option.value)}
              className={`cursor-pointer rounded border px-3 py-1 text-sm ${
                ownership === option.value
                  ? 'border-blue-600 bg-blue-600/20 text-blue-400'
                  : 'border-neutral-700 hover:bg-neutral-800'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {facets.factions.length > 1 && (
        <fieldset>
          <legend className={legendClassName}>Faction</legend>
          <div className="space-y-1">
            {facets.factions.map((option) => (
              <label key={option.value} className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={attributeFilters.factionCodes.has(option.value)}
                  onChange={() => toggleFaction(option.value)}
                />
                <span>
                  {option.label} ({option.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {facets.types.length > 1 && (
        <fieldset>
          <legend className={legendClassName}>Type</legend>
          <div className="space-y-1">
            {facets.types.map((option) => (
              <label key={option.value} className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={attributeFilters.typeCodes.has(option.value)}
                  onChange={() => toggleType(option.value)}
                />
                <span>
                  {option.label} ({option.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {facets.sides.length > 1 && (
        <fieldset>
          <legend className={legendClassName}>Side</legend>
          <div className="space-y-1">
            {facets.sides.map((option) => (
              <label key={option.value} className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={attributeFilters.sideCodes.has(option.value)}
                  onChange={() => toggleSide(option.value)}
                />
                <span>
                  {option.label} ({option.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {facets.costs.length > 1 && (
        <fieldset>
          <legend className={legendClassName}>Cost</legend>
          <div className="space-y-1">
            {facets.costs.map((option) => (
              <label key={option.label} className={checkboxLabelClassName}>
                <input
                  type="checkbox"
                  checked={attributeFilters.costs.has(option.value)}
                  onChange={() => toggleCost(option.value)}
                />
                <span>
                  {option.label} ({option.count})
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </aside>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/sets/\[packCode\]/SetCardFilterSidebar.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/sets/[packCode]/SetCardFilterSidebar.tsx" "src/app/sets/[packCode]/SetCardFilterSidebar.test.tsx"
git commit -m "Add SetCardFilterSidebar component"
```

---

### Task 3: Wire the sidebar into `SetCardGrid`

**Files:**
- Modify: `src/app/sets/[packCode]/SetCardGrid.tsx`
- Modify: `src/app/sets/[packCode]/SetCardGrid.test.tsx`

**Interfaces:**
- Consumes: `SetCardFilterSidebar` and everything from `attributeFilters.ts` (Tasks 1–2).
- Produces: no new exports — `SetCardGrid`'s own props (`{ cards: PackCardEntry[] }`) are unchanged, so `src/app/sets/[packCode]/page.tsx` requires no changes.

- [ ] **Step 1: Write the failing tests**

Append these two tests to the existing `describe('SetCardGrid', ...)` block in `src/app/sets/[packCode]/SetCardGrid.test.tsx` (after the last existing test, before the closing `})`):

```tsx
  it('filters cards by faction using the sidebar', async () => {
    const user = userEvent.setup()
    const mixedCards: PackCardEntry[] = [
      makeCard({ code: '01001', title: 'Card A', factionCode: 'anarch', factionName: 'Anarch' }),
      makeCard({ code: '01002', title: 'Card B', factionCode: 'shaper', factionName: 'Shaper' }),
    ]
    render(<SetCardGrid cards={mixedCards} />)

    await user.click(screen.getByRole('checkbox', { name: 'Anarch (1)' }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
    expect(screen.queryByText('Card B')).not.toBeInTheDocument()
  })

  it('combines the ownership filter and an attribute filter with AND', async () => {
    const user = userEvent.setup()
    const mixedCards: PackCardEntry[] = [
      makeCard({ code: '01001', title: 'Card A', factionCode: 'anarch', factionName: 'Anarch', ownedQuantity: 0 }),
      makeCard({ code: '01002', title: 'Card B', factionCode: 'anarch', factionName: 'Anarch', ownedQuantity: 2 }),
      makeCard({ code: '01003', title: 'Card C', factionCode: 'shaper', factionName: 'Shaper', ownedQuantity: 2 }),
    ]
    render(<SetCardGrid cards={mixedCards} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))
    await user.click(screen.getByRole('checkbox', { name: 'Anarch (2)' }))

    expect(screen.queryByText('Card A')).not.toBeInTheDocument()
    expect(screen.getByText('Card B')).toBeInTheDocument()
    expect(screen.queryByText('Card C')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/app/sets/\[packCode\]/SetCardGrid.test.tsx`
Expected: the two new tests FAIL (no checkboxes render yet — `SetCardGrid` doesn't use the sidebar or attribute filters yet); all pre-existing tests in this file still PASS.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/app/sets/[packCode]/SetCardGrid.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { updateCollectionQuantity } from '@/actions/collectionActions'
import { CardDetailPopup } from '@/components/CardDetailPopup'
import { SetCardFilterSidebar } from './SetCardFilterSidebar'
import {
  createEmptyAttributeFilters,
  matchesAttributeFilters,
  type AttributeFilters,
  type OwnershipFilter,
} from './attributeFilters'
import type { PackCardEntry } from '@/lib/cards'

function parseQuantity(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return null
  return value
}

export function SetCardGrid({ cards }: { cards: PackCardEntry[] }) {
  // What's currently typed in each input, kept as a string so an in-progress
  // edit (e.g. a cleared field, or "-" while typing "-5") can be displayed
  // without being coerced into a number prematurely.
  const [inputValues, setInputValues] = useState<Record<string, string>>(
    Object.fromEntries(cards.map((card) => [card.code, String(card.ownedQuantity)]))
  )
  // The last value confirmed saved to the database, used both to render
  // "owned" state (dimming) and to roll back a failed/invalid edit.
  const [savedQuantities, setSavedQuantities] = useState<Record<string, number>>(
    Object.fromEntries(cards.map((card) => [card.code, card.ownedQuantity]))
  )
  // Pending/error state is tracked per card code, not as one shared flag,
  // so saving one card's quantity doesn't affect any other card's input.
  const [pendingCodes, setPendingCodes] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ownership, setOwnership] = useState<OwnershipFilter>('all')
  const [attributeFilters, setAttributeFilters] = useState<AttributeFilters>(createEmptyAttributeFilters())

  function handleChange(code: string, value: string) {
    setInputValues((prev) => ({ ...prev, [code]: value }))
  }

  async function commit(code: string) {
    const raw = inputValues[code]
    const parsed = parseQuantity(raw)
    const savedValue = savedQuantities[code]

    if (parsed === null) {
      setErrors((prev) => ({ ...prev, [code]: 'Enter a whole number, 0 or more' }))
      setInputValues((prev) => ({ ...prev, [code]: String(savedValue) }))
      return
    }

    // Normalize the display (e.g. "007" -> "7") even when nothing changed.
    setInputValues((prev) => ({ ...prev, [code]: String(parsed) }))

    if (parsed === savedValue) {
      setErrors((prev) => {
        if (!(code in prev)) return prev
        const { [code]: _removed, ...rest } = prev
        return rest
      })
      return
    }

    setPendingCodes((prev) => ({ ...prev, [code]: true }))
    try {
      const updated = await updateCollectionQuantity(code, parsed)
      setSavedQuantities((prev) => ({ ...prev, [code]: updated }))
      setInputValues((prev) => ({ ...prev, [code]: String(updated) }))
      setErrors((prev) => {
        if (!(code in prev)) return prev
        const { [code]: _removed, ...rest } = prev
        return rest
      })
    } catch {
      setErrors((prev) => ({ ...prev, [code]: 'Failed to save — try again' }))
      setInputValues((prev) => ({ ...prev, [code]: String(savedValue) }))
    } finally {
      setPendingCodes((prev) => ({ ...prev, [code]: false }))
    }
  }

  const visibleCards = cards.filter((card) => {
    const owned = savedQuantities[card.code]
    if (ownership === 'owned' && owned === 0) return false
    if (ownership === 'missing' && owned > 0) return false
    return matchesAttributeFilters(card, attributeFilters)
  })

  return (
    <div className="flex flex-col gap-6 sm:flex-row">
      <SetCardFilterSidebar
        cards={cards}
        ownership={ownership}
        onOwnershipChange={setOwnership}
        attributeFilters={attributeFilters}
        onAttributeFiltersChange={setAttributeFilters}
      />

      <div className="min-w-0 flex-1">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visibleCards.map((card) => {
            const owned = savedQuantities[card.code]
            const isSaving = pendingCodes[card.code] === true
            const error = errors[card.code]
            return (
              <li
                key={card.code}
                className={`flex items-center gap-3 rounded border p-3 ${
                  owned > 0 ? 'border-neutral-700' : 'border-neutral-800 opacity-50'
                }`}
              >
                <CardDetailPopup card={card} />
                <div className="flex-1">
                  <div className="font-medium">{card.title}</div>
                  <div className="text-sm text-neutral-400">{card.factionName}</div>
                  {error && (
                    <div className="text-xs text-red-400" role="alert">
                      {error}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <input
                    type="number"
                    min={0}
                    aria-label={`${card.title} owned quantity`}
                    value={inputValues[card.code]}
                    onChange={(event) => handleChange(card.code, event.target.value)}
                    onBlur={() => commit(card.code)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                    }}
                    className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-center"
                  />
                  {isSaving && <span className="text-[10px] text-neutral-500">saving…</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the full test file to verify everything passes**

Run: `npx vitest run src/app/sets/\[packCode\]/SetCardGrid.test.tsx`
Expected: PASS — all pre-existing tests plus the two new ones (17 tests total).

- [ ] **Step 5: Commit**

```bash
git add "src/app/sets/[packCode]/SetCardGrid.tsx" "src/app/sets/[packCode]/SetCardGrid.test.tsx"
git commit -m "Wire the attribute filter sidebar into the set page"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures, no unexpectedly skipped tests.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check in the browser**

Run `npm run dev`, open `/sets/<any packCode with multiple factions/types/costs — e.g. a Core Set>`, and confirm:
- The sidebar appears to the left of the card grid on a desktop-width window, and stacks above the grid on a narrow/mobile-width window.
- Faction/Type/Side/Cost checkboxes show counts, and checking one narrows the grid; checking a second value in the same category widens it back (OR); checking values in two different categories narrows further (AND).
- Switching Ownership (All/Owned/Missing) still works exactly as before, now from inside the sidebar.
- "Clear all" appears only once a filter is active, and clicking it resets every filter.
- A category where every card in the set shares the same value (e.g. Side, on a single-sided pack) renders no checkboxes for that category.

- [ ] **Step 4: Commit (only if manual checks required a fix)**

If Step 3 surfaced no issues, there is nothing to commit for this task — Task 3's commit already covers the working feature.
