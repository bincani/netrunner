# Format & Legality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, per card, which of Null Signal Games' 7 supported formats it's currently legal in (and any ban/restriction), and, per deck, a simple per-format legal/not-legal rollup — computed at import time from the same NetrunnerDB data source this app already uses.

**Architecture:** A new import module fetches NetrunnerDB's v2 format/card-pool/restriction data (bridged to this app's existing v1-based pack/cycle codes via `legacy_code` fields already partially used), resolves each format's currently-active snapshot, and computes/stores one `CardFormatLegality` row per (card, format). Card display (`CardDetailPopup`) reads this directly per card. Deck display (`decks.ts`, `discover.ts`) rolls per-card statuses up to a per-format legal/not-legal/unknown verdict via a small shared pure function, reusing each file's existing card-hydration query rather than adding new bulk queries.

**Tech Stack:** Next.js (App Router) + TypeScript, SQLite via Prisma, Tailwind CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-format-legality-design.md`

## Global Constraints

- No semicolons, single quotes, 2-space indent — match the existing codebase style exactly.
- `Card`/`TournamentDeckCard`-style FK rules: `CardFormatLegality.cardCode` DOES get a real FK to `Card` (unlike `DeckCard`/`TournamentDeckCard`) — format-legality rows only ever come from this app's own import against cards that already exist locally, there's no external-decklist "might not exist locally" concern here.
- A card with no resolvable v2 `cardId` gets **no** `CardFormatLegality` rows at all (not rows with a placeholder status) — this is how "no data" is distinguished from a definite `not_in_pool`/`legal` status, both at the card-display and deck-rollup layers.
- Every resolved card gets **exactly one row per format** (7 rows), including `legal` and `not_in_pool` — never skip writing a row just because the status is the "boring" case, since deck-rollup correctness depends on being able to tell "checked, and it's legal" apart from "never checked."
- Deck-level legality is pool + ban/restriction membership only — explicitly not a full construction-legality check (no influence budget, no deck-size, no agenda-point verification).
- Status values used everywhere: `'legal' | 'not_in_pool' | 'banned' | 'restricted' | 'universal_influence_penalty' | 'points'`.
- Format codes (fixed set of 7, hardcoded — NSG doesn't add these often and a hardcoded list keeps the import deterministic): `standard`, `startup`, `eternal`, `core`, `system_gateway`, `snapshot`, `ram`.

---

### Task 1: Schema — `Card.cardId`, `Format`, `CardFormatLegality`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Card.cardId: String?` column; `Format { code, name }` and `CardFormatLegality { cardCode, formatCode, status, detail }` models, available on `PrismaClient` as `prisma.format` / `prisma.cardFormatLegality` for every later task.

- [ ] **Step 1: Add the column and models**

In `prisma/schema.prisma`, add `cardId` to the existing `Card` model and a new relation field, so it reads:

```prisma
model Card {
  code              String            @id
  title             String
  typeCode          String
  type              CardType          @relation(fields: [typeCode], references: [code])
  factionCode       String
  faction           Faction           @relation(fields: [factionCode], references: [code])
  packCode          String
  pack              Pack              @relation(fields: [packCode], references: [code])
  sideCode          String
  cost              Int?
  factionCost       Int?
  text              String?
  deckLimit         Int?
  keywords          String?
  strength          Int?
  uniqueness        Boolean           @default(false)
  quantity          Int?
  position          Int
  /// The v2 data model's title-level card slug (e.g. "rezeki") — null until the format-legality import resolves it. Used to join CardFormatLegality and to look up restriction-list membership, which is keyed by this slug, not by printing code.
  cardId            String?
  collectionEntries CollectionEntry[]
  batchCards        BatchCard[]
  formatLegalities  CardFormatLegality[]
}
```

Then append two new models after the existing `Card` model:

```prisma
model Format {
  code       String               @id // standard, startup, eternal, core, system_gateway, snapshot, ram
  name       String
  legalities CardFormatLegality[]
}

model CardFormatLegality {
  cardCode   String
  card       Card   @relation(fields: [cardCode], references: [code], onDelete: Cascade)
  formatCode String
  format     Format @relation(fields: [formatCode], references: [code], onDelete: Cascade)
  /// 'legal' | 'not_in_pool' | 'banned' | 'restricted' | 'universal_influence_penalty' | 'points'
  status     String
  /// e.g. "+2 influence" or "2 pts (limit 7)" — null for legal/not_in_pool/banned/restricted.
  detail     String?

  @@id([cardCode, formatCode])
}
```

- [ ] **Step 2: Create and apply the migration**

Run: `npx prisma migrate dev --name add_format_legality`
Expected: a new folder under `prisma/migrations/`, applied to `data/netrunner.db`, Prisma client regenerated. This adds one nullable column and two new tables — no existing data is touched or made invalid (every existing `Card` row simply gets `cardId: null` until the import task backfills it).

- [ ] **Step 3: Verify**

Run: `npx prisma validate && npm test`
Expected: schema validates; full existing suite still passes (nothing reads/writes these new fields yet).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add Card.cardId, Format, and CardFormatLegality for format-legality tracking"
```

---

### Task 2: Format-snapshot resolution

**Files:**
- Create: `src/lib/formatSnapshot.ts`
- Test: `src/lib/formatSnapshot.test.ts`

**Interfaces:**
- Produces: `export interface RawSnapshot { id: string; date_start: string; card_pool_id: string; restriction_id?: string; active?: boolean }`, `export function resolveCurrentSnapshot(snapshots: RawSnapshot[], today: Date): RawSnapshot | null` — used by Task 4's import orchestration.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/formatSnapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveCurrentSnapshot, type RawSnapshot } from './formatSnapshot'

describe('resolveCurrentSnapshot', () => {
  it('picks the snapshot with the latest date_start that is not in the future', () => {
    const snapshots: RawSnapshot[] = [
      { id: 'a', date_start: '2020-01-01', card_pool_id: 'pool-a' },
      { id: 'b', date_start: '2021-06-01', card_pool_id: 'pool-b' },
      { id: 'c', date_start: '2026-01-01', card_pool_id: 'pool-c' },
    ]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.id).toBe('b')
  })

  it('includes a snapshot whose date_start is exactly today', () => {
    const snapshots: RawSnapshot[] = [{ id: 'a', date_start: '2022-01-01', card_pool_id: 'pool-a' }]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.id).toBe('a')
  })

  it('returns null when every snapshot is in the future', () => {
    const snapshots: RawSnapshot[] = [{ id: 'a', date_start: '2030-01-01', card_pool_id: 'pool-a' }]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result).toBeNull()
  })

  it('skips a snapshot explicitly marked active: false even if it has the latest past date_start', () => {
    const snapshots: RawSnapshot[] = [
      { id: 'a', date_start: '2020-01-01', card_pool_id: 'pool-a' },
      { id: 'b', date_start: '2020-06-01', card_pool_id: 'pool-b', active: false },
      { id: 'c', date_start: '2020-03-01', card_pool_id: 'pool-c' },
    ]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.id).toBe('c')
  })

  it('does not depend on array order', () => {
    const snapshots: RawSnapshot[] = [
      { id: 'later', date_start: '2026-01-01', card_pool_id: 'pool-later' },
      { id: 'earlier', date_start: '2020-01-01', card_pool_id: 'pool-earlier' },
    ]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.id).toBe('earlier')
  })

  it('carries restriction_id through when present', () => {
    const snapshots: RawSnapshot[] = [
      { id: 'a', date_start: '2020-01-01', card_pool_id: 'pool-a', restriction_id: 'ban-list-1' },
    ]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.restriction_id).toBe('ban-list-1')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/formatSnapshot.test.ts`
Expected: FAIL — module `./formatSnapshot` does not exist.

- [ ] **Step 3: Implement `resolveCurrentSnapshot`**

Create `src/lib/formatSnapshot.ts`:

