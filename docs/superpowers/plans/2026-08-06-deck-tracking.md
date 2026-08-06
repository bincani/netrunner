# Deck Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import published NetrunnerDB decklists by URL/ID and show per-deck and per-card ownership completion in a new section on `/builder`, to the right of the existing search form.

**Architecture:** Two new Prisma tables (`Deck`, `DeckCard`, no FK to `Card` so an unknown card code can't fail an import) persist imported decks. A small module fetches and normalizes NetrunnerDB's public decklist API server-side. Ownership is computed by joining a deck's cards against the existing `Card`/`CollectionEntry` tables, reusing the already-existing `cardContribution()` helper. A client component (`DeckSection`) owns the add/remove UI and its own local list state, matching this codebase's established pattern (e.g. `CardBuilderForm`, `SetCardGrid`) of updating local state directly from a server action's return value rather than depending on prop refresh.

**Tech Stack:** Next.js (App Router) server/client components, Prisma/SQLite, Tailwind CSS, Vitest + React Testing Library, `fetch` against NetrunnerDB's public API.

## Global Constraints

- Only NetrunnerDB's **public** decklist endpoint is used: `GET https://netrunnerdb.com/api/2.0/public/decklist/{id}` (verified live — no auth). Private/OAuth-only decks are out of scope.
- `DeckCard.cardCode` has no foreign-key relation to `Card` — an unmatched code must not fail the import; ownership computation reports it as `found: false` instead.
- Re-importing an already-saved deck ID **replaces** its data in place (upsert `Deck`, delete-then-recreate its `DeckCard` rows) — never duplicates or errors.
- Decks are read-only mirrors of what NetrunnerDB has published — no in-app deck editing, no MWL/legality checking, no auto-refresh.
- The fetch to NetrunnerDB happens server-side (inside a `'use server'` action), never directly from the browser.
- Spec: `docs/superpowers/specs/2026-08-06-deck-tracking-design.md`.

---

### Task 1: Data model — `Deck` and `DeckCard`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces (used by Tasks 3, 4): `Deck` (`id Int @id`, `uuid String`, `name String`, `importedAt DateTime`, relation `cards DeckCard[]`) and `DeckCard` (`deckId Int`, `cardCode String`, `quantity Int`, composite `@@id([deckId, cardCode])`), queryable via `prisma.deck.findMany/findUnique/upsert/delete` and `prisma.deckCard.deleteMany/createMany`.

- [ ] **Step 1: Add both models to the schema**

Append to the end of `prisma/schema.prisma`:

```prisma
model Deck {
  id         Int        @id
  uuid       String
  name       String
  importedAt DateTime   @default(now())
  cards      DeckCard[]
}

model DeckCard {
  deckId   Int
  deck     Deck   @relation(fields: [deckId], references: [id], onDelete: Cascade)
  cardCode String
  quantity Int

  @@id([deckId, cardCode])
}
```

`onDelete: Cascade` on `DeckCard.deck` is required so deleting a `Deck` row automatically removes its `DeckCard` rows — without it, deleting a deck with cards would fail a foreign-key check.

- [ ] **Step 2: Generate and apply the migration**

Run: `cd /var/www/netrunner && npx prisma migrate dev --name add_deck_tracking`
Expected: a new folder under `prisma/migrations/` (timestamp-prefixed, ending `_add_deck_tracking`) with `migration.sql` containing `CREATE TABLE "Deck"` and `CREATE TABLE "DeckCard"` statements, applied to `data/netrunner.db`, Prisma client regenerated with no errors.

- [ ] **Step 3: Verify**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "Add Deck and DeckCard tables for deck tracking"
```

---

### Task 2: NetrunnerDB decklist fetching

**Files:**
- Create: `src/lib/netrunnerdb.ts`
- Create: `src/lib/netrunnerdb.test.ts`

**Interfaces:**
- Produces (used by Task 4): `parseDecklistId(input: string): number | null` and `interface NetrunnerDbDecklist { id: number; uuid: string; name: string; cards: Record<string, number> }` plus `async function fetchDecklist(decklistId: number): Promise<NetrunnerDbDecklist>` (throws `Error` with a human-readable message on a non-numeric-resolvable ID being passed in some other form, a non-OK HTTP response, or a `{ success: false }`/empty-`data` response body).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/netrunnerdb.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseDecklistId, fetchDecklist } from './netrunnerdb'

describe('parseDecklistId', () => {
  it('parses a raw numeric id', () => {
    expect(parseDecklistId('12345')).toBe(12345)
  })

  it('parses a full NetrunnerDB decklist URL', () => {
    expect(parseDecklistId('https://netrunnerdb.com/en/decklist/12345-some-deck-name')).toBe(12345)
  })

  it('parses a URL with a trailing slash', () => {
    expect(parseDecklistId('https://netrunnerdb.com/en/decklist/12345-some-deck-name/')).toBe(12345)
  })

  it('trims surrounding whitespace', () => {
    expect(parseDecklistId('  12345  ')).toBe(12345)
  })

  it('returns null for input with no id', () => {
    expect(parseDecklistId('not a decklist')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseDecklistId('')).toBeNull()
  })
})

describe('fetchDecklist', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns the normalized decklist on success', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [{ id: 1, uuid: 'abc-123', name: 'Test Deck', cards: { '01001': 3 } }],
      }),
    })) as unknown as typeof fetch

    const result = await fetchDecklist(1)

    expect(result).toEqual({ id: 1, uuid: 'abc-123', name: 'Test Deck', cards: { '01001': 3 } })
  })

  it('fetches from the exact expected NetrunnerDB URL', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [{ id: 42, uuid: 'x', name: 'D', cards: {} }] }),
    })) as unknown as typeof fetch

    await fetchDecklist(42)

    expect(global.fetch).toHaveBeenCalledWith('https://netrunnerdb.com/api/2.0/public/decklist/42')
  })

  it('throws when the response is not ok', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })) as unknown as typeof fetch

    await expect(fetchDecklist(999)).rejects.toThrow('NetrunnerDB returned 404')
  })

  it('throws when the response reports failure', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: false, data: [] }),
    })) as unknown as typeof fetch

    await expect(fetchDecklist(1)).rejects.toThrow('Decklist not found')
  })

  it('throws when the response has no data', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    })) as unknown as typeof fetch

    await expect(fetchDecklist(1)).rejects.toThrow('Decklist not found')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/netrunnerdb.test.ts`
Expected: FAIL — `netrunnerdb.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/netrunnerdb.ts`:

```ts
/**
 * Extracts a decklist's numeric id from either a raw id ("12345") or a
 * full NetrunnerDB decklist URL ("https://netrunnerdb.com/en/decklist/12345-deck-name").
 */
export function parseDecklistId(input: string): number | null {
  const trimmed = input.trim()

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  const match = trimmed.match(/\/decklist\/(\d+)/)
  return match ? Number(match[1]) : null
}

export interface NetrunnerDbDecklist {
  id: number
  uuid: string
  name: string
  cards: Record<string, number>
}

/** Fetches a published decklist from NetrunnerDB's public API (no auth required). */
export async function fetchDecklist(decklistId: number): Promise<NetrunnerDbDecklist> {
  const response = await fetch(`https://netrunnerdb.com/api/2.0/public/decklist/${decklistId}`)

  if (!response.ok) {
    throw new Error(`NetrunnerDB returned ${response.status}`)
  }

  const body = await response.json()

  if (!body.success || !body.data?.[0]) {
    throw new Error('Decklist not found')
  }

  const decklist = body.data[0]
  return {
    id: decklist.id,
    uuid: decklist.uuid,
    name: decklist.name,
    cards: decklist.cards,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/netrunnerdb.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/netrunnerdb.ts src/lib/netrunnerdb.test.ts
git commit -m "Add NetrunnerDB decklist fetching (id/URL parsing + public API call)"
```

---

### Task 3: Deck ownership computation

**Files:**
- Create: `src/lib/decks.ts`
- Create: `src/lib/decks.test.ts`

**Interfaces:**
- Consumes: `Deck`/`DeckCard` (Task 1), `cardContribution` (already exported from `src/lib/reports.ts`).
- Produces (used by Task 4):

```ts
export interface DeckCardOwnership {
  code: string
  title: string | null
  factionName: string | null
  neededQuantity: number
  ownedQuantity: number
  found: boolean
}

export interface DeckSummary {
  id: number
  uuid: string
  name: string
  importedAt: Date
  ownedCount: number
  totalCount: number
  percentOwned: number
  cards: DeckCardOwnership[]
}

async function getDecksWithOwnership(prisma: PrismaClient): Promise<DeckSummary[]>
async function getDeckWithOwnership(prisma: PrismaClient, id: number): Promise<DeckSummary | null>
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/decks.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { incrementOwned } from './collection'
import { getDecksWithOwnership, getDeckWithOwnership } from './decks'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.deckCard.deleteMany()
  await prisma.deck.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.card.deleteMany()
})

