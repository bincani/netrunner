# Under-Owned Cards Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a report, reachable from the Reports nav dropdown, listing every card the user owns some copies of but fewer than a full playset — grouped by set.

**Architecture:** A single new query function in the existing `src/lib/reports.ts` (same per-pack-loop shape as `computeAllSetsCompletion`/`listPacksMissingImage`) backs a new server-rendered report page at `/reports/under-owned-cards`, following the existing `/reports/sets-missing-image` page's structure exactly.

**Tech Stack:** Next.js (App Router) server components, Prisma/SQLite, Tailwind CSS, Vitest.

## Global Constraints

- A card qualifies when `quantityOwned > 0 AND quantityOwned < quantity`. Cards owned zero of are excluded (that's "missing," a different concept). Cards with `quantity: null` (no declared printed quantity) are excluded even if partially owned.
- Results are grouped by set (pack), in the same order used by every other set-ordered report in this codebase: `orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }]`. A pack with zero qualifying cards does not appear in the result at all.
- Each set's under-owned cards are sorted by title.
- The report page is `force-dynamic` (reflects live collection state, not a build-time snapshot) — same rationale already documented on the dashboard and `/builder`.
- Card rows use the existing under-owned red highlight (`text-danger`), matching the set page and Deck section's established styling language for "short of what's needed."
- Spec: `docs/superpowers/specs/2026-08-07-under-owned-cards-report-design.md`.

---

### Task 1: `listCardsUnderExpectedQuantity` data layer

**Files:**
- Modify: `src/lib/reports.ts`
- Modify: `src/lib/reports.test.ts`

**Interfaces:**
- Produces (used by Task 2): `interface UnderOwnedCard { code: string; title: string; factionName: string; quantityOwned: number; quantity: number }`, `interface UnderOwnedSet { packCode: string; packName: string; cards: UnderOwnedCard[] }`, and `async function listCardsUnderExpectedQuantity(prisma: PrismaClient): Promise<UnderOwnedSet[]>`.

- [ ] **Step 1: Write the failing tests**

Add `listCardsUnderExpectedQuantity` to the existing import from `./reports` at the top of `src/lib/reports.test.ts`. Then add a new `describe('listCardsUnderExpectedQuantity', ...)` block **nested inside the existing outer `describe('reports', ...)` block** — right before that outer block's closing `})` (after the `'weights overall totals...'` test, i.e. after line 163 in the current file). This file's convention is one shared test DB (`beforeAll`/`afterAll`/`beforeEach` on `prisma`) for every DB-backed report function, declared once on the outer `describe('reports', ...)`; only pure-function tests (`cardContribution`, `groupSetsByCycle`, `releaseYear`, none of which touch the DB) get their own top-level, DB-free `describe` blocks. Do not create a second `createTestDb()` — reuse the outer block's `prisma`:

```ts
  describe('listCardsUnderExpectedQuantity', () => {
    it('includes a card owned less than its printed quantity', async () => {
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
      await incrementOwned(prisma, '01001', 2)

      const sets = await listCardsUnderExpectedQuantity(prisma)

      expect(sets).toEqual([
        {
          packCode: 'core',
          packName: 'core',
          cards: [{ code: '01001', title: 'Card A', factionName: 'anarch', quantityOwned: 2, quantity: 3 }],
        },
      ])
    })

    it('excludes a fully-owned card', async () => {
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
      await incrementOwned(prisma, '01001', 3)

      expect(await listCardsUnderExpectedQuantity(prisma)).toEqual([])
    })

    it('excludes a card owned zero of', async () => {
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })

      expect(await listCardsUnderExpectedQuantity(prisma)).toEqual([])
    })

    it('excludes a partially-owned card with no declared printed quantity', async () => {
      await seedCard(prisma, {
        code: '01001',
        title: 'Draft Card',
        packCode: 'draft',
        packSize: null,
        position: 1,
        quantity: null,
      })
      await incrementOwned(prisma, '01001', 1)

      expect(await listCardsUnderExpectedQuantity(prisma)).toEqual([])
    })

    it('omits a set with no under-owned cards, includes one that has a shortfall', async () => {
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
      await incrementOwned(prisma, '01001', 3)
      await seedCard(prisma, { code: '02001', title: 'Card B', packCode: 'genesis1', packSize: 1, position: 1, quantity: 2 })
      await incrementOwned(prisma, '02001', 1)

      const sets = await listCardsUnderExpectedQuantity(prisma)

      expect(sets.map((s) => s.packCode)).toEqual(['genesis1'])
    })

    it('sorts under-owned cards within a set by title', async () => {
      await seedCard(prisma, { code: '01002', title: 'Zebra Card', packCode: 'core', packSize: 1, position: 2, quantity: 2 })
      await incrementOwned(prisma, '01002', 1)
      await seedCard(prisma, { code: '01001', title: 'Alpha Card', packCode: 'core', packSize: 1, position: 1, quantity: 2 })
      await incrementOwned(prisma, '01001', 1)

      const sets = await listCardsUnderExpectedQuantity(prisma)

      expect(sets[0].cards.map((c) => c.title)).toEqual(['Alpha Card', 'Zebra Card'])
    })
  })
```

This new `describe` block is one of several already inside the outer `describe('reports', ...)` — it does not replace or duplicate that block's own `beforeAll`/`afterAll`/`beforeEach`, it just adds another grouped set of `it`s that run against the same shared `prisma`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/reports.test.ts`
Expected: FAIL — `listCardsUnderExpectedQuantity` is not exported from `./reports`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/reports.ts`:

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

/**
 * Cards owned some copies of but fewer than a full playset, grouped by
 * set. A card with no declared printed quantity is excluded — "under the
 * expected amount" doesn't apply when there's no expected amount. A set
 * with no qualifying cards is omitted entirely.
 */
export async function listCardsUnderExpectedQuantity(prisma: PrismaClient): Promise<UnderOwnedSet[]> {
  const packs = await prisma.pack.findMany({
    orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }],
  })

  const results: UnderOwnedSet[] = []

  for (const pack of packs) {
    const cards = await prisma.card.findMany({
      where: { packCode: pack.code, quantity: { not: null } },
      select: {
        code: true,
        title: true,
        quantity: true,
        faction: { select: { name: true } },
        collectionEntry: { select: { quantityOwned: true } },
      },
      orderBy: { title: 'asc' },
    })

    const underOwned: UnderOwnedCard[] = cards
      .filter((card) => {
        const owned = card.collectionEntry?.quantityOwned ?? 0
        return owned > 0 && owned < card.quantity!
      })
      .map((card) => ({
        code: card.code,
        title: card.title,
        factionName: card.faction.name,
        quantityOwned: card.collectionEntry!.quantityOwned,
        quantity: card.quantity!,
      }))

    if (underOwned.length > 0) {
      results.push({ packCode: pack.code, packName: pack.name, cards: underOwned })
    }
  }

  return results
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/reports.test.ts`
Expected: PASS (all `reports.test.ts` tests, including the 6 new ones).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reports.ts src/lib/reports.test.ts
git commit -m "Add listCardsUnderExpectedQuantity for the under-owned cards report"
```

---

### Task 2: Report page and Reports nav entry

**Files:**
- Create: `src/app/reports/under-owned-cards/page.tsx`
- Modify: `src/components/ReportsNavDropdown.tsx`
- Modify: `src/components/ReportsNavDropdown.test.tsx`

**Interfaces:**
- Consumes: `listCardsUnderExpectedQuantity`, `UnderOwnedSet`, `UnderOwnedCard` (Task 1).

- [ ] **Step 1: Write the failing test for the nav entry**

In `src/components/ReportsNavDropdown.test.tsx`, extend the existing `'clicking the trigger opens the menu with a link to each report'` test (do not add a new `it` block — this test's whole purpose is "a link to each report," so a new report belongs inside it):

```ts
  it('clicking the trigger opens the menu with a link to each report', async () => {
    const user = userEvent.setup()
    render(<ReportsNavDropdown />)

    await user.click(screen.getByRole('button', { name: /reports/i }))

    expect(screen.getByRole('menuitem', { name: 'Sets Missing Image' })).toHaveAttribute(
      'href',
      '/reports/sets-missing-image'
    )
    expect(screen.getByRole('menuitem', { name: 'Under-Owned Cards' })).toHaveAttribute(
      'href',
      '/reports/under-owned-cards'
    )
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ReportsNavDropdown.test.tsx`
Expected: FAIL — no menu item named "Under-Owned Cards" exists yet.

- [ ] **Step 3: Add the nav entry**

In `src/components/ReportsNavDropdown.tsx`, replace:

```ts
const REPORTS = [{ href: '/reports/sets-missing-image', label: 'Sets Missing Image' }]
```

with:

```ts
const REPORTS = [
  { href: '/reports/sets-missing-image', label: 'Sets Missing Image' },
  { href: '/reports/under-owned-cards', label: 'Under-Owned Cards' },
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/ReportsNavDropdown.test.tsx`
Expected: PASS (all tests in this file).

- [ ] **Step 5: Create the report page**

Create `src/app/reports/under-owned-cards/page.tsx`:

```tsx
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { listCardsUnderExpectedQuantity } from '@/lib/reports'

// Reflects live collection state (owned quantities) — not something to
// freeze into a build-time snapshot. See the dashboard's identical
// rationale.
export const dynamic = 'force-dynamic'

export default async function UnderOwnedCardsReportPage() {
  const sets = await listCardsUnderExpectedQuantity(prisma)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Under-Owned Cards</h1>
        <p className="text-muted">
          {sets.length === 0
            ? "No under-owned cards — every set you've started is either complete or untouched."
            : 'Cards you own some copies of, but fewer than a full playset.'}
        </p>
      </div>

      {sets.length > 0 && (
        <div className="space-y-6">
          {sets.map((set) => (
            <div key={set.packCode} className="space-y-2">
              <Link href={`/sets/${set.packCode}`} className="font-semibold underline hover:text-primary">
                {set.packName}
              </Link>
              <ul className="space-y-1">
                {set.cards.map((card) => (
                  <li key={card.code} className="flex items-center justify-between gap-2 text-danger">
                    <span>
                      {card.title} <span className="text-sm">({card.factionName})</span>
                    </span>
                    <span className="shrink-0 text-sm">
                      {card.quantityOwned} of {card.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 6: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (no test file targets `under-owned-cards/page.tsx` directly, matching this codebase's convention of not unit-testing thin page-level data-fetching wrappers — verified instead by Step 7's manual check), no type errors.

- [ ] **Step 7: Manual check against real local data**

Run `npm run dev`, wait for it to serve, then:
- On any set page (`/sets/<packCode>`) or `/builder`, set a card's owned quantity to a value greater than 0 but less than its printed quantity (e.g. own 2 of a 3-of).
- Visit `/reports/under-owned-cards` (via the Reports ▾ nav dropdown). Confirm that card appears, under its set's heading, showing its title, faction, and `{owned} of {quantity}` in red, and that the set heading links to `/sets/<packCode>`.
- Set that same card's owned quantity to 0. Reload the report — confirm the card (and its set, if it was the only qualifying card) no longer appears.
- Set the card's owned quantity to meet or exceed its printed quantity. Reload the report — confirm it still doesn't appear.
- If every set is either fully owned or untouched, confirm the report shows the empty-state message instead of an empty page.

- [ ] **Step 8: Commit**

```bash
git add src/app/reports/under-owned-cards/page.tsx src/components/ReportsNavDropdown.tsx src/components/ReportsNavDropdown.test.tsx
git commit -m "Add Under-Owned Cards report"
```
