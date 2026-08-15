# Discover Decks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bulk-crawl NetrunnerDB's published tournament decklists into a local pool, and add a `/discover` page that shows which of those decks the collection can already build (or nearly build), with a one-click save into the existing "My Decks" list.

**Architecture:** A checkpointed CLI sync script (`npm run sync-decks`) walks NetrunnerDB's `decklists/by_date` endpoint one calendar day at a time, persisting only `tournament_badge: true` decks into two new tables (`TournamentDeck`/`TournamentDeckCard`), separate from the existing curated `Deck`/`DeckCard` tables. A new `getDiscoverDecks()` bulk-computes buildability (reusing the existing `cardContribution` ownership math) with server-side filtering/sorting/pagination, exposed to a new `/discover` client page via a server action (matching how every other interactive data flow in this app already works — action functions called directly from client state, not URL search params).

**Tech Stack:** Next.js (App Router) + TypeScript, SQLite via Prisma, Tailwind CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-discover-decks-design.md`

## Global Constraints

- Every function touching `CollectionEntry` (directly or via ownership computation) takes `collectionId` as an explicit early parameter (right after `prisma`); resolve it via `getDefaultCollectionId(prisma)` (`src/lib/collections.ts`) — never inline a default-collection lookup.
- `Setting` (`src/actions/settingsMutations.ts`, `getSetting`/`setSetting`) is the one place small persisted app state lives — the sync checkpoint is a `Setting` row, not a new table.
- No semicolons, single quotes, 2-space indent — match the existing codebase style exactly (see any file under `src/lib` or `src/actions`).
- Mutation files (`src/actions/*Mutations.ts`) are plain testable functions taking `prisma` as their first parameter. Thin `'use server'` wrapper files (`src/actions/*Actions.ts`) usually aren't unit-tested directly (e.g. `deckActions.ts` has no `deckActions.test.ts`, exercised only via component tests that mock it) — **but this is not a hard rule**: `src/actions/collectionActions.test.ts` unit-tests a `'use server'` module directly (`vi.hoisted` + `vi.mock('@/lib/db', ...)` + `vi.mock('next/cache', ...)`), and any action whose own logic (not just pass-through to a mutation) is worth covering — e.g. a nontrivial data transformation — should get this treatment. (Corrected post-implementation: the final whole-branch review found `discoverActions.ts`'s `saveDiscoveredDeck` needed exactly this and the original wording here wrongly justified skipping it — see `docs/superpowers/specs/2026-08-14-discover-decks-design.md`'s Testing section, which asked for `discoverActions.test.ts` from the start.)
- `DeckCard`/`TournamentDeckCard` deliberately have no foreign key to `Card` — a decklist naming a code this app hasn't imported must not fail a save.
- Card images/data are never fetched client-side; all NetrunnerDB HTTP calls happen server-side (scripts or server actions).

---

### Task 1: `TournamentDeck`/`TournamentDeckCard` schema

**Files:**
- Modify: `prisma/schema.prisma`
- Test: none (schema-only; downstream tasks' tests exercise it)

**Interfaces:**
- Produces: Prisma models `TournamentDeck { id, uuid, name, dateCreation, userName, factionCode, cards }` and `TournamentDeckCard { deckId, cardCode, quantity }`, available on `PrismaClient` as `prisma.tournamentDeck` / `prisma.tournamentDeckCard` for every later task.

- [ ] **Step 1: Add the models to the schema**

Add this block to `prisma/schema.prisma`, directly after the existing `model DeckCard { ... }` block:

```prisma
model TournamentDeck {
  id           Int                  @id // NetrunnerDB's own decklist id, reused directly
  uuid         String
  name         String
  dateCreation DateTime
  userName     String
  factionCode  String?
  cards        TournamentDeckCard[]
}

model TournamentDeckCard {
  deckId   Int
  deck     TournamentDeck @relation(fields: [deckId], references: [id], onDelete: Cascade)
  cardCode String
  quantity Int

  @@id([deckId, cardCode])
}
```

- [ ] **Step 2: Create and apply the migration**

Run: `npx prisma migrate dev --name add_tournament_decks`
Expected: a new folder under `prisma/migrations/` (timestamp-prefixed `add_tournament_decks`), applied to `data/netrunner.db`, and the Prisma client regenerated. This only adds two new empty tables — it does not touch any existing collection/deck data.

- [ ] **Step 3: Verify**

Run: `npx prisma validate && npm test`
Expected: schema validates; the full existing test suite still passes (new tables don't affect anything that reads/writes them yet).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add TournamentDeck/TournamentDeckCard tables for the bulk deck pool"
```

---

### Task 2: Fetch a day's decklists from NetrunnerDB

**Files:**
- Modify: `src/lib/netrunnerdb.ts`
- Test: `src/lib/netrunnerdb.test.ts` (add to existing file)

**Interfaces:**
- Consumes: nothing new (uses global `fetch`, same as the existing `fetchDecklist`).
- Produces: `export interface NetrunnerDbDailyDecklist { id: number; uuid: string; name: string; dateCreation: string; userName: string; tournamentBadge: boolean; cards: Record<string, number> }` and `export async function fetchDecklistsByDate(date: string): Promise<NetrunnerDbDailyDecklist[]>` — used by Task 4's sync loop.

- [ ] **Step 1: Write the failing tests**

Add this to the end of `src/lib/netrunnerdb.test.ts`:

```ts
import { fetchDecklistsByDate } from './netrunnerdb'

describe('fetchDecklistsByDate', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('fetches from the exact expected NetrunnerDB URL', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] }),
    })) as unknown as typeof fetch

    await fetchDecklistsByDate('2022-05-07')

    expect(global.fetch).toHaveBeenCalledWith('https://netrunnerdb.com/api/2.0/public/decklists/by_date/2022-05-07')
  })

  it('normalizes each decklist, including the tournament badge and creation date', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: [
          {
            id: 69743,
            uuid: 'abc-123',
            name: 'virus garbo',
            date_creation: '2022-05-07T04:53:59+00:00',
            user_name: 'momar',
            tournament_badge: true,
            cards: { '01001': 1 },
          },
        ],
      }),
    })) as unknown as typeof fetch

    const result = await fetchDecklistsByDate('2022-05-07')

    expect(result).toEqual([
      {
        id: 69743,
        uuid: 'abc-123',
        name: 'virus garbo',
        dateCreation: '2022-05-07T04:53:59+00:00',
        userName: 'momar',
        tournamentBadge: true,
        cards: { '01001': 1 },
      },
    ])
  })

  it('returns an empty array for a date with no published decklists', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [], total: 0 }),
    })) as unknown as typeof fetch

    expect(await fetchDecklistsByDate('2013-09-01')).toEqual([])
  })

  it('throws when the response is not ok', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch

    await expect(fetchDecklistsByDate('2022-05-07')).rejects.toThrow('NetrunnerDB returned 500')
  })

  it('throws when the response reports failure', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: false }),
    })) as unknown as typeof fetch

    await expect(fetchDecklistsByDate('2022-05-07')).rejects.toThrow(
      'Unexpected response fetching decklists by date'
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/netrunnerdb.test.ts`
Expected: FAIL — `fetchDecklistsByDate is not a function` / import error.

- [ ] **Step 3: Implement `fetchDecklistsByDate`**

Add this to `src/lib/netrunnerdb.ts`, after the existing `fetchDecklist` function:

```ts
export interface NetrunnerDbDailyDecklist {
  id: number
  uuid: string
  name: string
  dateCreation: string
  userName: string
  tournamentBadge: boolean
  cards: Record<string, number>
}

/** Fetches every published decklist for one calendar date ("YYYY-MM-DD") from NetrunnerDB's public API (no auth required). */
export async function fetchDecklistsByDate(date: string): Promise<NetrunnerDbDailyDecklist[]> {
  const response = await fetch(`https://netrunnerdb.com/api/2.0/public/decklists/by_date/${date}`)

  if (!response.ok) {
    throw new Error(`NetrunnerDB returned ${response.status}`)
  }

  const body = await response.json()

  if (!body.success || !Array.isArray(body.data)) {
    throw new Error('Unexpected response fetching decklists by date')
  }

  return body.data.map(
    (entry: {
      id: number
      uuid: string
      name: string
      date_creation: string
      user_name: string
      tournament_badge: boolean
      cards: Record<string, number>
    }) => ({
      id: entry.id,
      uuid: entry.uuid,
      name: entry.name,
      dateCreation: entry.date_creation,
      userName: entry.user_name,
      tournamentBadge: entry.tournament_badge === true,
      cards: entry.cards,
    })
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/netrunnerdb.test.ts`
Expected: PASS, all tests including the existing `fetchDecklist`/`parseDecklistId` ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/netrunnerdb.ts src/lib/netrunnerdb.test.ts
git commit -m "Add fetchDecklistsByDate for the public decklists/by_date endpoint"
```

---

### Task 3: `saveTournamentDeck` mutation

**Files:**
- Create: `src/actions/tournamentDeckMutations.ts`
- Test: `src/actions/tournamentDeckMutations.test.ts`

**Interfaces:**
- Consumes: `prisma.tournamentDeck` / `prisma.tournamentDeckCard` (Task 1).
- Produces: `export interface TournamentDeckInput { id: number; uuid: string; name: string; dateCreation: Date; userName: string; factionCode: string | null; cards: Record<string, number> }` and `export async function saveTournamentDeck(prisma: PrismaClient, deck: TournamentDeckInput): Promise<void>` — used by Task 4's sync loop.

- [ ] **Step 1: Write the failing test**

Create `src/actions/tournamentDeckMutations.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { saveTournamentDeck } from './tournamentDeckMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.tournamentDeckCard.deleteMany()
  await prisma.tournamentDeck.deleteMany()
})

const baseDeck = {
  id: 1,
  uuid: 'uuid-1',
  name: 'Winning Deck',
  dateCreation: new Date('2022-05-07T04:53:59Z'),
  userName: 'alice',
  factionCode: 'anarch',
  cards: { '01001': 3, '01002': 1 },
}

describe('saveTournamentDeck', () => {
  it('creates a new tournament deck with its cards', async () => {
    await saveTournamentDeck(prisma, baseDeck)

    const deck = await prisma.tournamentDeck.findUnique({ where: { id: 1 }, include: { cards: true } })
    expect(deck?.name).toBe('Winning Deck')
    expect(deck?.userName).toBe('alice')
    expect(deck?.factionCode).toBe('anarch')
    expect(deck?.cards).toHaveLength(2)
  })

  it("replaces an existing deck's cards rather than appending, on re-sync", async () => {
    await saveTournamentDeck(prisma, baseDeck)

    await saveTournamentDeck(prisma, { ...baseDeck, cards: { '01003': 2 } })

    const deck = await prisma.tournamentDeck.findUnique({ where: { id: 1 }, include: { cards: true } })
    expect(deck?.cards.map((c) => c.cardCode)).toEqual(['01003'])
  })

  it('stores a null factionCode when no identity was resolved', async () => {
    await saveTournamentDeck(prisma, { ...baseDeck, factionCode: null })

    const deck = await prisma.tournamentDeck.findUniqueOrThrow({ where: { id: 1 } })
    expect(deck.factionCode).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/actions/tournamentDeckMutations.test.ts`
Expected: FAIL — module `./tournamentDeckMutations` does not exist.

- [ ] **Step 3: Implement `saveTournamentDeck`**

Create `src/actions/tournamentDeckMutations.ts`:

```ts
import type { PrismaClient } from '@prisma/client'

export interface TournamentDeckInput {
  id: number
  uuid: string
  name: string
  dateCreation: Date
  userName: string
  factionCode: string | null
  cards: Record<string, number>
}

export async function saveTournamentDeck(prisma: PrismaClient, deck: TournamentDeckInput): Promise<void> {
  await prisma.$transaction([
    prisma.tournamentDeck.upsert({
      where: { id: deck.id },
      create: {
        id: deck.id,
        uuid: deck.uuid,
        name: deck.name,
        dateCreation: deck.dateCreation,
        userName: deck.userName,
        factionCode: deck.factionCode,
      },
      update: {
        uuid: deck.uuid,
        name: deck.name,
        dateCreation: deck.dateCreation,
        userName: deck.userName,
        factionCode: deck.factionCode,
      },
    }),
    prisma.tournamentDeckCard.deleteMany({ where: { deckId: deck.id } }),
    prisma.tournamentDeckCard.createMany({
      data: Object.entries(deck.cards).map(([cardCode, quantity]) => ({ deckId: deck.id, cardCode, quantity })),
    }),
  ])
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/actions/tournamentDeckMutations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/tournamentDeckMutations.ts src/actions/tournamentDeckMutations.test.ts
git commit -m "Add saveTournamentDeck mutation"
```

---

### Task 4: Sync orchestration + CLI script

**Files:**
- Create: `src/lib/tournamentDeckSync.ts`
- Create: `scripts/syncDecks.ts`
- Modify: `package.json` (add `sync-decks` script)
- Test: `src/lib/tournamentDeckSync.test.ts`

**Interfaces:**
- Consumes: `fetchDecklistsByDate` (Task 2), `saveTournamentDeck` (Task 3), `getSetting`/`setSetting` (existing, `src/actions/settingsMutations.ts`), `prisma.card.findFirst`.
- Produces: `export const SYNC_CHECKPOINT_KEY: string`, `export const FLOOR_DATE: string`, `export interface SyncProgress { date: string; totalDecks: number; tournamentDecks: number }`, `export interface SyncSummary { daysWalked: number; tournamentDecksSaved: number }`, `export async function syncTournamentDecks(prisma: PrismaClient, options?: { onProgress?: (p: SyncProgress) => void; delayMs?: number; endDate?: string }): Promise<SyncSummary>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tournamentDeckSync.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { getSetting, setSetting } from '@/actions/settingsMutations'
import { syncTournamentDecks, SYNC_CHECKPOINT_KEY, FLOOR_DATE } from './tournamentDeckSync'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.tournamentDeckCard.deleteMany()
  await prisma.tournamentDeck.deleteMany()
  await prisma.setting.deleteMany()
  await prisma.card.deleteMany()
  vi.resetAllMocks()
})

function mockFetchByDate(decksByDate: Record<string, unknown[]>) {
  global.fetch = vi.fn(async (url: string) => {
    const date = url.split('/').pop() as string
    const data = decksByDate[date] ?? []
    return { ok: true, status: 200, json: async () => ({ success: true, data }) }
  }) as unknown as typeof fetch
}

function tournamentEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uuid: 'uuid-1',
    name: 'Winning Deck',
    date_creation: '2012-01-01T00:00:00+00:00',
    user_name: 'alice',
    tournament_badge: true,
    cards: { '01001': 3 },
    ...overrides,
  }
}

describe('syncTournamentDecks', () => {
  it('starts from the floor date when no checkpoint exists', async () => {
    mockFetchByDate({ [FLOOR_DATE]: [tournamentEntry()] })

    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(FLOOR_DATE))
    expect(await prisma.tournamentDeck.count()).toBe(1)
  })

  it('resumes from the day after the checkpoint', async () => {
    await setSetting(prisma, SYNC_CHECKPOINT_KEY, '2012-01-01')
    mockFetchByDate({ '2012-01-02': [tournamentEntry({ id: 2, uuid: 'uuid-2' })] })

    await syncTournamentDecks(prisma, { endDate: '2012-01-02', delayMs: 0 })

    expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/2012-01-01'))
    expect(await prisma.tournamentDeck.count()).toBe(1)
  })

  it('keeps only tournament_badge decks, discarding the rest', async () => {
    mockFetchByDate({
      [FLOOR_DATE]: [tournamentEntry(), tournamentEntry({ id: 2, uuid: 'uuid-2', tournament_badge: false })],
    })

    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })

    expect(await prisma.tournamentDeck.count()).toBe(1)
  })

  it("replaces an already-synced day's deck cards rather than appending, on re-sync", async () => {
    mockFetchByDate({ [FLOOR_DATE]: [tournamentEntry({ cards: { '01001': 3 } })] })
    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })
    await prisma.setting.deleteMany()

    mockFetchByDate({ [FLOOR_DATE]: [tournamentEntry({ cards: { '01002': 1 } })] })
    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })

    const cards = await prisma.tournamentDeckCard.findMany({ where: { deckId: 1 } })
    expect(cards.map((c) => c.cardCode)).toEqual(['01002'])
  })

  it("derives factionCode from the identity card among the deck's cards", async () => {
    await seedCard(prisma, {
      code: '01002',
      title: 'Az McCaffrey',
      packCode: 'core',
      typeCode: 'identity',
      factionCode: 'anarch',
    })
    mockFetchByDate({ [FLOOR_DATE]: [tournamentEntry({ cards: { '01001': 3, '01002': 1 } })] })

    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0 })

    const deck = await prisma.tournamentDeck.findUniqueOrThrow({ where: { id: 1 } })
    expect(deck.factionCode).toBe('anarch')
  })

  it('advances the checkpoint after each successfully synced day, not just at the end', async () => {
    mockFetchByDate({
      [FLOOR_DATE]: [tournamentEntry()],
      '2012-01-02': [tournamentEntry({ id: 2, uuid: 'uuid-2' })],
    })

    await syncTournamentDecks(prisma, { endDate: '2012-01-02', delayMs: 0 })

    expect(await getSetting(prisma, SYNC_CHECKPOINT_KEY)).toBe('2012-01-02')
  })

  it('stops without advancing the checkpoint past a day that fails to fetch', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('2012-01-02')) {
        return { ok: false, status: 500, json: async () => ({}) }
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) }
    }) as unknown as typeof fetch

    await expect(syncTournamentDecks(prisma, { endDate: '2012-01-03', delayMs: 0 })).rejects.toThrow()

    expect(await getSetting(prisma, SYNC_CHECKPOINT_KEY)).toBe(FLOOR_DATE)
  })

  it('reports per-day progress via onProgress', async () => {
    mockFetchByDate({
      [FLOOR_DATE]: [tournamentEntry(), tournamentEntry({ id: 2, uuid: 'uuid-2', tournament_badge: false })],
    })
    const onProgress = vi.fn()

    await syncTournamentDecks(prisma, { endDate: FLOOR_DATE, delayMs: 0, onProgress })

    expect(onProgress).toHaveBeenCalledWith({ date: FLOOR_DATE, totalDecks: 2, tournamentDecks: 1 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/tournamentDeckSync.test.ts`
Expected: FAIL — module `./tournamentDeckSync` does not exist.

- [ ] **Step 3: Implement `syncTournamentDecks`**

Create `src/lib/tournamentDeckSync.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import { fetchDecklistsByDate } from './netrunnerdb'
import { saveTournamentDeck } from '@/actions/tournamentDeckMutations'
import { getSetting, setSetting } from '@/actions/settingsMutations'

export const SYNC_CHECKPOINT_KEY = 'tournamentDecksSyncedThrough'
export const FLOOR_DATE = '2012-01-01'

function addDays(date: string, delta: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + delta)
  return parsed.toISOString().slice(0, 10)
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface SyncProgress {
  date: string
  totalDecks: number
  tournamentDecks: number
}

export interface SyncSummary {
  daysWalked: number
  tournamentDecksSaved: number
}

export interface SyncOptions {
  onProgress?: (progress: SyncProgress) => void
  delayMs?: number
  endDate?: string
}

/**
 * Walks NetrunnerDB's public decklists/by_date endpoint one calendar day
 * at a time, persisting tournament-flagged decks and advancing the
 * SYNC_CHECKPOINT_KEY setting after each successfully-synced day (not
 * batched to the end), so an interrupted run resumes at the next
 * unsynced day rather than re-walking from the last full success.
 */
export async function syncTournamentDecks(prisma: PrismaClient, options: SyncOptions = {}): Promise<SyncSummary> {
  const delayMs = options.delayMs ?? 150
  const endDate = options.endDate ?? addDays(todayUtc(), -1)

  const checkpoint = await getSetting(prisma, SYNC_CHECKPOINT_KEY)
  let cursor = checkpoint ? addDays(checkpoint, 1) : FLOOR_DATE

  let daysWalked = 0
  let tournamentDecksSaved = 0

  while (cursor <= endDate) {
    const dayDecks = await fetchDecklistsByDate(cursor)
    const tournamentDecks = dayDecks.filter((deck) => deck.tournamentBadge)

    for (const deck of tournamentDecks) {
      const identity = await prisma.card.findFirst({
        where: { code: { in: Object.keys(deck.cards) }, typeCode: 'identity' },
        select: { factionCode: true },
      })
      await saveTournamentDeck(prisma, {
        id: deck.id,
        uuid: deck.uuid,
        name: deck.name,
        dateCreation: new Date(deck.dateCreation),
        userName: deck.userName,
        factionCode: identity?.factionCode ?? null,
        cards: deck.cards,
      })
      tournamentDecksSaved += 1
    }

    await setSetting(prisma, SYNC_CHECKPOINT_KEY, cursor)
    options.onProgress?.({ date: cursor, totalDecks: dayDecks.length, tournamentDecks: tournamentDecks.length })
    daysWalked += 1

    if (cursor < endDate && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    cursor = addDays(cursor, 1)
  }

  return { daysWalked, tournamentDecksSaved }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/tournamentDeckSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the CLI script**

Create `scripts/syncDecks.ts`:

```ts
import { prisma } from '../src/lib/db'
import { syncTournamentDecks } from '../src/lib/tournamentDeckSync'

async function main() {
  console.log('Syncing tournament decklists from NetrunnerDB...')
  const summary = await syncTournamentDecks(prisma, {
    onProgress: (progress) => {
      console.log(`${progress.date}: ${progress.totalDecks} decks (${progress.tournamentDecks} tournament)`)
    },
  })
  console.log('Sync complete:', summary)
}

main()
  .catch((error) => {
    console.error('Sync failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

- [ ] **Step 6: Register the npm script**

In `package.json`, add to `"scripts"` (after `"import-cards"`):

```json
"sync-decks": "tsx scripts/syncDecks.ts"
```

- [ ] **Step 7: Run the full suite to verify nothing else broke**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/tournamentDeckSync.ts src/lib/tournamentDeckSync.test.ts scripts/syncDecks.ts package.json
git commit -m "Add checkpointed tournament-deck sync script (npm run sync-decks)"
```

---

### Task 5: Buildability computation (`getDiscoverDecks`)

**Files:**
- Create: `src/lib/discover.ts`
- Test: `src/lib/discover.test.ts`

**Interfaces:**
- Consumes: `cardContribution` (`src/lib/reports.ts`, existing), `DeckCardOwnership` type (`src/lib/decks.ts`, existing), `prisma.tournamentDeck`/`prisma.collectionEntry`/`prisma.card`.
- Produces: `export interface DiscoverFilters { faction?: string; maxMissingCards?: number; sort: 'percentOwned' | 'newest' | 'name'; limit: number; offset: number }`, `export interface DiscoverDeck { id: number; uuid: string; name: string; dateCreation: Date; userName: string; factionCode: string | null; ownedCount: number; totalCount: number; percentOwned: number; missingCopies: number; cards: DeckCardOwnership[] }`, `export async function getDiscoverDecks(prisma: PrismaClient, collectionId: number, filters: DiscoverFilters): Promise<{ decks: DiscoverDeck[]; total: number }>` — used by Task 7's `fetchDiscoverDecks` server action.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/discover.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { incrementOwned } from './collection'
import { getDiscoverDecks } from './discover'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.tournamentDeckCard.deleteMany()
  await prisma.tournamentDeck.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.card.deleteMany()
})

const defaultFilters = { sort: 'percentOwned' as const, limit: 25, offset: 0 }

describe('getDiscoverDecks', () => {
  it('computes aggregate and per-card ownership', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', factionCode: 'anarch' })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Test Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const { decks, total } = await getDiscoverDecks(prisma, collectionId, { ...defaultFilters, maxMissingCards: 5 })

    expect(total).toBe(1)
    expect(decks[0].totalCount).toBe(3)
    expect(decks[0].ownedCount).toBe(2)
    expect(decks[0].percentOwned).toBe(67)
    expect(decks[0].missingCopies).toBe(1)
    expect(decks[0].cards).toEqual([
      { code: '01001', title: 'Card A', factionName: 'anarch', neededQuantity: 3, ownedQuantity: 2, found: true },
    ])
  })

  it('excludes a deck with missing copies when the fully-buildable default applies', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Partial', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const { decks, total } = await getDiscoverDecks(prisma, collectionId, defaultFilters)

    expect(total).toBe(0)
    expect(decks).toEqual([])
  })

  it('includes a fully-buildable deck under the default (unset maxMissingCards) filter', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 3)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Full', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const { decks } = await getDiscoverDecks(prisma, collectionId, defaultFilters)

    expect(decks.map((d) => d.name)).toEqual(['Full'])
  })

  it('flags a deck card whose code is not in the local card database, without crashing', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Test Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: 'unknown-code', quantity: 3 } })

    const { decks } = await getDiscoverDecks(prisma, collectionId, { ...defaultFilters, maxMissingCards: 5 })

    expect(decks[0].cards[0]).toEqual({
      code: 'unknown-code',
      title: null,
      factionName: null,
      neededQuantity: 3,
      ownedQuantity: 0,
      found: false,
    })
  })

  it('filters by faction', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: {
        id: 1,
        uuid: 'uuid-1',
        name: 'Anarch Deck',
        dateCreation: new Date('2020-01-01'),
        userName: 'alice',
        factionCode: 'anarch',
      },
    })
    await prisma.tournamentDeck.create({
      data: {
        id: 2,
        uuid: 'uuid-2',
        name: 'Shaper Deck',
        dateCreation: new Date('2020-01-01'),
        userName: 'alice',
        factionCode: 'shaper',
      },
    })

    const { decks } = await getDiscoverDecks(prisma, collectionId, {
      ...defaultFilters,
      maxMissingCards: 5,
      faction: 'shaper',
    })

    expect(decks.map((d) => d.name)).toEqual(['Shaper Deck'])
  })

  it('sorts by percent owned descending', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 1)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Low', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 4 } })
    await prisma.tournamentDeck.create({
      data: { id: 2, uuid: 'uuid-2', name: 'High', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeckCard.create({ data: { deckId: 2, cardCode: '01001', quantity: 1 } })

    const { decks } = await getDiscoverDecks(prisma, collectionId, { ...defaultFilters, maxMissingCards: 5 })

    expect(decks.map((d) => d.name)).toEqual(['High', 'Low'])
  })

  it('sorts by newest', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Older', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeck.create({
      data: { id: 2, uuid: 'uuid-2', name: 'Newer', dateCreation: new Date('2021-01-01'), userName: 'alice' },
    })

    const { decks } = await getDiscoverDecks(prisma, collectionId, {
      ...defaultFilters,
      sort: 'newest',
      maxMissingCards: 5,
    })

    expect(decks.map((d) => d.name)).toEqual(['Newer', 'Older'])
  })

  it('sorts by name', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.tournamentDeck.create({
      data: { id: 1, uuid: 'uuid-1', name: 'Zebra', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })
    await prisma.tournamentDeck.create({
      data: { id: 2, uuid: 'uuid-2', name: 'Anteater', dateCreation: new Date('2020-01-01'), userName: 'alice' },
    })

    const { decks } = await getDiscoverDecks(prisma, collectionId, {
      ...defaultFilters,
      sort: 'name',
      maxMissingCards: 5,
    })

    expect(decks.map((d) => d.name)).toEqual(['Anteater', 'Zebra'])
  })

  it('paginates with limit/offset while total reflects the full filtered count', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    for (let i = 1; i <= 3; i++) {
      await prisma.tournamentDeck.create({
        data: { id: i, uuid: `uuid-${i}`, name: `Deck ${i}`, dateCreation: new Date('2020-01-01'), userName: 'a' },
      })
    }

    const { decks, total } = await getDiscoverDecks(prisma, collectionId, {
      sort: 'name',
      limit: 2,
      offset: 0,
      maxMissingCards: 5,
    })

    expect(total).toBe(3)
    expect(decks).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/discover.test.ts`
Expected: FAIL — module `./discover` does not exist.

- [ ] **Step 3: Implement `getDiscoverDecks`**

Create `src/lib/discover.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import { cardContribution } from './reports'
import type { DeckCardOwnership } from './decks'

export interface DiscoverFilters {
  faction?: string
  maxMissingCards?: number
  sort: 'percentOwned' | 'newest' | 'name'
  limit: number
  offset: number
}

export interface DiscoverDeck {
  id: number
  uuid: string
  name: string
  dateCreation: Date
  userName: string
  factionCode: string | null
  ownedCount: number
  totalCount: number
  percentOwned: number
  missingCopies: number
  cards: DeckCardOwnership[]
}

export async function getDiscoverDecks(
  prisma: PrismaClient,
  collectionId: number,
  filters: DiscoverFilters
): Promise<{ decks: DiscoverDeck[]; total: number }> {
  const [tournamentDecks, collectionEntries, knownCards] = await Promise.all([
    prisma.tournamentDeck.findMany({ include: { cards: true } }),
    prisma.collectionEntry.findMany({ where: { collectionId } }),
    prisma.card.findMany({ select: { code: true, title: true, faction: { select: { name: true } } } }),
  ])

  const ownedByCode = new Map(collectionEntries.map((entry) => [entry.cardCode, entry.quantityOwned]))
  const cardByCode = new Map(knownCards.map((card) => [card.code, card]))

  let computed: DiscoverDeck[] = tournamentDecks.map((deck) => {
    let ownedCount = 0
    let totalCount = 0
    let missingCopies = 0

    const cards: DeckCardOwnership[] = deck.cards.map((deckCard) => {
      const card = cardByCode.get(deckCard.cardCode)
      const ownedQuantity = ownedByCode.get(deckCard.cardCode) ?? 0

      totalCount += deckCard.quantity
      ownedCount += cardContribution(ownedQuantity, deckCard.quantity)
      missingCopies += Math.max(0, deckCard.quantity - ownedQuantity)

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
      dateCreation: deck.dateCreation,
      userName: deck.userName,
      factionCode: deck.factionCode,
      ownedCount,
      totalCount,
      percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
      missingCopies,
      cards,
    }
  })

  if (filters.faction) {
    computed = computed.filter((deck) => deck.factionCode === filters.faction)
  }
  computed = computed.filter((deck) => deck.missingCopies <= (filters.maxMissingCards ?? 0))

  computed.sort((a, b) => {
    if (filters.sort === 'newest') return b.dateCreation.getTime() - a.dateCreation.getTime()
    if (filters.sort === 'name') return a.name.localeCompare(b.name)
    return b.percentOwned - a.percentOwned
  })

  const total = computed.length
  const decks = computed.slice(filters.offset, filters.offset + filters.limit)
  return { decks, total }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/discover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/discover.ts src/lib/discover.test.ts
git commit -m "Add getDiscoverDecks buildability computation"
```

---

### Task 6: Extract `DeckCompletionBar`/`DeckCardList` from `DeckSection`

**Files:**
- Create: `src/components/DeckCompletionBar.tsx`
- Create: `src/components/DeckCardList.tsx`
- Test: `src/components/DeckCompletionBar.test.tsx`
- Test: `src/components/DeckCardList.test.tsx`
- Modify: `src/app/decks/DeckSection.tsx` (use the new components; no behavior change)

**Interfaces:**
- Produces: `export function DeckCompletionBar({ ownedCount, totalCount, percentOwned }: { ownedCount: number; totalCount: number; percentOwned: number })` and `export function DeckCardList({ cards }: { cards: DeckCardOwnership[] })` — used by both `DeckSection` (this task) and `DiscoverSection` (Task 7).
- Consumes: `DeckCardOwnership` type (`src/lib/decks.ts`, existing), `CardDetailPopup` (`src/components/CardDetailPopup.tsx`, existing).

- [ ] **Step 1: Write the failing tests**

Create `src/components/DeckCompletionBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeckCompletionBar } from './DeckCompletionBar'

describe('DeckCompletionBar', () => {
  it('renders the owned/total/percent stat', () => {
    render(<DeckCompletionBar ownedCount={2} totalCount={3} percentOwned={67} />)
    expect(screen.getByText('2/3 owned (67%)')).toBeInTheDocument()
  })

  it('sizes the progress bar fill to the percent owned', () => {
    const { container } = render(<DeckCompletionBar ownedCount={2} totalCount={3} percentOwned={67} />)
    const fill = container.querySelector('.bg-blue-600') as HTMLElement
    expect(fill.style.width).toBe('67%')
  })
})
```

Create `src/components/DeckCardList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeckCardList } from './DeckCardList'
import type { DeckCardOwnership } from '@/lib/decks'

const foundCard: DeckCardOwnership = {
  code: '01001',
  title: 'Card A',
  factionName: 'Anarch',
  neededQuantity: 3,
  ownedQuantity: 2,
  found: true,
}

const unknownCard: DeckCardOwnership = {
  code: 'zzzzz',
  title: null,
  factionName: null,
  neededQuantity: 1,
  ownedQuantity: 0,
  found: false,
}

describe('DeckCardList', () => {
  it('highlights a card short of the needed quantity', () => {
    render(<DeckCardList cards={[foundCard]} />)
    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).toContain('text-danger')
  })

  it('does not highlight a fully owned card', () => {
    render(<DeckCardList cards={[{ ...foundCard, ownedQuantity: 3 }]} />)
    const row = screen.getByText('Card A').closest('li')
    expect(row?.className).not.toContain('text-danger')
  })

  it('shows an unknown-card label with no popup link for a card not found locally', () => {
    render(<DeckCardList cards={[unknownCard]} />)
    expect(screen.getByText('Unknown card (zzzzz)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Show details for/ })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/DeckCompletionBar.test.tsx src/components/DeckCardList.test.tsx`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement the two components**

Create `src/components/DeckCompletionBar.tsx`:

```tsx
export function DeckCompletionBar({
  ownedCount,
  totalCount,
  percentOwned,
}: {
  ownedCount: number
  totalCount: number
  percentOwned: number
}) {
  return (
    <>
      <p className="text-sm text-muted">
        {ownedCount}/{totalCount} owned ({percentOwned}%)
      </p>
      <div className="h-2 rounded bg-subtle">
        <div className="h-2 rounded bg-blue-600" style={{ width: `${percentOwned}%` }} />
      </div>
    </>
  )
}
```

Create `src/components/DeckCardList.tsx`:

```tsx
import { CardDetailPopup } from './CardDetailPopup'
import type { DeckCardOwnership } from '@/lib/decks'

export function DeckCardList({ cards }: { cards: DeckCardOwnership[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {cards.map((card) => (
        <li
          key={card.code}
          className={`flex items-center gap-3 ${
            card.ownedQuantity < card.neededQuantity ? 'text-danger' : 'text-muted'
          }`}
        >
          {card.found && card.title ? (
            <CardDetailPopup card={{ code: card.code, title: card.title }} trigger="text" />
          ) : (
            <span>Unknown card ({card.code})</span>
          )}
          <span className="ml-auto shrink-0">
            {card.ownedQuantity}/{card.neededQuantity}
          </span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/DeckCompletionBar.test.tsx src/components/DeckCardList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Use the extracted components in `DeckSection`**

In `src/app/decks/DeckSection.tsx`:

Add imports near the top (alongside the existing `CardDetailPopup` import):

```tsx
import { DeckCompletionBar } from '@/components/DeckCompletionBar'
import { DeckCardList } from '@/components/DeckCardList'
```

Replace this block (the stat + progress bar inside the `<div className="flex-1 space-y-1">`):

```tsx
                      <span className="font-medium">{deck.name}</span>
                      <p className="text-sm text-muted">
                        {deck.ownedCount}/{deck.totalCount} owned ({deck.percentOwned}%)
                      </p>
                      <div className="h-2 rounded bg-subtle">
                        <div className="h-2 rounded bg-blue-600" style={{ width: `${deck.percentOwned}%` }} />
                      </div>
```

with:

```tsx
                      <span className="font-medium">{deck.name}</span>
                      <DeckCompletionBar
                        ownedCount={deck.ownedCount}
                        totalCount={deck.totalCount}
                        percentOwned={deck.percentOwned}
                      />
```

Replace this block (the per-card `<ul>`):

```tsx
                    <ul className="space-y-1 text-sm">
                      {deck.cards.map((card) => (
                        <li
                          key={card.code}
                          className={`flex items-center gap-3 ${
                            card.ownedQuantity < card.neededQuantity ? 'text-danger' : 'text-muted'
                          }`}
                        >
                          {card.found && card.title ? (
                            <CardDetailPopup card={{ code: card.code, title: card.title }} trigger="text" />
                          ) : (
                            <span>Unknown card ({card.code})</span>
                          )}
                          <span className="ml-auto shrink-0">
                            {card.ownedQuantity}/{card.neededQuantity}
                          </span>
                        </li>
                      ))}
                    </ul>
```

with:

```tsx
                    <DeckCardList cards={deck.cards} />
```

Now the `CardDetailPopup` import in `DeckSection.tsx` is unused — remove it (it moved into `DeckCardList.tsx`):

```tsx
import { CardDetailPopup } from '@/components/CardDetailPopup'
```

- [ ] **Step 6: Run the existing DeckSection tests to confirm no regressions**

Run: `npx vitest run src/app/decks/DeckSection.test.tsx`
Expected: PASS — every existing assertion (owned/total text, `text-danger` highlighting, unknown-card label, popup trigger) still holds, since the rendered output is unchanged.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/DeckCompletionBar.tsx src/components/DeckCompletionBar.test.tsx src/components/DeckCardList.tsx src/components/DeckCardList.test.tsx src/app/decks/DeckSection.tsx
git commit -m "Extract DeckCompletionBar and DeckCardList from DeckSection"
```

---

### Task 7: `/discover` page, actions, and nav link

**Files:**
- Create: `src/actions/discoverActions.ts`
- Create: `src/app/discover/page.tsx`
- Create: `src/app/discover/DiscoverSection.tsx`
- Create: `src/app/discover/DiscoverSection.test.tsx`
- Modify: `src/components/PrimaryNav.tsx` (add the `Discover` link)
- Modify: `src/components/PrimaryNav.test.tsx` (cover the new link)

**Interfaces:**
- Consumes: `getDiscoverDecks`/`DiscoverDeck`/`DiscoverFilters` (Task 5), `saveDeck` (`src/actions/deckMutations.ts`, existing), `SimpleActionResult` (`src/actions/deckActions.ts`, existing), `getDefaultCollectionId` (`src/lib/collections.ts`, existing), `DeckCompletionBar`/`DeckCardList` (Task 6).
- Produces: `export async function fetchDiscoverDecks(filters: DiscoverFilters): Promise<{ decks: DiscoverDeck[]; total: number }>` and `export async function saveDiscoveredDeck(id: number): Promise<SimpleActionResult>` in `discoverActions.ts`.

- [ ] **Step 1: Add the server actions**

Create `src/actions/discoverActions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
import { getDiscoverDecks, type DiscoverDeck, type DiscoverFilters } from '@/lib/discover'
import { saveDeck } from './deckMutations'
import type { SimpleActionResult } from './deckActions'

export async function fetchDiscoverDecks(filters: DiscoverFilters): Promise<{ decks: DiscoverDeck[]; total: number }> {
  const collectionId = await getDefaultCollectionId(prisma)
  return getDiscoverDecks(prisma, collectionId, filters)
}

export async function saveDiscoveredDeck(id: number): Promise<SimpleActionResult> {
  const deck = await prisma.tournamentDeck.findUnique({ where: { id }, include: { cards: true } })
  if (!deck) {
    return { ok: false, error: 'Deck not found' }
  }

  const cards = Object.fromEntries(deck.cards.map((card) => [card.cardCode, card.quantity]))
  await saveDeck(prisma, deck.id, deck.uuid, deck.name, cards)
  revalidatePath('/decks')
  return { ok: true }
}
```

- [ ] **Step 2: Add the page**

Create `src/app/discover/page.tsx`:

```tsx
import { prisma } from '@/lib/db'
import { getDiscoverDecks, type DiscoverFilters } from '@/lib/discover'
import { getDefaultCollectionId } from '@/lib/collections'
import { DiscoverSection } from './DiscoverSection'

// Reflects live DB state (owned quantities, synced deck pool) — not
// something to freeze into a build-time snapshot. See the dashboard's
// identical rationale.
export const dynamic = 'force-dynamic'

const DEFAULT_FILTERS: DiscoverFilters = { sort: 'percentOwned', limit: 25, offset: 0 }

export default async function DiscoverPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const [{ decks, total }, savedDecks, factions] = await Promise.all([
    getDiscoverDecks(prisma, collectionId, DEFAULT_FILTERS),
    prisma.deck.findMany({ select: { id: true } }),
    prisma.faction.findMany({ orderBy: { name: 'asc' } }),
  ])

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Discover</h1>
      <DiscoverSection
        initialDecks={decks}
        initialTotal={total}
        savedDeckIds={savedDecks.map((deck) => deck.id)}
        factionOptions={factions.map((faction) => ({ code: faction.code, name: faction.name }))}
      />
    </main>
  )
}
```

- [ ] **Step 3: Write the failing `DiscoverSection` tests**

Create `src/app/discover/DiscoverSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiscoverSection } from './DiscoverSection'
import { fetchDiscoverDecks, saveDiscoveredDeck } from '@/actions/discoverActions'
import type { DiscoverDeck } from '@/lib/discover'

vi.mock('@/actions/discoverActions', () => ({
  fetchDiscoverDecks: vi.fn(),
  saveDiscoveredDeck: vi.fn(),
}))

const sampleDeck: DiscoverDeck = {
  id: 1,
  uuid: 'uuid-1',
  name: 'Test Deck',
  dateCreation: new Date('2020-01-01'),
  userName: 'alice',
  factionCode: 'anarch',
  ownedCount: 3,
  totalCount: 3,
  percentOwned: 100,
  missingCopies: 0,
  cards: [
    { code: '01001', title: 'Card A', factionName: 'Anarch', neededQuantity: 3, ownedQuantity: 3, found: true },
  ],
}

const factionOptions = [{ code: 'anarch', name: 'Anarch' }]

describe('DiscoverSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders the initial decks passed from the server', () => {
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    expect(screen.getByText('Test Deck')).toBeInTheDocument()
    expect(screen.getByText('3/3 owned (100%)')).toBeInTheDocument()
  })

  it('shows a message when no decks match', () => {
    render(<DiscoverSection initialDecks={[]} initialTotal={0} savedDeckIds={[]} factionOptions={factionOptions} />)

    expect(screen.getByText('No decks match these filters.')).toBeInTheDocument()
  })

  it('expanding a deck shows its card list', async () => {
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

    expect(screen.getByText('Card A')).toBeInTheDocument()
  })

  it('changing the faction filter refetches with the selected faction', async () => {
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [], total: 0 })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.selectOptions(screen.getByLabelText('Faction'), 'anarch')

    await waitFor(() =>
      expect(fetchDiscoverDecks).toHaveBeenCalledWith(
        expect.objectContaining({ faction: 'anarch', offset: 0 })
      )
    )
  })

  it('toggling near-buildable decks refetches with maxMissingCards set', async () => {
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [], total: 0 })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByLabelText('Show near-buildable decks'))

    await waitFor(() =>
      expect(fetchDiscoverDecks).toHaveBeenCalledWith(expect.objectContaining({ maxMissingCards: 3 }))
    )
  })

  it('Load more appends the next page using the current deck count as offset', async () => {
    const secondDeck: DiscoverDeck = { ...sampleDeck, id: 2, uuid: 'uuid-2', name: 'Second Deck' }
    vi.mocked(fetchDiscoverDecks).mockResolvedValue({ decks: [secondDeck], total: 2 })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={2} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByRole('button', { name: /Load more/ }))

    await waitFor(() => expect(screen.getByText('Second Deck')).toBeInTheDocument())
    expect(fetchDiscoverDecks).toHaveBeenCalledWith(expect.objectContaining({ offset: 1 }))
    expect(screen.getByText('Test Deck')).toBeInTheDocument()
  })

  it('does not show Load more once every matching deck is loaded', () => {
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument()
  })

  it('saving a deck calls saveDiscoveredDeck and shows a saved state', async () => {
    vi.mocked(saveDiscoveredDeck).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
    )

    await user.click(screen.getByRole('button', { name: 'Save to My Decks' }))

    expect(saveDiscoveredDeck).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled())
  })

  it('shows an already-saved deck as Saved from the start', () => {
    render(
      <DiscoverSection initialDecks={[sampleDeck]} initialTotal={1} savedDeckIds={[1]} factionOptions={factionOptions} />
    )

    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/app/discover/DiscoverSection.test.tsx`
Expected: FAIL — module `./DiscoverSection` does not exist.

- [ ] **Step 5: Implement `DiscoverSection`**

Create `src/app/discover/DiscoverSection.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { fetchDiscoverDecks, saveDiscoveredDeck } from '@/actions/discoverActions'
import { DeckCompletionBar } from '@/components/DeckCompletionBar'
import { DeckCardList } from '@/components/DeckCardList'
import type { DiscoverDeck, DiscoverFilters } from '@/lib/discover'

const PAGE_SIZE = 25
const DEFAULT_NEAR_BUILDABLE_THRESHOLD = 3

interface FilterState {
  faction: string
  maxMissingCards: number | null
  sort: DiscoverFilters['sort']
}

interface DiscoverSectionProps {
  initialDecks: DiscoverDeck[]
  initialTotal: number
  savedDeckIds: number[]
  factionOptions: { code: string; name: string }[]
}

export function DiscoverSection({ initialDecks, initialTotal, savedDeckIds, factionOptions }: DiscoverSectionProps) {
  const [decks, setDecks] = useState(initialDecks)
  const [total, setTotal] = useState(initialTotal)
  const [filters, setFilters] = useState<FilterState>({ faction: '', maxMissingCards: null, sort: 'percentOwned' })
  const [openDeckId, setOpenDeckId] = useState<number | null>(null)
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set(savedDeckIds))
  const [savingId, setSavingId] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  function toApiFilters(next: FilterState, offset: number): DiscoverFilters {
    return {
      faction: next.faction || undefined,
      maxMissingCards: next.maxMissingCards ?? undefined,
      sort: next.sort,
      limit: PAGE_SIZE,
      offset,
    }
  }

  function updateFilters(patch: Partial<FilterState>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    startTransition(async () => {
      const result = await fetchDiscoverDecks(toApiFilters(next, 0))
      setDecks(result.decks)
      setTotal(result.total)
    })
  }

  function loadMore() {
    startTransition(async () => {
      const result = await fetchDiscoverDecks(toApiFilters(filters, decks.length))
      setDecks((prev) => [...prev, ...result.decks])
      setTotal(result.total)
    })
  }

  async function handleSave(id: number) {
    setSavingId(id)
    const result = await saveDiscoveredDeck(id)
    if (result.ok) {
      setSavedIds((prev) => new Set(prev).add(id))
    }
    setSavingId(null)
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label htmlFor="discover-faction" className="flex items-center gap-2">
          Faction
          <select
            id="discover-faction"
            value={filters.faction}
            onChange={(event) => updateFilters({ faction: event.target.value })}
            className="rounded border border-default bg-surface px-2 py-1"
          >
            <option value="">All</option>
            {factionOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filters.maxMissingCards !== null}
            onChange={(event) =>
              updateFilters({ maxMissingCards: event.target.checked ? DEFAULT_NEAR_BUILDABLE_THRESHOLD : null })
            }
          />
          Show near-buildable decks
        </label>

        {filters.maxMissingCards !== null && (
          <label className="flex items-center gap-2">
            Missing ≤
            <input
              type="number"
              min={1}
              value={filters.maxMissingCards}
              onChange={(event) => updateFilters({ maxMissingCards: Number(event.target.value) })}
              className="w-16 rounded border border-default bg-surface px-2 py-1"
            />
            cards
          </label>
        )}

        <label htmlFor="discover-sort" className="flex items-center gap-2">
          Sort
          <select
            id="discover-sort"
            value={filters.sort}
            onChange={(event) => updateFilters({ sort: event.target.value as DiscoverFilters['sort'] })}
            className="rounded border border-default bg-surface px-2 py-1"
          >
            <option value="percentOwned">% owned</option>
            <option value="newest">Newest</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {decks.length === 0 ? (
        <p className="text-sm text-faint">No decks match these filters.</p>
      ) : (
        <ul className="space-y-4">
          {decks.map((deck) => {
            const isOpen = openDeckId === deck.id
            const isSaved = savedIds.has(deck.id)
            const isSaving = savingId === deck.id

            return (
              <li key={deck.id} className="rounded border border-default">
                <div className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    onClick={() => setOpenDeckId(isOpen ? null : deck.id)}
                    aria-expanded={isOpen}
                    className="flex flex-1 cursor-pointer items-start justify-between gap-2 text-left hover:bg-surface-hover"
                  >
                    <div className="flex-1 space-y-1">
                      <span className="font-medium">{deck.name}</span>
                      <p className="text-xs text-faint">
                        by {deck.userName} · {deck.dateCreation.toISOString().slice(0, 10)}
                      </p>
                      <DeckCompletionBar
                        ownedCount={deck.ownedCount}
                        totalCount={deck.totalCount}
                        percentOwned={deck.percentOwned}
                      />
                    </div>
                    <span className="shrink-0 text-faint" aria-hidden="true">
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSave(deck.id)}
                    disabled={isSaved || isSaving}
                    className="shrink-0 cursor-pointer rounded border border-accent bg-accent/20 px-3 py-1 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSaved ? 'Saved' : isSaving ? 'Saving…' : 'Save to My Decks'}
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-subtle p-3">
                    <DeckCardList cards={deck.cards} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {decks.length < total && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isPending}
          className="cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Loading…' : `Load more (${decks.length}/${total})`}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Run the `DiscoverSection` tests to verify they pass**

Run: `npx vitest run src/app/discover/DiscoverSection.test.tsx`
Expected: PASS.

- [ ] **Step 7: Add the nav link**

In `src/components/PrimaryNav.tsx`, change:

```tsx
const LINKS = [
  { href: '/', label: 'Dashboard', exact: true },
  { href: '/builder', label: 'Builder', exact: false },
  { href: '/decks', label: 'Decks', exact: false },
]
```

to:

```tsx
const LINKS = [
  { href: '/', label: 'Dashboard', exact: true },
  { href: '/builder', label: 'Builder', exact: false },
  { href: '/decks', label: 'Decks', exact: false },
  { href: '/discover', label: 'Discover', exact: false },
]
```

- [ ] **Step 8: Update `PrimaryNav.test.tsx`**

In `src/components/PrimaryNav.test.tsx`, add this test (after the existing `'highlights nothing on an unrelated page'` test):

```tsx
  it('highlights Discover on /discover', () => {
    vi.mocked(usePathname).mockReturnValue('/discover')
    render(<PrimaryNav />)

    expect(screen.getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Decks' })).not.toHaveAttribute('aria-current')
  })
```

- [ ] **Step 9: Run the nav test to verify it passes**

Run: `npx vitest run src/components/PrimaryNav.test.tsx`
Expected: PASS.

- [ ] **Step 10: Run the full suite and build**

Run: `npm test && npm run build`
Expected: PASS — full test suite green; production build succeeds (the new `/discover` page reads the DB dynamically, same as `/decks`, so the build itself doesn't need `npm run setup`/`import-cards` to have run).

- [ ] **Step 11: Manual verification**

Run: `npm run dev`, then in a browser:
1. Visit `/discover` — page loads, nav highlights "Discover".
2. Toggle the faction filter, the near-buildable checkbox, and each sort option — the list updates.
3. Expand a deck — its card list shows, with any short cards highlighted red.
4. Click "Save to My Decks" on a deck — button becomes "Saved" and is disabled; the deck now appears on `/decks`.
5. If no `TournamentDeck` rows exist yet (sync hasn't been run), the page should show "No decks match these filters." rather than erroring.

- [ ] **Step 12: Commit**

```bash
git add src/actions/discoverActions.ts src/app/discover src/components/PrimaryNav.tsx src/components/PrimaryNav.test.tsx
git commit -m "Add /discover page: browse and save buildable tournament decks"
```