describe('getDecksWithOwnership', () => {
  it('computes aggregate and per-card ownership', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', factionCode: 'anarch' })
    await incrementOwned(prisma, '01001', 2)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma)

    expect(deck.name).toBe('Test Deck')
    expect(deck.totalCount).toBe(3)
    expect(deck.ownedCount).toBe(2)
    expect(deck.percentOwned).toBe(67)
    expect(deck.cards).toEqual([
      { code: '01001', title: 'Card A', factionName: 'anarch', neededQuantity: 3, ownedQuantity: 2, found: true },
    ])
  })

  it("caps a card's contribution at the needed quantity, not what is owned beyond it", async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, '01001', 5)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma)

    expect(deck.ownedCount).toBe(3)
    expect(deck.cards[0].ownedQuantity).toBe(5)
  })

  it('flags a deck card whose code is not in the local card database, without crashing', async () => {
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: 'unknown-code', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma)

    expect(deck.cards[0]).toEqual({
      code: 'unknown-code',
      title: null,
      factionName: null,
      neededQuantity: 3,
      ownedQuantity: 0,
      found: false,
    })
    expect(deck.totalCount).toBe(3)
    expect(deck.ownedCount).toBe(0)
  })

  it('orders decks by most recently imported first', async () => {
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Older', importedAt: new Date('2026-01-01') } })
    await prisma.deck.create({ data: { id: 2, uuid: 'uuid-2', name: 'Newer', importedAt: new Date('2026-02-01') } })

    const decks = await getDecksWithOwnership(prisma)

    expect(decks.map((d) => d.name)).toEqual(['Newer', 'Older'])
  })

  it('returns an empty list when no decks are imported', async () => {
    expect(await getDecksWithOwnership(prisma)).toEqual([])
  })
})