```ts
export interface RawSnapshot {
  id: string
  date_start: string
  card_pool_id: string
  restriction_id?: string
  active?: boolean
}

/**
 * Picks the currently-active snapshot for a format: the one with the
 * latest date_start that is not in the future and not explicitly marked
 * active: false. Real NSG data includes entries explicitly deactivated
 * after their date passed (a reverted change) and at least one
 * out-of-chronological-order special entry mixed into the same array —
 * comparing every eligible entry's date_start directly (never relying on
 * array position) handles both correctly.
 */
export function resolveCurrentSnapshot(snapshots: RawSnapshot[], today: Date): RawSnapshot | null {
  const todayStr = today.toISOString().slice(0, 10)
  const eligible = snapshots.filter((snapshot) => snapshot.active !== false && snapshot.date_start <= todayStr)

  if (eligible.length === 0) {
    return null
  }

  return eligible.reduce((latest, snapshot) => (snapshot.date_start > latest.date_start ? snapshot : latest))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/formatSnapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/formatSnapshot.ts src/lib/formatSnapshot.test.ts
git commit -m "Add resolveCurrentSnapshot for format-legality import"
```

---

### Task 3: Per-card format status computation

**Files:**
- Create: `src/lib/cardFormatStatus.ts`
- Test: `src/lib/cardFormatStatus.test.ts`

**Interfaces:**
- Produces: `export interface CardPoolMembership { legalPackCodes: Set<string>; legalCycleCodes: Set<string> }`, `export interface RestrictionData { banned?: string[]; restricted?: string[]; global_penalty?: Record<string, string[]>; points?: Record<string, string[]>; point_limit?: number }`, `export interface CardFormatStatusResult { status: 'legal' | 'not_in_pool' | 'banned' | 'restricted' | 'universal_influence_penalty' | 'points'; detail: string | null }`, `export function computeCardFormatStatus(card: { packCode: string; cycleCode: string; cardId: string }, pool: CardPoolMembership, restriction: RestrictionData | null): CardFormatStatusResult` — used by Task 4's import orchestration.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/cardFormatStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeCardFormatStatus, type CardPoolMembership } from './cardFormatStatus'

const cardInPoolByPack = { packCode: 'core', cycleCode: 'core', cardId: 'sure_gamble' }
const cardInPoolByCycle = { packCode: 'some-pack', cycleCode: 'genesis', cardId: 'sure_gamble' }
const cardOutOfPool = { packCode: 'rotated-pack', cycleCode: 'rotated-cycle', cardId: 'sure_gamble' }

const emptyPool: CardPoolMembership = { legalPackCodes: new Set(['core']), legalCycleCodes: new Set(['genesis']) }