describe('getDeckWithOwnership', () => {
  it('returns the ownership summary for a single deck', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 2 } })

    const deck = await getDeckWithOwnership(prisma, 1)

    expect(deck?.name).toBe('Test Deck')
    expect(deck?.totalCount).toBe(2)
  })

  it('returns null for a deck id that does not exist', async () => {
    expect(await getDeckWithOwnership(prisma, 999)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/decks.test.ts`
Expected: FAIL — `decks.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/decks.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import { cardContribution } from './reports'

export interface DeckCardOwnership {
  code: string
  title: string | null
  factionName: string | null
  neededQuantity: number
  ownedQuantity: number
  found: boolean
}

export interface DeckSummary {
  id: number
  uuid: string
  name: string
  importedAt: Date
  ownedCount: number
  totalCount: number
  percentOwned: number
  cards: DeckCardOwnership[]
}

interface DeckWithCards {
  id: number
  uuid: string
  name: string
  importedAt: Date
  cards: { cardCode: string; quantity: number }[]
}

async function computeDeckSummary(prisma: PrismaClient, deck: DeckWithCards): Promise<DeckSummary> {
  const cardCodes = deck.cards.map((deckCard) => deckCard.cardCode)

  const [cards, collectionEntries] = await Promise.all([
    prisma.card.findMany({ where: { code: { in: cardCodes } }, include: { faction: true } }),
    prisma.collectionEntry.findMany({ where: { cardCode: { in: cardCodes } } }),
  ])

  const cardByCode = new Map(cards.map((card) => [card.code, card]))
  const ownedByCode = new Map(collectionEntries.map((entry) => [entry.cardCode, entry.quantityOwned]))

  let ownedCount = 0
  let totalCount = 0

  const cardOwnership: DeckCardOwnership[] = deck.cards.map((deckCard) => {
    const card = cardByCode.get(deckCard.cardCode)
    const ownedQuantity = ownedByCode.get(deckCard.cardCode) ?? 0

    totalCount += deckCard.quantity
    ownedCount += cardContribution(ownedQuantity, deckCard.quantity)

    return {
      code: deckCard.cardCode,
      title: card?.title ?? null,
      factionName: card?.faction.name ?? null,
      neededQuantity: deckCard.quantity,
      ownedQuantity,
      found: card !== undefined,
    }
  })

  return {
    id: deck.id,
    uuid: deck.uuid,
    name: deck.name,
    importedAt: deck.importedAt,
    ownedCount,
    totalCount,
    percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
    cards: cardOwnership,
  }
}

export async function getDecksWithOwnership(prisma: PrismaClient): Promise<DeckSummary[]> {
  const decks = await prisma.deck.findMany({ include: { cards: true }, orderBy: { importedAt: 'desc' } })
  return Promise.all(decks.map((deck) => computeDeckSummary(prisma, deck)))
}

export async function getDeckWithOwnership(prisma: PrismaClient, id: number): Promise<DeckSummary | null> {
  const deck = await prisma.deck.findUnique({ where: { id }, include: { cards: true } })
  if (!deck) {
    return null
  }
  return computeDeckSummary(prisma, deck)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/decks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/decks.ts src/lib/decks.test.ts
git commit -m "Add deck ownership computation (getDecksWithOwnership / getDeckWithOwnership)"
```

---

### Task 4: Deck mutations and server actions

**Files:**
- Create: `src/actions/deckMutations.ts`
- Create: `src/actions/deckMutations.test.ts`
- Create: `src/actions/deckActions.ts`

**Interfaces:**
- Consumes: `Deck`/`DeckCard` (Task 1), `parseDecklistId`/`fetchDecklist` (Task 2), `getDeckWithOwnership`/`DeckSummary` (Task 3).
- Produces (used by Task 5): `saveDeck(prisma, id, uuid, name, cards): Promise<void>`, `removeDeck(prisma, id): Promise<void>` (both in `deckMutations.ts`), and the `'use server'` wrappers `importDeck(input: string): Promise<DeckSummary>` and `deleteDeck(id: number): Promise<void>` (both in `deckActions.ts`, imported directly by the client component in Task 5).

- [ ] **Step 1: Write the failing tests for the mutations**

Create `src/actions/deckMutations.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { saveDeck, removeDeck } from './deckMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.deckCard.deleteMany()
  await prisma.deck.deleteMany()
})

describe('saveDeck', () => {
  it('creates a new deck with its cards', async () => {
    await saveDeck(prisma, 1, 'uuid-1', 'Test Deck', { '01001': 3, '01002': 2 })

    const deck = await prisma.deck.findUnique({ where: { id: 1 }, include: { cards: true } })

    expect(deck?.name).toBe('Test Deck')
    expect(deck?.uuid).toBe('uuid-1')
    expect(deck?.cards).toHaveLength(2)
    expect(deck?.cards.find((c) => c.cardCode === '01001')?.quantity).toBe(3)
  })

  it('replaces an existing deck\'s cards rather than appending to them, on re-import', async () => {
    await saveDeck(prisma, 1, 'uuid-1', 'Test Deck', { '01001': 3 })

    await saveDeck(prisma, 1, 'uuid-1', 'Test Deck (updated)', { '01002': 1 })

    const deck = await prisma.deck.findUnique({ where: { id: 1 }, include: { cards: true } })
    expect(deck?.name).toBe('Test Deck (updated)')
    expect(deck?.cards.map((c) => c.cardCode)).toEqual(['01002'])
  })
})

describe('removeDeck', () => {
  it('deletes a deck and its cards', async () => {
    await saveDeck(prisma, 1, 'uuid-1', 'Test Deck', { '01001': 3 })

    await removeDeck(prisma, 1)

    expect(await prisma.deck.findUnique({ where: { id: 1 } })).toBeNull()
    expect(await prisma.deckCard.findMany({ where: { deckId: 1 } })).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/actions/deckMutations.test.ts`
Expected: FAIL — `deckMutations.ts` does not exist yet.

- [ ] **Step 3: Write the mutations**

Create `src/actions/deckMutations.ts`:

```ts
import type { PrismaClient } from '@prisma/client'

export async function saveDeck(
  prisma: PrismaClient,
  id: number,
  uuid: string,
  name: string,
  cards: Record<string, number>
): Promise<void> {
  await prisma.deck.upsert({
    where: { id },
    create: { id, uuid, name },
    update: { uuid, name },
  })

  await prisma.$transaction([
    prisma.deckCard.deleteMany({ where: { deckId: id } }),
    prisma.deckCard.createMany({
      data: Object.entries(cards).map(([cardCode, quantity]) => ({ deckId: id, cardCode, quantity })),
    }),
  ])
}

export async function removeDeck(prisma: PrismaClient, id: number): Promise<void> {
  await prisma.deck.delete({ where: { id } })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/actions/deckMutations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the server-action wrappers**

Create `src/actions/deckActions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { parseDecklistId, fetchDecklist } from '@/lib/netrunnerdb'
import { getDeckWithOwnership, type DeckSummary } from '@/lib/decks'
import { saveDeck, removeDeck } from './deckMutations'

export async function importDeck(input: string): Promise<DeckSummary> {
  const decklistId = parseDecklistId(input)
  if (decklistId === null) {
    throw new Error('Enter a valid NetrunnerDB decklist URL or ID')
  }

  const decklist = await fetchDecklist(decklistId)
  await saveDeck(prisma, decklist.id, decklist.uuid, decklist.name, decklist.cards)
  revalidatePath('/builder')

  const summary = await getDeckWithOwnership(prisma, decklist.id)
  if (!summary) {
    throw new Error('Failed to load the imported deck')
  }
  return summary
}

export async function deleteDeck(id: number): Promise<void> {
  await removeDeck(prisma, id)
  revalidatePath('/builder')
}
```

- [ ] **Step 6: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/actions/deckMutations.ts src/actions/deckMutations.test.ts src/actions/deckActions.ts
git commit -m "Add deck save/remove mutations and importDeck/deleteDeck server actions"
```

---

### Task 5: `DeckSection` component

**Files:**
- Create: `src/app/builder/DeckSection.tsx`
- Create: `src/app/builder/DeckSection.test.tsx`

**Interfaces:**
- Consumes: `importDeck`/`deleteDeck` (Task 4), `DeckSummary`/`DeckCardOwnership` (Task 3).
- Produces (used by Task 6): `DeckSection({ initialDecks: DeckSummary[] }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/builder/DeckSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeckSection } from './DeckSection'
import { importDeck, deleteDeck } from '@/actions/deckActions'
import type { DeckSummary } from '@/lib/decks'

vi.mock('@/actions/deckActions', () => ({
  importDeck: vi.fn(),
  deleteDeck: vi.fn(),
}))

const sampleDeck: DeckSummary = {
  id: 1,
  uuid: 'uuid-1',
  name: 'Test Deck',
  importedAt: new Date('2026-01-01'),
  ownedCount: 2,
  totalCount: 3,
  percentOwned: 67,
  cards: [
    { code: '01001', title: 'Card A', factionName: 'Anarch', neededQuantity: 3, ownedQuantity: 2, found: true },
  ],
}

describe('DeckSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows a message when no decks are imported', () => {
    render(<DeckSection initialDecks={[]} />)

    expect(screen.getByText('No decks imported yet.')).toBeInTheDocument()
  })

  it('renders an imported deck with its completion stat and card list', () => {
    render(<DeckSection initialDecks={[sampleDeck]} />)

    expect(screen.getByRole('link', { name: 'Test Deck' })).toHaveAttribute(
      'href',
      'https://netrunnerdb.com/en/decklist/1'
    )
    expect(screen.getByText('2/3 owned (67%)')).toBeInTheDocument()
    expect(screen.getByText('Card A')).toBeInTheDocument()
  })

  it('highlights a card that is short of the needed quantity', () => {
    render(<DeckSection initialDecks={[sampleDeck]} />)

    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).toContain('text-danger')
  })

  it('does not highlight a card that is fully owned', () => {
    const fullyOwnedDeck: DeckSummary = {
      ...sampleDeck,
      cards: [{ ...sampleDeck.cards[0], ownedQuantity: 3 }],
    }
    render(<DeckSection initialDecks={[fullyOwnedDeck]} />)

    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).not.toContain('text-danger')
  })

  it('shows an unknown-card label for a card code not found locally', () => {
    const deckWithUnknown: DeckSummary = {
      ...sampleDeck,
      cards: [{ code: 'zzzzz', title: null, factionName: null, neededQuantity: 1, ownedQuantity: 0, found: false }],
    }
    render(<DeckSection initialDecks={[deckWithUnknown]} />)

    expect(screen.getByText('Unknown card (zzzzz)')).toBeInTheDocument()
  })

  it('disables the Add button while the input is empty', () => {
    render(<DeckSection initialDecks={[]} />)

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('importing a deck adds it to the list and clears the input', async () => {
    vi.mocked(importDeck).mockResolvedValue(sampleDeck)
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[]} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), '1')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByRole('link', { name: 'Test Deck' })).toBeInTheDocument())
    expect(importDeck).toHaveBeenCalledWith('1')
    expect(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID')).toHaveValue('')
  })

  it('shows a visible error when import fails', async () => {
    vi.mocked(importDeck).mockRejectedValue(new Error('Decklist not found'))
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[]} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), 'bad-input')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Decklist not found')
  })

  it('re-importing an already-saved deck id replaces it rather than duplicating it', async () => {
    const updatedDeck: DeckSummary = { ...sampleDeck, ownedCount: 3, percentOwned: 100 }
    vi.mocked(importDeck).mockResolvedValue(updatedDeck)
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.type(screen.getByPlaceholderText('NetrunnerDB decklist URL or ID'), '1')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('3/3 owned (100%)')).toBeInTheDocument())
    expect(screen.getAllByRole('link', { name: 'Test Deck' })).toHaveLength(1)
  })

  it('clicking Remove deletes the deck', async () => {
    vi.mocked(deleteDeck).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<DeckSection initialDecks={[sampleDeck]} />)

    await user.click(screen.getByRole('button', { name: 'Remove Test Deck' }))

    expect(screen.queryByRole('link', { name: 'Test Deck' })).not.toBeInTheDocument()
    expect(deleteDeck).toHaveBeenCalledWith(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/builder/DeckSection.test.tsx`
Expected: FAIL — `DeckSection.tsx` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/app/builder/DeckSection.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { importDeck, deleteDeck } from '@/actions/deckActions'
import type { DeckSummary } from '@/lib/decks'

export function DeckSection({ initialDecks }: { initialDecks: DeckSummary[] }) {
  const [decks, setDecks] = useState<DeckSummary[]>(initialDecks)
  const [input, setInput] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleImport() {
    setIsImporting(true)
    setError(null)
    try {
      const summary = await importDeck(input)
      setDecks((prev) => [summary, ...prev.filter((deck) => deck.id !== summary.id)])
      setInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import deck')
    } finally {
      setIsImporting(false)
    }
  }

  async function handleRemove(id: number) {
    const previousDecks = decks
    setDecks((prev) => prev.filter((deck) => deck.id !== id))
    try {
      await deleteDeck(id)
    } catch {
      setDecks(previousDecks)
    }
  }

  return (
    <div className="w-full space-y-6 lg:max-w-md">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Decks</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="NetrunnerDB decklist URL or ID"
            className="flex-1 rounded border border-default bg-surface px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={handleImport}
            disabled={isImporting || input.trim() === ''}
            className="cursor-pointer rounded border border-accent bg-accent/20 px-3 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <ul className="space-y-4">
        {decks.map((deck) => (
          <li key={deck.id} className="space-y-2 rounded border border-default p-3">
            <div className="flex items-start justify-between gap-2">
              <a
                href={`https://netrunnerdb.com/en/decklist/${deck.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline hover:text-primary"
              >
                {deck.name}
              </a>
              <button
                type="button"
                onClick={() => handleRemove(deck.id)}
                aria-label={`Remove ${deck.name}`}
                className="shrink-0 cursor-pointer text-xs text-faint hover:text-danger"
              >
                Remove
              </button>
            </div>

            <div>
              <p className="text-sm text-muted">
                {deck.ownedCount}/{deck.totalCount} owned ({deck.percentOwned}%)
              </p>
              <div className="mt-1 h-2 rounded bg-subtle">
                <div className="h-2 rounded bg-blue-600" style={{ width: `${deck.percentOwned}%` }} />
              </div>
            </div>

            <ul className="space-y-1 text-sm">
              {deck.cards.map((card) => (
                <li
                  key={card.code}
                  className={`flex items-center justify-between gap-2 ${
                    card.ownedQuantity < card.neededQuantity ? 'text-danger' : 'text-muted'
                  }`}
                >
                  <span>{card.found ? card.title : `Unknown card (${card.code})`}</span>
                  <span className="shrink-0">
                    {card.ownedQuantity}/{card.neededQuantity}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}

        {decks.length === 0 && <p className="text-sm text-faint">No decks imported yet.</p>}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/builder/DeckSection.test.tsx`
Expected: PASS (10 tests).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/builder/DeckSection.tsx src/app/builder/DeckSection.test.tsx
git commit -m "Add DeckSection component (add/remove decks, ownership display)"
```

---

### Task 6: Wire `DeckSection` into `/builder`

**Files:**
- Modify: `src/app/builder/page.tsx`

**Interfaces:**
- Consumes: `getDecksWithOwnership` (Task 3), `DeckSection` (Task 5), existing `CardBuilderForm` (unchanged).

- [ ] **Step 1: Replace the page**

Replace the full contents of `src/app/builder/page.tsx` with:

```tsx
import { prisma } from '@/lib/db'
import { getDecksWithOwnership } from '@/lib/decks'
import { CardBuilderForm } from './CardBuilderForm'
import { DeckSection } from './DeckSection'

// Reflects live DB state (owned quantities, imported decks) — not
// something to freeze into a build-time snapshot. See the dashboard's
// identical rationale.
export const dynamic = 'force-dynamic'

export default async function BuilderPage() {
  const decks = await getDecksWithOwnership(prisma)

  return (
    <main className="p-8 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Collection Builder</h1>
      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="min-w-0 flex-1">
          <CardBuilderForm />
        </div>
        <DeckSection initialDecks={decks} />
      </div>
    </main>
  )
}
```

This does not change `CardBuilderForm`'s own props or behavior — `CardBuilderForm.test.tsx`'s tests, which render `<CardBuilderForm />` directly rather than through this page, are unaffected.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test file targets `builder/page.tsx` directly, matching this codebase's existing convention of not unit-testing thin page-level data-fetching wrappers — verified instead by Task 7's manual check).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/builder/page.tsx
git commit -m "Wire DeckSection into /builder, widen the page to a two-column layout"
```

---

### Task 7: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check against the real NetrunnerDB API and real local data**

Run `npm run dev`, wait for it to serve, then:
- On `/builder`, paste `1` (a real, verified-working public decklist: NetrunnerDB id 1, "Tracing a Better World") into the deck input and click Add. Confirm the deck appears with a name, a completion percentage, and a per-card list.
- Paste the same `1` again — confirm it replaces the existing entry rather than adding a second copy.
- Paste a full URL form, e.g. `https://netrunnerdb.com/en/decklist/1-tracing-a-better-world` — confirm it resolves to the same deck.
- Paste something invalid (e.g. `not-a-decklist`) — confirm a visible error appears and nothing is added.
- Click Remove on an imported deck — confirm it disappears, and reloading `/builder` confirms it's actually gone (not just removed from local state).
- Increase your owned quantity for a card in an imported deck (via its set page or Builder search), reload `/builder`, and confirm that deck's completion stat and that card's row updated accordingly.

- [ ] **Step 4: Commit (only if manual checks required a fix)**

If Step 3 surfaced no issues, there is nothing to commit for this task — Task 6's commit already covers the working feature.