describe('computeCardFormatStatus', () => {
  it('is not_in_pool when neither the pack nor the cycle is legal', () => {
    const result = computeCardFormatStatus(cardOutOfPool, emptyPool, null)
    expect(result).toEqual({ status: 'not_in_pool', detail: null })
  })

  it('is legal when in pool via pack membership and there is no restriction data', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, null)
    expect(result).toEqual({ status: 'legal', detail: null })
  })

  it('is legal when in pool via cycle membership alone', () => {
    const result = computeCardFormatStatus(cardInPoolByCycle, emptyPool, null)
    expect(result).toEqual({ status: 'legal', detail: null })
  })

  it('is legal when in pool and a restriction exists but does not mention this card', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, { banned: ['some_other_card'] })
    expect(result).toEqual({ status: 'legal', detail: null })
  })

  it('is banned when the card_id is in the restriction\'s banned list', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, { banned: ['sure_gamble'] })
    expect(result).toEqual({ status: 'banned', detail: null })
  })

  it('is restricted when the card_id is in the restriction\'s restricted list', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, { restricted: ['sure_gamble'] })
    expect(result).toEqual({ status: 'restricted', detail: null })
  })

  it('is universal_influence_penalty with a "+N influence" detail from global_penalty', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, {
      global_penalty: { '2': ['sure_gamble'] },
    })
    expect(result).toEqual({ status: 'universal_influence_penalty', detail: '+2 influence' })
  })

  it('is points with a "N pts (limit M)" detail from points/point_limit', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, {
      points: { '3': ['sure_gamble'] },
      point_limit: 7,
    })
    expect(result).toEqual({ status: 'points', detail: '3 pts (limit 7)' })
  })

  it('a not_in_pool card is not_in_pool even if it also appears in a restriction bucket', () => {
    const result = computeCardFormatStatus(cardOutOfPool, emptyPool, { banned: ['sure_gamble'] })
    expect(result).toEqual({ status: 'not_in_pool', detail: null })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cardFormatStatus.test.ts`
Expected: FAIL — module `./cardFormatStatus` does not exist.

- [ ] **Step 3: Implement `computeCardFormatStatus`**

Create `src/lib/cardFormatStatus.ts`:

```ts
export interface CardPoolMembership {
  legalPackCodes: Set<string>
  legalCycleCodes: Set<string>
}

export interface RestrictionData {
  banned?: string[]
  restricted?: string[]
  global_penalty?: Record<string, string[]>
  points?: Record<string, string[]>
  point_limit?: number
}

export interface CardFormatStatusResult {
  status: 'legal' | 'not_in_pool' | 'banned' | 'restricted' | 'universal_influence_penalty' | 'points'
  detail: string | null
}

export function computeCardFormatStatus(
  card: { packCode: string; cycleCode: string; cardId: string },
  pool: CardPoolMembership,
  restriction: RestrictionData | null
): CardFormatStatusResult {
  const inPool = pool.legalPackCodes.has(card.packCode) || pool.legalCycleCodes.has(card.cycleCode)
  if (!inPool) {
    return { status: 'not_in_pool', detail: null }
  }

  if (restriction) {
    if (restriction.banned?.includes(card.cardId)) {
      return { status: 'banned', detail: null }
    }
    if (restriction.restricted?.includes(card.cardId)) {
      return { status: 'restricted', detail: null }
    }
    if (restriction.global_penalty) {
      for (const [amount, cardIds] of Object.entries(restriction.global_penalty)) {
        if (cardIds.includes(card.cardId)) {
          return { status: 'universal_influence_penalty', detail: `+${amount} influence` }
        }
      }
    }
    if (restriction.points) {
      for (const [amount, cardIds] of Object.entries(restriction.points)) {
        if (cardIds.includes(card.cardId)) {
          return { status: 'points', detail: `${amount} pts (limit ${restriction.point_limit ?? '?'})` }
        }
      }
    }
  }

  return { status: 'legal', detail: null }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cardFormatStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cardFormatStatus.ts src/lib/cardFormatStatus.test.ts
git commit -m "Add computeCardFormatStatus for per-card-per-format legality"
```

---

### Task 4: Import orchestration

**Files:**
- Create: `src/lib/importFormatLegality.ts`
- Modify: `scripts/import-cards.ts`
- Test: `src/lib/importFormatLegality.test.ts`

**Interfaces:**
- Consumes: `resolveCurrentSnapshot`/`RawSnapshot` (Task 2), `computeCardFormatStatus`/`CardPoolMembership`/`RestrictionData` (Task 3).
- Produces: `export interface FormatLegalityImportSummary { formats: number; cardsResolved: number; legalityRows: number }`, `export async function importFormatLegalityData(prisma: PrismaClient, fetchImpl?: typeof fetch): Promise<FormatLegalityImportSummary>` — invoked by `scripts/import-cards.ts`; nothing later in this plan calls it directly (Tasks 5+ only read the `CardFormatLegality` table it populates).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/importFormatLegality.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { importFormatLegalityData } from './importFormatLegality'
import type { PrismaClient } from '@prisma/client'

const BASE_URL = 'https://raw.githubusercontent.com/Null-Signal-Games/netrunner-cards-json/main'

function makeFetch(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    'v2/card_cycles.json': [{ id: 'core_set_v2', legacy_code: 'core' }],
    'v2/card_sets.json': [{ id: 'core_set_v2', legacy_code: 'core', card_cycle_id: 'core_set_v2' }],
    'v2/printings/core_set_v2.json': [{ id: '01001', card_id: 'sure_gamble', card_set_id: 'core_set_v2' }],
    'v2/formats/standard.json': {
      id: 'standard',
      name: 'Standard',
      snapshots: [{ id: 'standard_0', date_start: '2020-01-01', card_pool_id: 'standard_pool' }],
    },
    'v2/formats/startup.json': { id: 'startup', name: 'Startup', snapshots: [] },
    'v2/formats/eternal.json': { id: 'eternal', name: 'Eternal', snapshots: [] },
    'v2/formats/core.json': { id: 'core', name: 'Core', snapshots: [] },
    'v2/formats/system_gateway.json': { id: 'system_gateway', name: 'System Gateway', snapshots: [] },
    'v2/formats/snapshot.json': { id: 'snapshot', name: 'Snapshot', snapshots: [] },
    'v2/formats/ram.json': { id: 'ram', name: 'Random Access Memories', snapshots: [] },
    'v2/card_pools/standard.json': [
      { id: 'standard_pool', format_id: 'standard', card_cycle_ids: ['core_set_v2'], card_set_ids: [] },
    ],
    'v2/card_pools/startup.json': [],
    'v2/card_pools/eternal.json': [],
    'v2/card_pools/core.json': [],
    'v2/card_pools/system_gateway.json': [],
    'v2/card_pools/snapshot.json': [],
    'v2/card_pools/ram.json': [],
    ...overrides,
  }

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = Object.keys(responses).find((k) => url.endsWith(k))
    if (!key) throw new Error(`Unexpected fetch: ${url}`)
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => responses[key],
    } as Response
  })
}

describe('importFormatLegalityData', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.cardFormatLegality.deleteMany()
    await prisma.format.deleteMany()
    await prisma.collectionEntry.deleteMany()
    await prisma.card.deleteMany()
    await prisma.pack.deleteMany()
    await prisma.cycle.deleteMany()
  })

  it('imports all 7 formats and resolves cardId for known printings', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    const summary = await importFormatLegalityData(prisma, makeFetch())

    expect(summary.formats).toBe(7)
    const card = await prisma.card.findUniqueOrThrow({ where: { code: '01001' } })
    expect(card.cardId).toBe('sure_gamble')
  })

  it('marks an in-pool card as legal with no restriction', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    await importFormatLegalityData(prisma, makeFetch())

    const row = await prisma.cardFormatLegality.findUniqueOrThrow({
      where: { cardCode_formatCode: { cardCode: '01001', formatCode: 'standard' } },
    })
    expect(row.status).toBe('legal')
  })

  it('marks a card whose pack/cycle is not in the pool as not_in_pool', async () => {
    await seedCard(prisma, {
      code: '01001',
      title: 'Sure Gamble',
      packCode: 'core',
      cycleCode: 'core',
      typeCode: 'event',
    })

    await importFormatLegalityData(
      prisma,
      makeFetch({
        'v2/card_pools/standard.json': [
          { id: 'standard_pool', format_id: 'standard', card_cycle_ids: ['some_other_cycle'], card_set_ids: [] },
        ],
      })
    )

    const row = await prisma.cardFormatLegality.findUniqueOrThrow({
      where: { cardCode_formatCode: { cardCode: '01001', formatCode: 'standard' } },
    })
    expect(row.status).toBe('not_in_pool')
  })

  it('applies a restriction from the current snapshot when one is referenced', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    await importFormatLegalityData(
      prisma,
      makeFetch({
        'v2/formats/standard.json': {
          id: 'standard',
          name: 'Standard',
          snapshots: [
            {
              id: 'standard_0',
              date_start: '2020-01-01',
              card_pool_id: 'standard_pool',
              restriction_id: 'ban_1',
            },
          ],
        },
        'v2/restrictions/standard/ban_1.json': {
          id: 'ban_1',
          format_id: 'standard',
          date_start: '2020-01-01',
          name: 'Ban List 1',
          banned: ['sure_gamble'],
        },
      })
    )

    const row = await prisma.cardFormatLegality.findUniqueOrThrow({
      where: { cardCode_formatCode: { cardCode: '01001', formatCode: 'standard' } },
    })
    expect(row.status).toBe('banned')
  })

  it('leaves cardId null and writes no legality rows for a card with no matching v2 printing', async () => {
    await seedCard(prisma, {
      code: '99999',
      title: 'Unresolvable Card',
      packCode: 'core',
      cycleCode: 'core',
    })

    await importFormatLegalityData(prisma, makeFetch({ 'v2/printings/core_set_v2.json': [] }))

    const card = await prisma.card.findUniqueOrThrow({ where: { code: '99999' } })
    expect(card.cardId).toBeNull()
    const rows = await prisma.cardFormatLegality.findMany({ where: { cardCode: '99999' } })
    expect(rows).toEqual([])
  })

  it('is idempotent: re-import replaces rather than duplicates rows', async () => {
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', cycleCode: 'core' })

    await importFormatLegalityData(prisma, makeFetch())
    await importFormatLegalityData(prisma, makeFetch())

    const rows = await prisma.cardFormatLegality.findMany({
      where: { cardCode: '01001', formatCode: 'standard' },
    })
    expect(rows).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/importFormatLegality.test.ts`
Expected: FAIL — module `./importFormatLegality` does not exist. (Also note: this brief adds a `cycleCode` option to `seedCard` in its test calls — `src/lib/testFixtures.ts` already accepts `cycleCode?: string`, so no fixture change is needed; verify this by reading `src/lib/testFixtures.ts` before writing the implementation if anything is unclear.)

- [ ] **Step 3: Implement `importFormatLegalityData`**

Create `src/lib/importFormatLegality.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import { resolveCurrentSnapshot, type RawSnapshot } from './formatSnapshot'
import { computeCardFormatStatus, type CardPoolMembership, type RestrictionData } from './cardFormatStatus'

const BASE_URL = 'https://raw.githubusercontent.com/Null-Signal-Games/netrunner-cards-json/main'

const FORMAT_CODES = ['standard', 'startup', 'eternal', 'core', 'system_gateway', 'snapshot', 'ram'] as const

export interface FormatLegalityImportSummary {
  formats: number
  cardsResolved: number
  legalityRows: number
}

interface RawCardCycleOrSet {
  id: string
  legacy_code: string
}

interface RawPrinting {
  id: string
  card_id: string
  card_set_id: string
}

interface RawFormat {
  id: string
  name: string
  snapshots: RawSnapshot[]
}

interface RawCardPool {
  id: string
  card_cycle_ids: string[]
  card_set_ids: string[]
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export async function importFormatLegalityData(
  prisma: PrismaClient,
  fetchImpl: typeof fetch = fetch
): Promise<FormatLegalityImportSummary> {
  const [v2Cycles, v2Sets] = await Promise.all([
    fetchJson<RawCardCycleOrSet[]>(fetchImpl, `${BASE_URL}/v2/card_cycles.json`),
    fetchJson<RawCardCycleOrSet[]>(fetchImpl, `${BASE_URL}/v2/card_sets.json`),
  ])

  const v2CycleIdByLegacyCode = new Map(v2Cycles.map((c) => [c.legacy_code, c.id]))
  const legacyCodeByV2CycleId = new Map(v2Cycles.map((c) => [c.id, c.legacy_code]))
  const v2PackIdByLegacyCode = new Map(v2Sets.map((s) => [s.legacy_code, s.id]))
  const legacyCodeByV2PackId = new Map(v2Sets.map((s) => [s.id, s.legacy_code]))

  // Only fetch printings for packs this app actually has imported —
  // there's no point resolving cardIds for sets that don't exist locally.
  const localPacks = await prisma.pack.findMany({ select: { code: true, cycleCode: true } })
  const cycleCodeByPackCode = new Map(localPacks.map((p) => [p.code, p.cycleCode]))

  const cardIdByCode = new Map<string, string>()
  for (const pack of localPacks) {
    const v2PackId = v2PackIdByLegacyCode.get(pack.code)
    if (!v2PackId) continue

    let printings: RawPrinting[]
    try {
      printings = await fetchJson<RawPrinting[]>(fetchImpl, `${BASE_URL}/v2/printings/${v2PackId}.json`)
    } catch {
      continue
    }
    for (const printing of printings) {
      cardIdByCode.set(printing.id, printing.card_id)
    }
  }

  let cardsResolved = 0
  await prisma.$transaction(
    async (tx) => {
      for (const [code, cardId] of cardIdByCode) {
        await tx.card.updateMany({ where: { code }, data: { cardId } })
        cardsResolved += 1
      }
    },
    { timeout: 60_000 }
  )

  const allCards = await prisma.card.findMany({
    where: { cardId: { not: null } },
    select: { code: true, packCode: true, cardId: true },
  })

  let legalityRows = 0

  for (const formatCode of FORMAT_CODES) {
    const format = await fetchJson<RawFormat>(fetchImpl, `${BASE_URL}/v2/formats/${formatCode}.json`)
    await prisma.format.upsert({
      where: { code: formatCode },
      create: { code: formatCode, name: format.name },
      update: { name: format.name },
    })

    const snapshot = resolveCurrentSnapshot(format.snapshots, new Date())
    if (!snapshot) {
      await prisma.cardFormatLegality.deleteMany({ where: { formatCode } })
      continue
    }

    const pools = await fetchJson<RawCardPool[]>(fetchImpl, `${BASE_URL}/v2/card_pools/${formatCode}.json`)
    const pool = pools.find((p) => p.id === snapshot.card_pool_id)

    const legalPackCodes = new Set(
      (pool?.card_set_ids ?? []).map((id) => legacyCodeByV2PackId.get(id)).filter((code): code is string => !!code)
    )
    const legalCycleCodes = new Set(
      (pool?.card_cycle_ids ?? [])
        .map((id) => legacyCodeByV2CycleId.get(id))
        .filter((code): code is string => !!code)
    )
    const membership: CardPoolMembership = { legalPackCodes, legalCycleCodes }

    let restriction: RestrictionData | null = null
    if (snapshot.restriction_id) {
      restriction = await fetchJson<RestrictionData>(
        fetchImpl,
        `${BASE_URL}/v2/restrictions/${formatCode}/${snapshot.restriction_id}.json`
      )
    }

    const rows = allCards.map((card) => {
      const cycleCode = cycleCodeByPackCode.get(card.packCode) ?? ''
      const { status, detail } = computeCardFormatStatus(
        { packCode: card.packCode, cycleCode, cardId: card.cardId! },
        membership,
        restriction
      )
      return { cardCode: card.code, formatCode, status, detail }
    })

    await prisma.$transaction(
      [
        prisma.cardFormatLegality.deleteMany({ where: { formatCode } }),
        prisma.cardFormatLegality.createMany({ data: rows }),
      ],
      { timeout: 60_000 }
    )
    legalityRows += rows.length
  }

  return { formats: FORMAT_CODES.length, cardsResolved, legalityRows }
}
```

Note: `v2CycleIdByLegacyCode`/`v2PackIdByLegacyCode` are built but only their reverse maps (`legacyCodeByV2CycleId`/`legacyCodeByV2PackId`) and the forward `v2PackIdByLegacyCode` (used once, for the printings fetch) end up used — this mirrors exactly what the bridging needs on both sides (v1→v2 to know *which* v2 file to fetch, v2→v1 to translate a pool's legal IDs back into this app's codes) and keeps both directions available without recomputing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/importFormatLegality.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `npm run import-cards`**

Replace the full contents of `scripts/import-cards.ts` with:

```ts
import { prisma } from '../src/lib/db'
import { importAllCardData } from '../src/lib/importData'
import { importFormatLegalityData } from '../src/lib/importFormatLegality'

async function main() {
  console.log('Importing Netrunner card data...')
  const summary = await importAllCardData(prisma)
  console.log('Import complete:', summary)

  console.log('Importing format legality data...')
  const legalitySummary = await importFormatLegalityData(prisma)
  console.log('Format legality import complete:', legalitySummary)
}

main()
  .catch((error) => {
    console.error('Import failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/importFormatLegality.ts src/lib/importFormatLegality.test.ts scripts/import-cards.ts
git commit -m "Add format-legality import, wired into npm run import-cards"
```

---

### Task 5: `formatLegalities` on card detail

**Files:**
- Modify: `src/lib/cards.ts`
- Test: `src/lib/cards.test.ts`

**Interfaces:**
- Consumes: `prisma.cardFormatLegality` / `prisma.format` (Task 1).
- Produces: `export interface FormatLegalityEntry { formatCode: string; formatName: string; status: string; detail: string | null }` and `formatLegalities: FormatLegalityEntry[]` added to `PackCardEntry` and `CardSearchResult` — used by Task 6's `CardDetailPopup`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/cards.test.ts` (find the existing `describe('getCardDetail', ...)`-style blocks and add alongside them — do not remove any existing test):

```ts
describe('formatLegalities', () => {
  it('getCardDetail includes each format the card has a legality row for', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core' })
    await prisma.format.create({ data: { code: 'standard', name: 'Standard' } })
    await prisma.cardFormatLegality.create({
      data: { cardCode: '01001', formatCode: 'standard', status: 'legal', detail: null },
    })

    const detail = await getCardDetail(prisma, collectionId, '01001')

    expect(detail?.formatLegalities).toEqual([
      { formatCode: 'standard', formatName: 'Standard', status: 'legal', detail: null },
    ])
  })

  it('getCardDetail returns an empty array for a card with no legality data', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core' })

    const detail = await getCardDetail(prisma, collectionId, '01001')

    expect(detail?.formatLegalities).toEqual([])
  })

  it('listCardsInPack attaches formatLegalities per card without an N+1 query per card', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Sure Gamble', packCode: 'core', position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Easy Mark', packCode: 'core', position: 2 })
    await prisma.format.create({ data: { code: 'standard', name: 'Standard' } })
    await prisma.cardFormatLegality.create({
      data: { cardCode: '01001', formatCode: 'standard', status: 'banned', detail: null },
    })

    const cards = await listCardsInPack(prisma, collectionId, 'core')

    expect(cards[0].formatLegalities).toEqual([
      { formatCode: 'standard', formatName: 'Standard', status: 'banned', detail: null },
    ])
    expect(cards[1].formatLegalities).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cards.test.ts`
Expected: FAIL — `formatLegalities` is `undefined` on the returned objects.

- [ ] **Step 3: Implement**

In `src/lib/cards.ts`, add near the top (after the existing imports):

```ts
export interface FormatLegalityEntry {
  formatCode: string
  formatName: string
  status: string
  detail: string | null
}

/** Bulk-attaches each entry's formatLegalities in one query, keyed by its `code` — avoids an N+1 query per card in a list. */
async function attachFormatLegalities<T extends { code: string }>(
  prisma: PrismaClient,
  entries: T[]
): Promise<(T & { formatLegalities: FormatLegalityEntry[] })[]> {
  const codes = entries.map((entry) => entry.code)
  const rows = await prisma.cardFormatLegality.findMany({
    where: { cardCode: { in: codes } },
    include: { format: true },
  })

  const byCode = new Map<string, FormatLegalityEntry[]>()
  for (const row of rows) {
    const list = byCode.get(row.cardCode) ?? []
    list.push({ formatCode: row.formatCode, formatName: row.format.name, status: row.status, detail: row.detail })
    byCode.set(row.cardCode, list)
  }

  return entries.map((entry) => ({ ...entry, formatLegalities: byCode.get(entry.code) ?? [] }))
}
```

Add `formatLegalities: FormatLegalityEntry[]` to both the `PackCardEntry` and `CardSearchResult` interfaces (add the field to each interface's existing field list, e.g. right after `quantity`).

Change `getCardDetail` to route its return through the helper:

```ts
export async function getCardDetail(
  prisma: PrismaClient,
  collectionId: number,
  code: string
): Promise<PackCardEntry | null> {
  const card = await prisma.card.findUnique({
    where: { code },
    include: {
      collectionEntries: { where: { collectionId } },
      faction: true,
      type: true,
    },
  })
  if (!card) {
    return null
  }

  const [withLegalities] = await attachFormatLegalities(prisma, [
    {
      code: card.code,
      title: card.title,
      factionCode: card.factionCode,
      factionName: card.faction.name,
      typeCode: card.typeCode,
      typeName: card.type.name,
      sideCode: card.sideCode,
      cost: card.cost,
      factionCost: card.factionCost,
      strength: card.strength,
      deckLimit: card.deckLimit,
      keywords: card.keywords,
      text: card.text,
      uniqueness: card.uniqueness,
      position: card.position,
      ownedQuantity: card.collectionEntries[0]?.quantityOwned ?? 0,
      quantity: card.quantity,
    },
  ])
  return withLegalities
}
```

Change `listCardsInPack`'s return statement from the plain `.map(...)` to route through the helper:

```ts
export async function listCardsInPack(
  prisma: PrismaClient,
  collectionId: number,
  packCode: string
): Promise<PackCardEntry[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    include: {
      collectionEntries: { where: { collectionId } },
      faction: true,
      type: true,
    },
    orderBy: { position: 'asc' },
  })

  const entries = cards.map((card) => ({
    code: card.code,
    title: card.title,
    factionCode: card.factionCode,
    factionName: card.faction.name,
    typeCode: card.typeCode,
    typeName: card.type.name,
    sideCode: card.sideCode,
    cost: card.cost,
    factionCost: card.factionCost,
    strength: card.strength,
    deckLimit: card.deckLimit,
    keywords: card.keywords,
    text: card.text,
    uniqueness: card.uniqueness,
    position: card.position,
    ownedQuantity: card.collectionEntries[0]?.quantityOwned ?? 0,
    quantity: card.quantity,
  }))

  return attachFormatLegalities(prisma, entries)
}
```

Change `searchCards`'s final two lines from:

```ts
  return cards.map((card) => ({
    code: card.code,
    title: card.title,
    factionCode: card.factionCode,
    factionName: card.faction.name,
    typeCode: card.typeCode,
    typeName: card.type.name,
    packCode: card.packCode,
    packName: card.pack.name,
    sideCode: card.sideCode,
    cost: card.cost,
    factionCost: card.factionCost,
    strength: card.strength,
    deckLimit: card.deckLimit,
    keywords: card.keywords,
    text: card.text,
    uniqueness: card.uniqueness,
    position: card.position,
    ownedQuantity: card.collectionEntries[0]?.quantityOwned ?? 0,
    quantity: card.quantity,
  }))
}
```

to:

```ts
  const entries = cards.map((card) => ({
    code: card.code,
    title: card.title,
    factionCode: card.factionCode,
    factionName: card.faction.name,
    typeCode: card.typeCode,
    typeName: card.type.name,
    packCode: card.packCode,
    packName: card.pack.name,
    sideCode: card.sideCode,
    cost: card.cost,
    factionCost: card.factionCost,
    strength: card.strength,
    deckLimit: card.deckLimit,
    keywords: card.keywords,
    text: card.text,
    uniqueness: card.uniqueness,
    position: card.position,
    ownedQuantity: card.collectionEntries[0]?.quantityOwned ?? 0,
    quantity: card.quantity,
  }))

  return attachFormatLegalities(prisma, entries)
}
```

(the body of the `.map()` callback is unchanged — only the `return` becomes an assignment, followed by the new `attachFormatLegalities` call).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cards.test.ts`
Expected: PASS.

- [ ] **Step 5: Keep every other `PackCardEntry`-typed test fixture typechecking**

`PackCardEntry` just gained a *required* `formatLegalities` field. Four other test files construct `PackCardEntry` object literals directly and will fail `tsc --noEmit` (though not `vitest run`, which doesn't type-check) until they're updated — fix all four now rather than leaving the build red across tasks:

- `src/app/sets/[packCode]/SetCardGrid.test.tsx`
- `src/app/sets/[packCode]/attributeFilters.test.ts`
- `src/app/sets/[packCode]/SetCardFilterSidebar.test.tsx`

Each of these three has an identical `makeCard(overrides)` factory function whose default object literal needs one new line. Find (in each file):

```ts
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
    quantity: 3,
    ...overrides,
  }
}
```

and change the `quantity: 3,` line to:

```ts
    quantity: 3,
    formatLegalities: [],
```

(one line added, nothing else in the file changes — every existing test using `makeCard` continues to pass unchanged, since an empty array is exactly what "no legality data" means and none of those tests assert anything about format legality).

- `src/components/CardDetailPopup.test.tsx` — add `formatLegalities: []` to the existing `const fullCard: PackCardEntry = { ... }` fixture's object literal (don't change any other field on it). Task 6 (not this one) adds the new tests that override this to non-empty arrays.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cards.ts src/lib/cards.test.ts src/app/sets/\[packCode\]/SetCardGrid.test.tsx src/app/sets/\[packCode\]/attributeFilters.test.ts src/app/sets/\[packCode\]/SetCardFilterSidebar.test.tsx src/components/CardDetailPopup.test.tsx
git commit -m "Attach formatLegalities to card search/detail/pack-list results"
```

---

### Task 6: Card popup UI

**Files:**
- Modify: `src/components/CardDetailPopup.tsx`
- Test: `src/components/CardDetailPopup.test.tsx`

**Interfaces:**
- Consumes: `FormatLegalityEntry`, `formatLegalities` on `PackCardEntry` (Task 5).

- [ ] **Step 1: Write the failing tests**

(Task 5 already added `formatLegalities: []` to `fullCard`, to keep the build typechecking in between tasks — no fixture edit needed here.)

Add, alongside the existing tests, using that same `fullCard`/`mockPrintingsFetch` fixtures — read the current top of the file first to match its exact conventions:

```tsx
describe('format legality', () => {
  it('shows a line per format the card has legality data for', async () => {
    const cardWithLegalities = {
      ...fullCard,
      formatLegalities: [
        { formatCode: 'standard', formatName: 'Standard', status: 'banned', detail: null },
        { formatCode: 'startup', formatName: 'Startup', status: 'legal', detail: null },
      ],
    }
    mockPrintingsFetch([])
    const user = userEvent.setup()
    render(<CardDetailPopup card={cardWithLegalities} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

    expect(await screen.findByText('Standard: banned')).toBeInTheDocument()
    expect(screen.getByText('Startup: legal')).toBeInTheDocument()
  })

  it('includes the detail string when present', async () => {
    const cardWithLegalities = {
      ...fullCard,
      formatLegalities: [
        { formatCode: 'eternal', formatName: 'Eternal', status: 'points', detail: '3 pts (limit 7)' },
      ],
    }
    mockPrintingsFetch([])
    const user = userEvent.setup()
    render(<CardDetailPopup card={cardWithLegalities} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

    expect(await screen.findByText('Eternal: points (3 pts (limit 7))')).toBeInTheDocument()
  })

  it('shows an unavailable message when there is no legality data', async () => {
    const cardWithoutLegalities = { ...fullCard, formatLegalities: [] }
    mockPrintingsFetch([])
    const user = userEvent.setup()
    render(<CardDetailPopup card={cardWithoutLegalities} />)

    await user.click(screen.getByRole('button', { name: 'Show details for Zed 2.0' }))

    expect(await screen.findByText('Format legality unavailable')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/CardDetailPopup.test.tsx`
Expected: FAIL — the new text isn't rendered yet.

- [ ] **Step 3: Implement**

In `src/components/CardDetailPopup.tsx`, add a new section right after the existing `<div className="pt-2 text-sm text-muted">Owned: {detail.ownedQuantity}</div>` line and before the `{printings.length > 0 && (...)}` block:

```tsx
                    <div className="pt-2">
                      <div className="text-sm font-semibold text-primary">Format Legality</div>
                      {detail.formatLegalities.length > 0 ? (
                        <ul className="text-sm text-muted">
                          {detail.formatLegalities.map((entry) => (
                            <li key={entry.formatCode}>
                              {entry.formatName}: {entry.status.replace(/_/g, ' ')}
                              {entry.detail && ` (${entry.detail})`}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-faint">Format legality unavailable</p>
                      )}
                    </div>
```

Note this renders `entry.status.replace(/_/g, ' ')` — so `'universal_influence_penalty'` displays as `'universal influence penalty'` and `'not_in_pool'` as `'not in pool'`, matching the plain-text style of `banned`/`legal`/`restricted`/`points` without a separate label-mapping table.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/CardDetailPopup.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CardDetailPopup.tsx src/components/CardDetailPopup.test.tsx
git commit -m "Show per-format legality in the card detail popup"
```

---

### Task 7: Shared deck format-legality rollup

**Files:**
- Create: `src/lib/deckFormatLegality.ts`
- Test: `src/lib/deckFormatLegality.test.ts`

**Interfaces:**
- Produces: `export interface CardFormatLegalityInfo { formatCode: string; status: string }`, `export interface DeckFormatLegality { formatCode: string; formatName: string; legal: boolean | null }`, `export function computeDeckFormatLegality(formats: { code: string; name: string }[], cardLegalities: CardFormatLegalityInfo[][]): DeckFormatLegality[]` — used by Task 8's `decks.ts`/`discover.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/deckFormatLegality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeDeckFormatLegality } from './deckFormatLegality'

const formats = [{ code: 'standard', name: 'Standard' }]

describe('computeDeckFormatLegality', () => {
  it('is legal when every card is legal in the format', () => {
    const result = computeDeckFormatLegality(formats, [
      [{ formatCode: 'standard', status: 'legal' }],
      [{ formatCode: 'standard', status: 'restricted' }],
    ])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: true }])
  })

  it('is not legal if any card is banned', () => {
    const result = computeDeckFormatLegality(formats, [
      [{ formatCode: 'standard', status: 'legal' }],
      [{ formatCode: 'standard', status: 'banned' }],
    ])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: false }])
  })

  it('is not legal if any card is not_in_pool', () => {
    const result = computeDeckFormatLegality(formats, [[{ formatCode: 'standard', status: 'not_in_pool' }]])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: false }])
  })

  it('is unknown (null) if a card has no legality row for the format, and no other card is banned/not_in_pool', () => {
    const result = computeDeckFormatLegality(formats, [
      [{ formatCode: 'standard', status: 'legal' }],
      [], // this card has no legality data at all
    ])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: null }])
  })

  it('prioritizes a definite banned/not_in_pool verdict over an unknown one from another card', () => {
    const result = computeDeckFormatLegality(formats, [
      [{ formatCode: 'standard', status: 'banned' }],
      [], // unknown
    ])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: false }])
  })

  it('returns one entry per format, independent of each other', () => {
    const result = computeDeckFormatLegality(
      [
        { code: 'standard', name: 'Standard' },
        { code: 'startup', name: 'Startup' },
      ],
      [
        [
          { formatCode: 'standard', status: 'banned' },
          { formatCode: 'startup', status: 'legal' },
        ],
      ]
    )

    expect(result).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: false },
      { formatCode: 'startup', formatName: 'Startup', legal: true },
    ])
  })

  it('a deck with no cards is legal in every format', () => {
    const result = computeDeckFormatLegality(formats, [])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: true }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/deckFormatLegality.test.ts`
Expected: FAIL — module `./deckFormatLegality` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/deckFormatLegality.ts`:

```ts
export interface CardFormatLegalityInfo {
  formatCode: string
  status: string
}

export interface DeckFormatLegality {
  formatCode: string
  formatName: string
  legal: boolean | null
}

/**
 * Rolls up per-card, per-format status into a per-format deck verdict.
 * A definite disqualification (banned or not_in_pool) always wins, even
 * if some other card in the deck has no legality data for that format —
 * "this deck contains a banned card" is a stronger, more useful signal
 * than "part of this deck's legality is unknown." Only when every card
 * has a definite, non-disqualifying status does the format count as
 * legal; if none disqualify but at least one is unknown, the verdict is
 * unknown (null), not a false "legal".
 */
export function computeDeckFormatLegality(
  formats: { code: string; name: string }[],
  cardLegalities: CardFormatLegalityInfo[][]
): DeckFormatLegality[] {
  return formats.map((format) => {
    let sawUnknown = false

    for (const cardRows of cardLegalities) {
      const row = cardRows.find((entry) => entry.formatCode === format.code)
      if (!row) {
        sawUnknown = true
        continue
      }
      if (row.status === 'banned' || row.status === 'not_in_pool') {
        return { formatCode: format.code, formatName: format.name, legal: false }
      }
    }

    return { formatCode: format.code, formatName: format.name, legal: sawUnknown ? null : true }
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/deckFormatLegality.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/deckFormatLegality.ts src/lib/deckFormatLegality.test.ts
git commit -m "Add computeDeckFormatLegality shared deck-level rollup"
```

---

### Task 8: Wire the rollup into `decks.ts` and `discover.ts`

**Files:**
- Modify: `src/lib/decks.ts`
- Modify: `src/lib/discover.ts`
- Test: `src/lib/decks.test.ts`
- Test: `src/lib/discover.test.ts`

**Interfaces:**
- Consumes: `computeDeckFormatLegality`/`DeckFormatLegality`/`CardFormatLegalityInfo` (Task 7).
- Produces: `formatLegality: DeckFormatLegality[]` added to `DeckSummary` (`decks.ts`) and `DiscoverDeck` (`discover.ts`) — used by Task 9's UI.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/decks.test.ts` (alongside the existing `getDecksWithOwnership` tests):

```ts
it('includes a per-format legality rollup for the deck', async () => {
  const { id: collectionId } = await seedCollection(prisma)
  await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
  await prisma.format.create({ data: { code: 'standard', name: 'Standard' } })
  await prisma.cardFormatLegality.create({
    data: { cardCode: '01001', formatCode: 'standard', status: 'banned', detail: null },
  })
  await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
  await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

  const [deck] = await getDecksWithOwnership(prisma, collectionId)

  expect(deck.formatLegality).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: false }])
})
```

Add to `src/lib/discover.test.ts` (alongside the existing tests):

```ts
it('includes a per-format legality rollup for the deck', async () => {
  const { id: collectionId } = await seedCollection(prisma)
  await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
  await prisma.format.create({ data: { code: 'standard', name: 'Standard' } })
  await prisma.cardFormatLegality.create({
    data: { cardCode: '01001', formatCode: 'standard', status: 'legal', detail: null },
  })
  await prisma.tournamentDeck.create({
    data: { id: 1, uuid: 'uuid-1', name: 'Test Deck', dateCreation: new Date('2020-01-01'), userName: 'alice' },
  })
  await prisma.tournamentDeckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

  const { decks } = await getDiscoverDecks(prisma, collectionId, { ...defaultFilters, maxMissingCards: 5 })

  expect(decks[0].formatLegality).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: true }])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/decks.test.ts src/lib/discover.test.ts`
Expected: FAIL — `formatLegality` is `undefined`.

- [ ] **Step 3: Implement in `decks.ts`**

In `src/lib/decks.ts`, add the import:

```ts
import { computeDeckFormatLegality, type DeckFormatLegality } from './deckFormatLegality'
```

Add `formatLegality: DeckFormatLegality[]` to the `DeckSummary` interface (after `cards`).

In `computeDeckSummary`, extend the initial `Promise.all` to also fetch every `Format` and each involved card's `CardFormatLegality` rows, then compute the rollup:

```ts
async function computeDeckSummary(
  prisma: PrismaClient,
  collectionId: number,
  deck: DeckWithCards
): Promise<DeckSummary> {
  const cardCodes = deck.cards.map((deckCard) => deckCard.cardCode)

  const [cards, collectionEntries, formats, legalityRows] = await Promise.all([
    prisma.card.findMany({ where: { code: { in: cardCodes } }, include: { faction: true } }),
    prisma.collectionEntry.findMany({ where: { collectionId, cardCode: { in: cardCodes } } }),
    prisma.format.findMany(),
    prisma.cardFormatLegality.findMany({ where: { cardCode: { in: cardCodes } } }),
  ])

  const cardByCode = new Map(cards.map((card) => [card.code, card]))
  const ownedByCode = new Map(collectionEntries.map((entry) => [entry.cardCode, entry.quantityOwned]))
  const identityCard = cards.find((card) => card.typeCode === 'identity')

  const legalityByCode = new Map<string, { formatCode: string; status: string }[]>()
  for (const row of legalityRows) {
    const list = legalityByCode.get(row.cardCode) ?? []
    list.push({ formatCode: row.formatCode, status: row.status })
    legalityByCode.set(row.cardCode, list)
  }

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

  const formatLegality = computeDeckFormatLegality(
    formats.map((format) => ({ code: format.code, name: format.name })),
    deck.cards.map((deckCard) => legalityByCode.get(deckCard.cardCode) ?? [])
  )

  return {
    id: deck.id,
    uuid: deck.uuid,
    name: deck.name,
    importedAt: deck.importedAt,
    ownedCount,
    totalCount,
    percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
    factionCode: identityCard?.factionCode ?? null,
    cards: cardOwnership,
    formatLegality,
  }
}
```

- [ ] **Step 4: Implement in `discover.ts`**

Replace the full contents of `src/lib/discover.ts` with:

```ts
import { Prisma, type PrismaClient } from '@prisma/client'
import { computeDeckFormatLegality, type DeckFormatLegality } from './deckFormatLegality'
import type { DeckCardOwnership } from './decks'

export interface DiscoverFilters {
  faction?: string
  maxMissingCards?: number
  nameQuery?: string
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
  formatLegality: DeckFormatLegality[]
}

interface DeckAggregateRow {
  id: number
  uuid: string
  name: string
  dateCreation: string
  userName: string
  factionCode: string | null
  totalCount: number | bigint
  ownedCount: number | bigint
  missingCopies: number | bigint
}

/** Escapes SQL LIKE wildcards (%, _) and the escape character itself, so a name search matches its literal characters, not SQLite's LIKE pattern syntax. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/**
 * The FROM/JOIN/GROUP BY/HAVING shared by the aggregate query and its
 * COUNT(*) sibling — computed once in SQLite (SUM/MIN/MAX per deck) so
 * neither query has to materialize the whole tournament-deck pool to
 * answer "give me page N of the buildable ones." LEFT JOINs (not INNER)
 * so a deck with zero cards still produces one row (0/0, fully buildable)
 * instead of vanishing, matching this function's previous in-memory
 * behavior.
 */
function aggregateFrom(
  collectionId: number,
  faction: string | undefined,
  maxMissingCards: number,
  nameQuery: string | undefined
) {
  const namePattern = nameQuery ? likePattern(nameQuery) : null
  return Prisma.sql`
    FROM TournamentDeck td
    LEFT JOIN TournamentDeckCard tdc ON tdc.deckId = td.id
    LEFT JOIN CollectionEntry ce ON ce.cardCode = tdc.cardCode AND ce.collectionId = ${collectionId}
    WHERE (${namePattern} IS NULL OR td.name LIKE ${namePattern} ESCAPE '\\')
    GROUP BY td.id
    HAVING COALESCE(SUM(MAX(tdc.quantity - COALESCE(ce.quantityOwned, 0), 0)), 0) <= ${maxMissingCards}
      AND (${faction ?? null} IS NULL OR td.factionCode = ${faction ?? null})
  `
}

function sortClause(sort: DiscoverFilters['sort']) {
  if (sort === 'newest') return Prisma.sql`ORDER BY td.dateCreation DESC, td.id ASC`
  if (sort === 'name') return Prisma.sql`ORDER BY td.name COLLATE NOCASE ASC, td.id ASC`
  return Prisma.sql`ORDER BY (CAST(ownedCount AS REAL) / NULLIF(totalCount, 0)) DESC, td.id ASC`
}

export async function getDiscoverDecks(
  prisma: PrismaClient,
  collectionId: number,
  filters: DiscoverFilters
): Promise<{ decks: DiscoverDeck[]; total: number }> {
  const maxMissingCards = filters.maxMissingCards ?? 0
  const from = aggregateFrom(collectionId, filters.faction, maxMissingCards, filters.nameQuery)

  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<DeckAggregateRow[]>`
      SELECT
        td.id AS id, td.uuid AS uuid, td.name AS name, td.dateCreation AS dateCreation,
        td.userName AS userName, td.factionCode AS factionCode,
        COALESCE(SUM(tdc.quantity), 0) AS totalCount,
        COALESCE(SUM(MIN(tdc.quantity, COALESCE(ce.quantityOwned, 0))), 0) AS ownedCount,
        COALESCE(SUM(MAX(tdc.quantity - COALESCE(ce.quantityOwned, 0), 0)), 0) AS missingCopies
      ${from}
      ${sortClause(filters.sort)}
      LIMIT ${filters.limit} OFFSET ${filters.offset}
    `,
    prisma.$queryRaw<{ total: number | bigint }[]>`
      SELECT COUNT(*) AS total FROM (SELECT td.id ${from})
    `,
  ])

  const total = Number(totalRows[0]?.total ?? 0)
  if (rows.length === 0) {
    return { decks: [], total }
  }

  const deckIds = rows.map((row) => row.id)
  const deckCards = await prisma.tournamentDeckCard.findMany({
    where: { deckId: { in: deckIds } },
    orderBy: { cardCode: 'asc' },
  })
  const cardCodes = [...new Set(deckCards.map((card) => card.cardCode))]

  const [knownCards, collectionEntries, formats, legalityRows] = await Promise.all([
    prisma.card.findMany({
      where: { code: { in: cardCodes } },
      select: { code: true, title: true, faction: { select: { name: true } } },
    }),
    prisma.collectionEntry.findMany({ where: { collectionId, cardCode: { in: cardCodes } } }),
    prisma.format.findMany(),
    prisma.cardFormatLegality.findMany({ where: { cardCode: { in: cardCodes } } }),
  ])

  const cardByCode = new Map(knownCards.map((card) => [card.code, card]))
  const ownedByCode = new Map(collectionEntries.map((entry) => [entry.cardCode, entry.quantityOwned]))

  const legalityByCode = new Map<string, { formatCode: string; status: string }[]>()
  for (const row of legalityRows) {
    const list = legalityByCode.get(row.cardCode) ?? []
    list.push({ formatCode: row.formatCode, status: row.status })
    legalityByCode.set(row.cardCode, list)
  }
  const formatList = formats.map((format) => ({ code: format.code, name: format.name }))

  const cardsByDeckId = new Map<number, DeckCardOwnership[]>()
  for (const deckCard of deckCards) {
    const card = cardByCode.get(deckCard.cardCode)
    const ownedQuantity = ownedByCode.get(deckCard.cardCode) ?? 0
    const cardOwnership: DeckCardOwnership = {
      code: deckCard.cardCode,
      title: card?.title ?? null,
      factionName: card?.faction.name ?? null,
      neededQuantity: deckCard.quantity,
      ownedQuantity,
      found: card !== undefined,
    }
    const existing = cardsByDeckId.get(deckCard.deckId)
    if (existing) existing.push(cardOwnership)
    else cardsByDeckId.set(deckCard.deckId, [cardOwnership])
  }

  const decks: DiscoverDeck[] = rows.map((row) => {
    const totalCount = Number(row.totalCount)
    const ownedCount = Number(row.ownedCount)
    const deckCardCodes = (cardsByDeckId.get(row.id) ?? []).map((card) => card.code)
    return {
      id: row.id,
      uuid: row.uuid,
      name: row.name,
      dateCreation: new Date(row.dateCreation),
      userName: row.userName,
      factionCode: row.factionCode,
      ownedCount,
      totalCount,
      percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
      missingCopies: Number(row.missingCopies),
      cards: cardsByDeckId.get(row.id) ?? [],
      formatLegality: computeDeckFormatLegality(
        formatList,
        deckCardCodes.map((code) => legalityByCode.get(code) ?? [])
      ),
    }
  })

  return { decks, total }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/decks.test.ts src/lib/discover.test.ts`
Expected: PASS.

- [ ] **Step 6: Keep the UI test fixtures typechecking**

`DeckSummary` and `DiscoverDeck` just gained a *required* `formatLegality` field. Two other test files construct object literals of these exact types and will fail `tsc --noEmit` (though not `vitest run`, which doesn't type-check) until they're updated — fix that now rather than leaving the build red for a whole task:

In `src/app/decks/DeckSection.test.tsx`, add `formatLegality: []` to the existing `sampleDeck` object literal (its `secondDeck` fixture is `{ ...sampleDeck, id: 2, ... }` and inherits the field automatically — don't edit it separately).

In `src/app/discover/DiscoverSection.test.tsx`, add `formatLegality: []` to the existing `sampleDeck` object literal (same reasoning for any deck derived from it via spread elsewhere in that file).

Task 9 (not this one) adds the actual UI and the tests that exercise non-empty `formatLegality` values — this step only keeps today's types consistent.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/decks.ts src/lib/discover.ts src/lib/decks.test.ts src/lib/discover.test.ts src/app/decks/DeckSection.test.tsx src/app/discover/DiscoverSection.test.tsx
git commit -m "Add per-format legality rollup to DeckSummary and DiscoverDeck"
```

---

### Task 9: Deck legality badges

**Files:**
- Modify: `src/app/decks/DeckSection.tsx`
- Modify: `src/app/discover/DiscoverSection.tsx`
- Test: `src/app/decks/DeckSection.test.tsx`
- Test: `src/app/discover/DiscoverSection.test.tsx`

**Interfaces:**
- Consumes: `formatLegality: DeckFormatLegality[]` on `DeckSummary` (Task 8, `src/lib/decks.ts`) and `DiscoverDeck` (Task 8, `src/lib/discover.ts`).

- [ ] **Step 1: Write the failing tests**

(Task 8 already added `formatLegality: []` to both files' `sampleDeck` fixtures, to keep the build typechecking in between tasks — no fixture edit needed here.)

Add to `src/app/decks/DeckSection.test.tsx`:

```tsx
it('shows a legal/not-legal badge per format when the deck is expanded', async () => {
  const deckWithLegality: DeckSummary = {
    ...sampleDeck,
    formatLegality: [
      { formatCode: 'standard', formatName: 'Standard', legal: true },
      { formatCode: 'startup', formatName: 'Startup', legal: false },
      { formatCode: 'eternal', formatName: 'Eternal', legal: null },
    ],
  }
  const user = userEvent.setup()
  render(<DeckSection initialDecks={[deckWithLegality]} factionOptions={factionOptions} />)

  await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

  expect(screen.getByText('Standard ✓')).toBeInTheDocument()
  expect(screen.getByText('Startup ✗')).toBeInTheDocument()
  expect(screen.getByText('Eternal ?')).toBeInTheDocument()
})

it('shows nothing when there is no format legality data at all', async () => {
  const user = userEvent.setup()
  render(<DeckSection initialDecks={[sampleDeck]} factionOptions={factionOptions} />)

  await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

  expect(screen.queryByText(/✓|✗/)).not.toBeInTheDocument()
})
```

Add to `src/app/discover/DiscoverSection.test.tsx` similarly (its `sampleDeck` fixture already has `formatLegality: []` from Task 8):

```tsx
it('shows a legal/not-legal badge per format when the deck is expanded', async () => {
  const deckWithLegality: DiscoverDeck = {
    ...sampleDeck,
    formatLegality: [
      { formatCode: 'standard', formatName: 'Standard', legal: true },
      { formatCode: 'startup', formatName: 'Startup', legal: false },
    ],
  }
  const user = userEvent.setup()
  render(
    <DiscoverSection initialDecks={[deckWithLegality]} initialTotal={1} savedDeckIds={[]} factionOptions={factionOptions} />
  )

  await user.click(screen.getByRole('button', { name: /^Test Deck/ }))

  expect(screen.getByText('Standard ✓')).toBeInTheDocument()
  expect(screen.getByText('Startup ✗')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/decks/DeckSection.test.tsx src/app/discover/DiscoverSection.test.tsx`
Expected: FAIL — the new tests' `getByText('Standard ✓')`-style assertions don't find anything, since the badge markup doesn't exist yet.

- [ ] **Step 3: Implement in `DeckSection.tsx`**

In `src/app/decks/DeckSection.tsx`, inside the expanded `{isOpen && (...)}` block, right after the `<DeckCardList cards={deck.cards} />` line, add:

```tsx
                    {deck.formatLegality.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                        {deck.formatLegality.map((entry) => (
                          <span
                            key={entry.formatCode}
                            className={
                              entry.legal === true ? 'text-success' : entry.legal === false ? 'text-danger' : 'text-faint'
                            }
                          >
                            {entry.formatName} {entry.legal === true ? '✓' : entry.legal === false ? '✗' : '?'}
                          </span>
                        ))}
                      </div>
                    )}
```

- [ ] **Step 4: Implement in `DiscoverSection.tsx`**

In `src/app/discover/DiscoverSection.tsx`, inside the expanded `{isOpen && (...)}` block, right after the `<DeckCardList cards={deck.cards} />` line, add the identical block:

```tsx
                    {deck.formatLegality.length > 0 && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                        {deck.formatLegality.map((entry) => (
                          <span
                            key={entry.formatCode}
                            className={
                              entry.legal === true ? 'text-success' : entry.legal === false ? 'text-danger' : 'text-faint'
                            }
                          >
                            {entry.formatName} {entry.legal === true ? '✓' : entry.legal === false ? '✗' : '?'}
                          </span>
                        ))}
                      </div>
                    )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/decks/DeckSection.test.tsx src/app/discover/DiscoverSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full suite, typecheck, and build**

Run: `npm test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Manual verification**

**This step can run `npm run import-cards` against the real `data/netrunner.db` — this is additive (new columns/tables plus backfilling `Card.cardId`, never deletes or overwrites existing collection/deck data) and is the intended way this feature's data gets populated, consistent with how every prior card-data feature in this app works. Read `data/netrunner.db`'s protection note in `CLAUDE.md` before starting regardless.**

1. Run `npm run import-cards`. Confirm the new "Importing format legality data..." log line appears and its summary reports `formats: 7` with a nonzero `cardsResolved`/`legalityRows`.
2. Run `npm run dev`, open a card popup for a well-known card (e.g. search for "Sure Gamble" on `/builder`) — confirm a "Format Legality" section appears listing multiple formats with sensible-looking statuses (e.g. `legal` for most, given Sure Gamble is a very old, uncontroversial card).
3. Open `/decks` (My Decks) and expand a saved deck — confirm format badges appear if that deck's cards have legality data, or nothing appears if not (both are valid depending on whether `import-cards` picked up matching v2 printings for those specific cards).
4. Open `/discover` and expand a deck similarly.

- [ ] **Step 8: Commit**

```bash
git add src/app/decks/DeckSection.tsx src/app/discover/DiscoverSection.tsx src/app/decks/DeckSection.test.tsx src/app/discover/DiscoverSection.test.tsx
git commit -m "Show per-format legality badges on expanded deck views"
```
