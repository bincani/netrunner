# Multi-Collection Support, Phase 2 (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user-facing multi-collection feature on top of Phase 1's foundation: a `/collections` management page (create, rename, delete, set-default, CSV export/import), a persistent nav indicator of the current default collection, and CSV import rebuilt as a reviewable Batch rather than a direct write — which requires `Batch` itself to become collection-scoped.

**Architecture:** `Batch` gains a required `collectionId`, backfilled to the current default collection via a hand-guided SQLite migration (same shape as Phase 1's `CollectionEntry` migration). `startBatch`/`getActiveBatch` become collection-scoped, turning "only one active batch" into "only one active batch per collection." CSV import becomes `importCsvAsBatch` — it parses and validates a CSV the same way Phase 1's (now-deleted) `importCollectionCsv` did, but writes a `Batch` + `BatchCard` rows instead of `CollectionEntry` rows directly, so the existing, already-tested review/approve/discard machinery (and `BatchReviewModal`, reused verbatim) handles the actual merge. The Builder page's own behavior is untouched — it always resolves `getDefaultCollectionId()` internally, so with one collection nothing about today's Builder experience changes.

**Tech Stack:** Next.js (App Router) server components/actions, Prisma/SQLite, Vitest, Testing Library.

## Global Constraints

- **This touches real, irreplaceable user data.** Task 1 migrates the real `Batch` table (currently 7 real rows in `data/netrunner.db`) — smaller than Phase 1's `CollectionEntry` migration, but treated with the identical care: back up first, dry-run against a copy, verify row counts, only then apply to the real database.
- **`npx prisma migrate dev --create-only` does not work non-interactively in this environment.** Phase 1's Task 1 confirmed this by direct run, piped `yes`, and `script` pty-wrapping — all failed identically, because `migrate dev` refuses to run without a real interactive terminal once it detects a data-loss-risk step (adding a required column to a non-empty table, exactly this migration's shape). Task 1 below uses the confirmed-working non-interactive alternative directly: `npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --script`.
- **This plan cannot keep the whole test suite green after every single task**, same as Phase 1. Task 1's schema change (`Batch.collectionId` becomes required) breaks `src/lib/batches.test.ts` and `src/actions/batchMutations.test.ts` simultaneously — both files call `prisma.batch.create()` or `startBatch()` without a `collectionId`, and there is no way to migrate the schema without breaking both at once. Instead:
  - Task 1 verifies migration *data correctness* directly (row count matches, every row's `collectionId` resolves to the real default collection) rather than via `npm test`.
  - Tasks 2-8 each verify only *their own* test file(s), explicitly not the whole suite.
  - Only Task 9 (last) requires and verifies a fully clean `npm test && npx tsc --noEmit`.
  - Do not "fix" an out-of-scope compile error in an earlier task; it resolves itself when that file's own task runs.
- `collectionId` is inserted as the parameter immediately after `prisma` in every retrofitted function, matching Phase 1's established convention.
- The Builder page's own behavior must not change. `BatchBuilderForm.tsx` needs **zero changes** — it already calls the action layer (`@/actions/batchActions`) with the same public signatures; `collectionId` resolution happens inside those actions (via `getDefaultCollectionId`), never passed from the client. If a step in this plan touches `BatchBuilderForm.tsx`, stop and re-read Task 2 — that's a sign something has gone wrong.
- `discardBatch` (existing, in `src/actions/batchActions.ts`) is reused as-is for discarding an import-created batch too — it's already purely `batchId`-scoped. It gains one additional `revalidatePath('/collections')` call (Task 2) so the Collections page's "pending review" state clears correctly; no new discard action is created.
- Compound-key Prisma inputs use `batchId_cardCode` / `collectionId_cardCode`, matching this schema's existing convention — unchanged by this plan.
- Spec: `docs/superpowers/specs/2026-08-09-multi-collection-phase2-ui-design.md`.

---

### Task 1: Schema, migration, and pre-migration backup for `Batch.collectionId`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: a new migration under `prisma/migrations/`

**Interfaces:**
- Produces (used by every later task): `Batch.collectionId Int` with a `collection Collection @relation(...)` FK (`onDelete: Cascade`), and `Collection.batches Batch[]` inverse relation.

- [ ] **Step 1: Back up the real database before touching anything**

Run, from `/var/www/netrunner`:

```bash
cp data/netrunner.db "data/netrunner.db.pre-batch-collection-backup-$(date -u +%Y%m%dT%H%M%SZ)"
```

Expected: a new `data/netrunner.db.pre-batch-collection-backup-<timestamp>` file exists, same size as `data/netrunner.db`. (This filename matches Phase 1's `.gitignore` fix — `data/netrunner.db.*` — so it's already excluded from `git add`; no separate ignore-rule change is needed here.)

Also record the current real `Batch` row count, needed for Step 4/5's verification:

```bash
npx tsx -e "
import { prisma } from './src/lib/db'
async function main() {
  const count = await prisma.batch.count()
  console.log('pre-migration Batch row count:', count)
  await prisma.\$disconnect()
}
main()
"
```

Expected output: `pre-migration Batch row count: 7`. If your real count differs from 7 (more batches may have been created since this plan was written), use *your* actual number for every later verification step in this task — the exact value doesn't matter, but it must match exactly at every checkpoint.

- [ ] **Step 2: Update the schema**

In `prisma/schema.prisma`, replace the `Batch` model:

```prisma
model Batch {
  id            Int         @id @default(autoincrement())
  name          String
  expectedCount Int
  /// 'running' | 'paused' | 'stopped' | 'approved' | 'discarded'
  status        String
  startedAt     DateTime    @default(now())
  /// Accumulated active (non-paused) time in milliseconds.
  elapsedMs     Int         @default(0)
  /// Set when status is 'running'; null otherwise. Live elapsed while
  /// running = elapsedMs + (now - lastResumedAt).
  lastResumedAt DateTime?
  cards         BatchCard[]
}
```

with:

```prisma
model Batch {
  id            Int         @id @default(autoincrement())
  collectionId  Int
  collection    Collection  @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  name          String
  expectedCount Int
  /// 'running' | 'paused' | 'stopped' | 'approved' | 'discarded'
  status        String
  startedAt     DateTime    @default(now())
  /// Accumulated active (non-paused) time in milliseconds.
  elapsedMs     Int         @default(0)
  /// Set when status is 'running'; null otherwise. Live elapsed while
  /// running = elapsedMs + (now - lastResumedAt).
  lastResumedAt DateTime?
  cards         BatchCard[]
}
```

Also add the inverse relation to the `Collection` model — change:

```prisma
model Collection {
  id        Int               @id @default(autoincrement())
  name      String
  isDefault Boolean           @default(false)
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  entries   CollectionEntry[]
}
```

to:

```prisma
model Collection {
  id        Int               @id @default(autoincrement())
  name      String
  isDefault Boolean           @default(false)
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  entries   CollectionEntry[]
  batches   Batch[]
}
```

- [ ] **Step 3: Generate the migration diff (non-interactive)**

Run:

```bash
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --script > /tmp/batch-collection-migration.sql
```

This produces the same table-recreation SQL `prisma migrate dev` would generate interactively (SQLite can't add a required FK column via plain `ALTER TABLE`), but non-interactively — confirmed working in this exact environment during Phase 1's Task 1. Read `/tmp/batch-collection-migration.sql`. It should have this overall shape (constraint names may differ slightly — what matters is the order of operations and the backfill subquery, not the exact generated names):

```sql
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
CREATE TABLE "new_Batch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "collectionId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "expectedCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "elapsedMs" INTEGER NOT NULL DEFAULT 0,
    "lastResumedAt" DATETIME,
    CONSTRAINT "Batch_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Batch" ("id", "name", "expectedCount", "status", "startedAt", "elapsedMs", "lastResumedAt")
SELECT "id", "name", "expectedCount", "status", "startedAt", "elapsedMs", "lastResumedAt" FROM "Batch";
DROP TABLE "Batch";
ALTER TABLE "new_Batch" RENAME TO "Batch";
PRAGMA foreign_keys=ON;
```

The generated `INSERT` will be missing `collectionId` entirely (or fail) since Prisma has no way to infer the backfill target — that's expected, fixed in the next step.

- [ ] **Step 4: Hand-edit the migration to backfill `collectionId`**

Edit the `INSERT INTO "new_Batch"` statement to include `collectionId`, backfilling every row to the current default collection via a subquery (not a hardcoded id):

```sql
INSERT INTO "new_Batch" ("id", "collectionId", "name", "expectedCount", "status", "startedAt", "elapsedMs", "lastResumedAt")
SELECT "id", (SELECT "id" FROM "Collection" WHERE "isDefault" = true LIMIT 1), "name", "expectedCount", "status", "startedAt", "elapsedMs", "lastResumedAt" FROM "Batch";
```

Create the migration folder and place the file:

```bash
mkdir -p "prisma/migrations/$(date -u +%Y%m%d%H%M%S)_add_batch_collection_id"
cp /tmp/batch-collection-migration.sql "prisma/migrations/$(date -u +%Y%m%d%H%M%S)_add_batch_collection_id/migration.sql"
```

(Run these as two separate commands, not both using `$(date ...)` in the same invocation — the two calls could land in different seconds and produce mismatched folder names. Run `mkdir` first, note the exact folder name it created, then `cp` into that exact path.)

- [ ] **Step 5: Dry-run the migration against a copy of the real database first**

```bash
mkdir -p /tmp/batch-collection-migration-dryrun
cp data/netrunner.db /tmp/batch-collection-migration-dryrun/test.db
DATABASE_URL="file:/tmp/batch-collection-migration-dryrun/test.db" npx prisma migrate deploy
```

Then verify:

```bash
DATABASE_URL="file:/tmp/batch-collection-migration-dryrun/test.db" npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const batchCount = await prisma.batch.count()
  console.log('batch count:', batchCount)
  const defaultCollection = await prisma.collection.findFirst({ where: { isDefault: true } })
  console.log('default collection id:', defaultCollection?.id)
  const wrongCollection = await prisma.batch.findMany({ where: { collectionId: { not: defaultCollection?.id } } })
  console.log('batches NOT pointing at the default collection (should be empty):', wrongCollection)
  await prisma.\$disconnect()
}
main()
"
```

Expected: `batch count` matches the pre-migration count you recorded in Step 1 exactly, and the "batches NOT pointing at the default collection" array is empty. **If either check fails, stop — do not proceed to Step 6. Report the discrepancy.**

- [ ] **Step 6: Apply the migration to the real database**

Only after Step 5's checks all pass:

```bash
npx prisma migrate deploy
```

Then re-run the same verification query from Step 5 (adjusted to use the default `DATABASE_URL`, i.e. no `DATABASE_URL=` override) against the real `data/netrunner.db`. Same expected results — batch count matches the pre-migration count, zero batches pointing anywhere but the default collection.

- [ ] **Step 7: Verify**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Do **not** run `npx vitest run src/lib/batches.test.ts` or `src/actions/batchMutations.test.ts` yet — both are expected to fail until Task 2 retrofits `startBatch`/`getActiveBatch`. Do **not** run the full `npm test` or `npx tsc --noEmit` — per this plan's Global Constraints, the codebase will not compile cleanly until Task 2 completes.

- [ ] **Step 8: Clean up the dry-run artifacts**

```bash
rm -rf /tmp/batch-collection-migration-dryrun /tmp/batch-collection-migration.sql
```

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "Add Batch.collectionId, scope batches to a collection, migrate existing data"
```

Do not commit the `.pre-batch-collection-backup-*` file — it stays local as a safety net (already covered by the `data/netrunner.db.*` `.gitignore` rule from Phase 1's final review; `git status` should confirm it's not staged).

---

### Task 2: Retrofit `startBatch`/`getActiveBatch` for collection-scoping

**Files:**
- Modify: `src/lib/batches.ts`
- Modify: `src/lib/batches.test.ts`
- Modify: `src/actions/batchMutations.ts`
- Modify: `src/actions/batchMutations.test.ts`
- Modify: `src/actions/batchActions.ts`
- Modify: `src/app/builder/page.tsx`

**Interfaces:**
- Consumes: `getDefaultCollectionId` (Phase 1, `src/lib/collections.ts`).
- Produces (used by Tasks 3-8): `startBatch(prisma, collectionId, expectedCount)`, `getActiveBatch(prisma, collectionId)`, `formatBatchName(date, prefix)` (moved here from `batchMutations.ts` so Task 3's `importCsvAsBatch` can reuse it without an incorrect `lib` → `actions` dependency).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/lib/batches.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { getActiveBatch, listArchivedBatches, formatElapsedMs, formatBatchName } from './batches'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.batchCard.deleteMany()
  await prisma.batch.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.card.deleteMany()
})

describe('getActiveBatch', () => {
  it('returns null when there is no active batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    expect(await getActiveBatch(prisma, collectionId)).toBeNull()
  })

  it('returns a running batch with its live count and card list', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batch = await prisma.batch.create({
      data: {
        collectionId,
        name: 'Batch Test',
        expectedCount: 10,
        status: 'running',
        elapsedMs: 0,
        lastResumedAt: new Date(),
      },
    })
    await prisma.batchCard.create({ data: { batchId: batch.id, cardCode: '01001', quantity: 3 } })

    const active = await getActiveBatch(prisma, collectionId)

    expect(active?.status).toBe('running')
    expect(active?.currentCount).toBe(3)
    expect(active?.cards).toEqual([{ code: '01001', title: 'Card A', quantity: 3 }])
  })

  it('does not return an approved or discarded batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.batch.create({
      data: { collectionId, name: 'Done', expectedCount: 10, status: 'approved', elapsedMs: 1000, lastResumedAt: null },
    })

    expect(await getActiveBatch(prisma, collectionId)).toBeNull()
  })

  it('computes live elapsed time for a running batch from lastResumedAt', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    vi.useFakeTimers()
    const start = new Date('2026-01-01T00:00:00Z')
    vi.setSystemTime(start)
    await prisma.batch.create({
      data: { collectionId, name: 'Batch Test', expectedCount: 10, status: 'running', elapsedMs: 5000, lastResumedAt: start },
    })

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const active = await getActiveBatch(prisma, collectionId)

    expect(active?.elapsedMs).toBe(15000)
    vi.useRealTimers()
  })

  it('returns the persisted elapsed time as-is for a paused batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.batch.create({
      data: { collectionId, name: 'Batch Test', expectedCount: 10, status: 'paused', elapsedMs: 7000, lastResumedAt: null },
    })

    const active = await getActiveBatch(prisma, collectionId)

    expect(active?.elapsedMs).toBe(7000)
  })

  it("only reflects the given collection's active batch, not another collection's", async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await prisma.batch.create({
      data: { collectionId: b.id, name: 'Batch in B', expectedCount: 10, status: 'running', elapsedMs: 0, lastResumedAt: new Date() },
    })

    expect(await getActiveBatch(prisma, a.id)).toBeNull()
    expect((await getActiveBatch(prisma, b.id))?.name).toBe('Batch in B')
  })
})

describe('listArchivedBatches', () => {
  it('returns an empty list when nothing is archived', async () => {
    expect(await listArchivedBatches(prisma)).toEqual([])
  })

  it('returns approved and discarded batches, most recent first', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.batch.create({
      data: {
        collectionId,
        name: 'Older',
        expectedCount: 10,
        status: 'approved',
        elapsedMs: 0,
        startedAt: new Date('2026-01-01'),
      },
    })
    await prisma.batch.create({
      data: {
        collectionId,
        name: 'Newer',
        expectedCount: 10,
        status: 'discarded',
        elapsedMs: 0,
        startedAt: new Date('2026-02-01'),
      },
    })

    const archived = await listArchivedBatches(prisma)

    expect(archived.map((b) => b.name)).toEqual(['Newer', 'Older'])
  })

  it('excludes an active batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.batch.create({
      data: { collectionId, name: 'Active', expectedCount: 10, status: 'running', elapsedMs: 0 },
    })

    expect(await listArchivedBatches(prisma)).toEqual([])
  })

  it('includes archived batches from every collection, not just one', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await prisma.batch.create({
      data: { collectionId: a.id, name: 'From A', expectedCount: 10, status: 'approved', elapsedMs: 0 },
    })
    await prisma.batch.create({
      data: { collectionId: b.id, name: 'From B', expectedCount: 10, status: 'discarded', elapsedMs: 0 },
    })

    const archived = await listArchivedBatches(prisma)

    expect(archived.map((batch) => batch.name).sort()).toEqual(['From A', 'From B'])
  })
})

describe('formatBatchName', () => {
  it('formats with the given prefix, zero-padded', () => {
    expect(formatBatchName(new Date('2026-03-05T09:07:00'), 'Batch')).toBe('Batch 2026-03-05 09:07')
  })

  it('supports a different prefix for import-created batches', () => {
    expect(formatBatchName(new Date('2026-03-05T09:07:00'), 'Import')).toBe('Import 2026-03-05 09:07')
  })
})

describe('formatElapsedMs', () => {
  it('formats minutes and seconds, zero-padding seconds', () => {
    expect(formatElapsedMs(65000)).toBe('1:05')
  })

  it('formats zero as 0:00', () => {
    expect(formatElapsedMs(0)).toBe('0:00')
  })

  it('formats over an hour as accumulated minutes, not hours', () => {
    expect(formatElapsedMs(3665000)).toBe('61:05')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/batches.test.ts`
Expected: FAIL — `getActiveBatch` doesn't accept a `collectionId` argument yet, `formatBatchName` doesn't exist yet, and the `Batch.collectionId` field required by the fixture data is not yet handled by `batches.ts` (though the schema itself already has it from Task 1).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/lib/batches.ts` with:

```ts
import type { PrismaClient } from '@prisma/client'

export type BatchStatus = 'running' | 'paused' | 'stopped' | 'approved' | 'discarded'

export interface BatchCardEntry {
  code: string
  title: string
  quantity: number
}

export interface BatchSummary {
  id: number
  name: string
  expectedCount: number
  status: BatchStatus
  currentCount: number
  elapsedMs: number
  cards: BatchCardEntry[]
}

export function formatBatchName(date: Date, prefix: string): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix} ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function liveElapsedMs(elapsedMs: number, lastResumedAt: Date | null): number {
  if (!lastResumedAt) return elapsedMs
  return elapsedMs + (Date.now() - lastResumedAt.getTime())
}

interface BatchWithCards {
  id: number
  name: string
  expectedCount: number
  status: string
  elapsedMs: number
  lastResumedAt: Date | null
  cards: { cardCode: string; quantity: number; card: { title: string } }[]
}

function toSummary(batch: BatchWithCards): BatchSummary {
  return {
    id: batch.id,
    name: batch.name,
    expectedCount: batch.expectedCount,
    status: batch.status as BatchStatus,
    currentCount: batch.cards.reduce((sum, card) => sum + card.quantity, 0),
    elapsedMs: liveElapsedMs(batch.elapsedMs, batch.lastResumedAt),
    cards: batch.cards.map((card) => ({ code: card.cardCode, title: card.card.title, quantity: card.quantity })),
  }
}

const BATCH_CARDS_INCLUDE = {
  cards: { include: { card: { select: { title: true } } }, orderBy: { cardCode: 'asc' as const } },
}

export async function getActiveBatch(prisma: PrismaClient, collectionId: number): Promise<BatchSummary | null> {
  const batch = await prisma.batch.findFirst({
    where: { collectionId, status: { in: ['running', 'paused', 'stopped'] } },
    include: BATCH_CARDS_INCLUDE,
  })
  return batch ? toSummary(batch) : null
}

export async function listArchivedBatches(prisma: PrismaClient): Promise<BatchSummary[]> {
  const batches = await prisma.batch.findMany({
    where: { status: { in: ['approved', 'discarded'] } },
    include: BATCH_CARDS_INCLUDE,
    orderBy: { startedAt: 'desc' },
  })
  return batches.map(toSummary)
}
```

`listArchivedBatches` is deliberately left global (unscoped by collection) — Batch History remains a single archive across every collection, matching this plan's spec.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/batches.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Write the failing tests for `batchMutations.ts`**

Replace the full contents of `src/actions/batchMutations.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection } from '@/lib/testFixtures'
import { getOwnedQuantity } from '@/lib/collection'
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
  removeFromBatch,
} from './batchMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.batchCard.deleteMany()
  await prisma.batch.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.card.deleteMany()
})

describe('startBatch', () => {
  it('creates a running batch with a timestamp-based name', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.expectedCount).toBe(60)
    expect(batch.name).toMatch(/^Batch \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(batch.lastResumedAt).not.toBeNull()
    expect(batch.collectionId).toBe(collectionId)
  })

  it('rejects a non-positive expected count', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await expect(startBatch(prisma, collectionId, 0)).rejects.toThrow('expectedCount must be a positive integer')
  })

  it('rejects starting a second batch in the same collection while one is already active', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await startBatch(prisma, collectionId, 60)

    await expect(startBatch(prisma, collectionId, 40)).rejects.toThrow('already active')
  })

  it('allows starting a batch in a different collection while one is active elsewhere', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await startBatch(prisma, a.id, 60)

    const batchId = await startBatch(prisma, b.id, 40)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.collectionId).toBe(b.id)
  })
})

describe('addCardToBatch', () => {
  it('adds a new card to the batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const cards = await prisma.batchCard.findMany({ where: { batchId } })
    expect(cards).toEqual([{ batchId, cardCode: '01001', quantity: 3 }])
  })

  it('accumulates quantity across repeated adds of the same card', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)

    await addCardToBatch(prisma, batchId, '01001', 2)
    await addCardToBatch(prisma, batchId, '01001', 1)

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(3)
  })

  it('does not touch the real collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(0)
  })

  it('auto-stops the batch once the expected count is reached', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
    expect(batch.lastResumedAt).toBeNull()
  })

  it('does not auto-stop before the expected count is reached', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)

    await addCardToBatch(prisma, batchId, '01001', 2)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('rejects adding to a batch that is not running', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await pauseBatch(prisma, batchId)

    await expect(addCardToBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "paused"')
  })
})

describe('pauseBatch / continueBatch', () => {
  it('pausing freezes the elapsed time and clears lastResumedAt', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, collectionId, 60)

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toBeNull()
    vi.useRealTimers()
  })

  it('continuing resumes from paused without losing the accumulated elapsed time', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, collectionId, 60)
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, batchId)

    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'))
    await continueBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toEqual(new Date('2026-01-01T00:05:00Z'))
    vi.useRealTimers()
  })

  it('rejects pausing a batch that is not running', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)
    await pauseBatch(prisma, batchId)

    await expect(pauseBatch(prisma, batchId)).rejects.toThrow('status "paused"')
  })

  it('rejects continuing a batch that is not paused', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)

    await expect(continueBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })

  it('rejects continuing a batch that has auto-stopped — stopped is a dead end, no Continue', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await expect(continueBatch(prisma, batchId)).rejects.toThrow('status "stopped"')
  })
})

describe('discardBatch', () => {
  it('archives a paused batch as discarded without touching the collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(0)
  })

  it('archives a stopped batch as discarded', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
  })

  it('rejects discarding a running batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)

    await expect(discardBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })
})

describe('approveBatch', () => {
  it('merges every batch card into the collection and archives the batch as approved', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await addCardToBatch(prisma, batchId, '01002', 2)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(3)
    expect(await getOwnedQuantity(prisma, collectionId, '01002')).toBe(2)
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('approved')
  })

  it('adds to an existing owned quantity rather than overwriting it', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.collectionEntry.create({ data: { collectionId, cardCode: '01001', quantityOwned: 2 } })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(5)
  })

  it("bumps the collection's updatedAt", async () => {
    const { id: collectionId, updatedAt: originalUpdatedAt } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, collectionId, batchId)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(collection.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  it('rejects approving a running batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, collectionId, 60)

    await expect(approveBatch(prisma, collectionId, batchId)).rejects.toThrow('status "running"')
  })

  it('can approve a batch into a different collection than the one it was started in', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, a.id, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, b.id, batchId)

    expect(await getOwnedQuantity(prisma, a.id, '01001')).toBe(0)
    expect(await getOwnedQuantity(prisma, b.id, '01001')).toBe(3)
  })
})

describe('removeFromBatch', () => {
  it("reduces a card's quantity by a partial amount, keeping the row", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await removeFromBatch(prisma, batchId, '01001', 1)

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(2)
  })

  it('deletes the row when removing its full quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await removeFromBatch(prisma, batchId, '01001', 3)

    const card = await prisma.batchCard.findUnique({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card).toBeNull()
  })

  it('rejects removing more than the current quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 2)

    await expect(removeFromBatch(prisma, batchId, '01001', 3)).rejects.toThrow('only 2 in the batch')
  })

  it('rejects on an approved batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 1)
    await addCardToBatch(prisma, batchId, '01001', 1)
    await approveBatch(prisma, collectionId, batchId)

    await expect(removeFromBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "approved"')
  })

  it('rejects on a discarded batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 1)
    await pauseBatch(prisma, batchId)
    await discardBatch(prisma, batchId)

    await expect(removeFromBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "discarded"')
  })

  it('reverts a stopped batch to paused when the removal drops the count below the target', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)
    let batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await removeFromBatch(prisma, batchId, '01001', 1)

    batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
  })

  it('stays stopped if the remaining count is still at or above the target', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 3)
    await addCardToBatch(prisma, batchId, '01001', 2)
    await addCardToBatch(prisma, batchId, '01002', 2)
    let batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await removeFromBatch(prisma, batchId, '01002', 1)

    batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
  })

  it('does not change status when removing from a running batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await removeFromBatch(prisma, batchId, '01001', 1)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('does not change status when removing from an already-paused batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, collectionId, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await removeFromBatch(prisma, batchId, '01001', 1)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run src/actions/batchMutations.test.ts`
Expected: FAIL — `startBatch` doesn't accept a `collectionId` argument yet.

- [ ] **Step 7: Write the implementation**

In `src/actions/batchMutations.ts`, replace the top of the file (imports and `formatBatchName`/`startBatch`):

```ts
import type { PrismaClient } from '@prisma/client'
import { touchCollection } from '@/lib/collections'

function formatBatchName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Batch ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function freeze(
  prisma: PrismaClient,
  batchId: number,
  lastResumedAt: Date,
  status: 'paused' | 'stopped'
): Promise<void> {
  const elapsedDelta = Date.now() - lastResumedAt.getTime()
  await prisma.batch.update({
    where: { id: batchId },
    data: { status, elapsedMs: { increment: elapsedDelta }, lastResumedAt: null },
  })
}

export async function startBatch(prisma: PrismaClient, expectedCount: number): Promise<number> {
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new Error(`expectedCount must be a positive integer, got ${expectedCount}`)
  }

  const existing = await prisma.batch.findFirst({
    where: { status: { in: ['running', 'paused', 'stopped'] } },
  })
  if (existing) {
    throw new Error('A batch is already active — review or finish it before starting a new one')
  }

  const now = new Date()
  const batch = await prisma.batch.create({
    data: {
      name: formatBatchName(now),
      expectedCount,
      status: 'running',
      startedAt: now,
      elapsedMs: 0,
      lastResumedAt: now,
    },
  })
  return batch.id
}
```

with:

```ts
import type { PrismaClient } from '@prisma/client'
import { touchCollection } from '@/lib/collections'
import { formatBatchName, getActiveBatch } from '@/lib/batches'

async function freeze(
  prisma: PrismaClient,
  batchId: number,
  lastResumedAt: Date,
  status: 'paused' | 'stopped'
): Promise<void> {
  const elapsedDelta = Date.now() - lastResumedAt.getTime()
  await prisma.batch.update({
    where: { id: batchId },
    data: { status, elapsedMs: { increment: elapsedDelta }, lastResumedAt: null },
  })
}

export async function startBatch(prisma: PrismaClient, collectionId: number, expectedCount: number): Promise<number> {
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new Error(`expectedCount must be a positive integer, got ${expectedCount}`)
  }

  const existing = await getActiveBatch(prisma, collectionId)
  if (existing) {
    throw new Error('A batch is already active — review or finish it before starting a new one')
  }

  const now = new Date()
  const batch = await prisma.batch.create({
    data: {
      collectionId,
      name: formatBatchName(now, 'Batch'),
      expectedCount,
      status: 'running',
      startedAt: now,
      elapsedMs: 0,
      lastResumedAt: now,
    },
  })
  return batch.id
}
```

The "already active" check now reuses `getActiveBatch` (Step 3 above) instead of a duplicate raw query — one source of truth for what counts as an active batch. Every other function in this file (`addCardToBatch`, `pauseBatch`, `continueBatch`, `discardBatch`, `approveBatch`, `removeFromBatch`) is **unchanged** — leave them exactly as they are.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/actions/batchMutations.test.ts`
Expected: PASS (32 tests).

- [ ] **Step 9: Update `batchActions.ts`'s callers**

Replace the full contents of `src/actions/batchActions.ts` with:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getActiveBatch, type BatchSummary } from '@/lib/batches'
import { getDefaultCollectionId } from '@/lib/collections'
import {
  startBatch as startBatchMutation,
  addCardToBatch as addCardToBatchMutation,
  pauseBatch as pauseBatchMutation,
  continueBatch as continueBatchMutation,
  discardBatch as discardBatchMutation,
  approveBatch as approveBatchMutation,
  removeFromBatch as removeFromBatchMutation,
} from './batchMutations'

export type BatchActionResult = { ok: true; batch: BatchSummary } | { ok: false; error: string }
export type SimpleActionResult = { ok: true } | { ok: false; error: string }

// Every exported action's entire body — mutation, the getActiveBatch
// read, and all revalidatePath calls — must run inside this try/catch, so
// a thrown error (Prisma or otherwise) always converts to { ok: false }
// instead of escaping the Server Action uncaught (where production builds
// strip it to a generic minified message).
async function withActiveBatch(collectionId: number, mutate: () => Promise<unknown>): Promise<BatchActionResult> {
  try {
    await mutate()
    const batch = await getActiveBatch(prisma, collectionId)
    if (!batch) {
      return { ok: false, error: 'No active batch' }
    }
    revalidatePath('/builder')
    return { ok: true, batch }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function startBatch(expectedCount: number): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => startBatchMutation(prisma, collectionId, expectedCount))
}

export async function addCardToBatch(batchId: number, cardCode: string, amount: number): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => addCardToBatchMutation(prisma, batchId, cardCode, amount))
}

export async function pauseBatch(batchId: number): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => pauseBatchMutation(prisma, batchId))
}

export async function continueBatch(batchId: number): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => continueBatchMutation(prisma, batchId))
}

export async function discardBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    await discardBatchMutation(prisma, batchId)
    revalidatePath('/builder')
    revalidatePath('/builder/batches')
    revalidatePath('/collections')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function approveBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    const collectionId = await getDefaultCollectionId(prisma)
    await approveBatchMutation(prisma, collectionId, batchId)
    revalidatePath('/')
    revalidatePath('/sets/[packCode]', 'page')
    revalidatePath('/builder')
    revalidatePath('/builder/batches')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function removeFromBatch(
  batchId: number,
  cardCode: string,
  amount: number
): Promise<BatchActionResult> {
  const collectionId = await getDefaultCollectionId(prisma)
  return withActiveBatch(collectionId, () => removeFromBatchMutation(prisma, batchId, cardCode, amount))
}
```

`discardBatch`'s new `revalidatePath('/collections')` call is the one addition beyond collectionId-threading — it's harmless when nobody has visited `/collections` yet, and is what keeps Task 8's "pending review" state from going stale after a discard. (No test file exists for `batchActions.ts` — matches this codebase's existing convention of not unit-testing thin `*Actions.ts` wrappers.)

- [ ] **Step 10: Update the Builder page**

Replace the full contents of `src/app/builder/page.tsx` with:

```tsx
import { prisma } from '@/lib/db'
import { getBuilderMode } from '@/actions/settingsMutations'
import { getActiveBatch } from '@/lib/batches'
import { getDefaultCollectionId } from '@/lib/collections'
import { CardBuilderForm } from './CardBuilderForm'
import { BatchBuilderForm } from './BatchBuilderForm'

// Reflects live DB state (the Builder Mode setting, any active batch) —
// not something to freeze into a build-time snapshot. See the
// dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function BuilderPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const [builderMode, activeBatch] = await Promise.all([getBuilderMode(prisma), getActiveBatch(prisma, collectionId)])

  // An in-progress batch is shown regardless of the current Builder Mode
  // setting — otherwise switching the setting mid-batch would strand it
  // with no way to reach it from the UI.
  const showBatchMode = builderMode === 'batch' || activeBatch !== null

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Collection Builder</h1>
      {showBatchMode ? <BatchBuilderForm activeBatch={activeBatch} /> : <CardBuilderForm />}
    </main>
  )
}
```

`BatchBuilderForm.tsx` itself needs **no changes** — confirm you haven't touched it. It already calls the action-layer functions by their existing public signatures (`startBatch(expectedCount)`, etc.), and `collectionId` resolution now happens inside those actions.

- [ ] **Step 11: Commit**

```bash
git add src/lib/batches.ts src/lib/batches.test.ts src/actions/batchMutations.ts src/actions/batchMutations.test.ts src/actions/batchActions.ts src/app/builder/page.tsx
git commit -m "Retrofit startBatch/getActiveBatch for collection-scoping"
```

Per this plan's Global Constraints, the whole-suite `npm test`/`tsc --noEmit` still won't pass yet (`collections.ts` doesn't yet have `importCsvAsBatch`, the Collections page doesn't exist) — expected.

---

### Task 3: `importCsvAsBatch` — CSV import as a reviewable batch

**Files:**
- Modify: `src/lib/collections.ts`
- Modify: `src/lib/collections.test.ts`

**Interfaces:**
- Consumes: `parseCsv` (existing private helper in this file, reused as-is), `formatBatchName`, `getActiveBatch` (Task 2, `src/lib/batches.ts`), `touchCollection` (existing).
- Produces (used by Task 5): `ImportBatchResult`, `importCsvAsBatch(prisma, collectionId, csvText)`. `importCollectionCsv` and `ImportResult` are **deleted** — nothing calls them after this task.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/lib/collections.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import {
  getDefaultCollectionId,
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvAsBatch,
} from './collections'
import { exportCollectionCsv, incrementOwned } from './collection'
import { approveBatch } from '@/actions/batchMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.batchCard.deleteMany()
  await prisma.batch.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.card.deleteMany()
})

describe('getDefaultCollectionId', () => {
  it('returns the id of the collection marked default', async () => {
    await seedCollection(prisma, { name: 'Not Default', isDefault: false })
    const { id } = await seedCollection(prisma, { name: 'The Default', isDefault: true })

    expect(await getDefaultCollectionId(prisma)).toBe(id)
  })

  it('throws when no default collection exists', async () => {
    await expect(getDefaultCollectionId(prisma)).rejects.toThrow('No default collection exists')
  })
})

describe('listCollections', () => {
  it('returns an empty list when there are no collections', async () => {
    expect(await listCollections(prisma)).toEqual([])
  })

  it('lists every collection, oldest first', async () => {
    await seedCollection(prisma, { name: 'First' })
    await seedCollection(prisma, { name: 'Second', isDefault: false })

    const collections = await listCollections(prisma)

    expect(collections.map((c) => c.name)).toEqual(['First', 'Second'])
  })
})

describe('createCollection', () => {
  it('creates a non-default collection with the given name', async () => {
    const id = await createCollection(prisma, 'New Collection')

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.name).toBe('New Collection')
    expect(collection.isDefault).toBe(false)
  })

  it('rejects an empty name', async () => {
    await expect(createCollection(prisma, '')).rejects.toThrow('Collection name cannot be empty')
  })

  it('rejects a whitespace-only name', async () => {
    await expect(createCollection(prisma, '   ')).rejects.toThrow('Collection name cannot be empty')
  })

  it('trims surrounding whitespace from a valid name', async () => {
    const id = await createCollection(prisma, '  Trimmed  ')

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.name).toBe('Trimmed')
  })
})

describe('renameCollection', () => {
  it('updates the name', async () => {
    const { id } = await seedCollection(prisma, { name: 'Old Name' })

    await renameCollection(prisma, id, 'New Name')

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.name).toBe('New Name')
  })

  it('rejects an empty name', async () => {
    const { id } = await seedCollection(prisma)

    await expect(renameCollection(prisma, id, '')).rejects.toThrow('Collection name cannot be empty')
  })
})

describe('deleteCollection', () => {
  it('deletes a non-default collection', async () => {
    const { id } = await seedCollection(prisma, { isDefault: false })

    await deleteCollection(prisma, id)

    expect(await prisma.collection.findUnique({ where: { id } })).toBeNull()
  })

  it('rejects deleting the default collection', async () => {
    const { id } = await seedCollection(prisma, { isDefault: true })

    await expect(deleteCollection(prisma, id)).rejects.toThrow('Cannot delete the default collection')
  })

  it('cascades to delete its collection entries', async () => {
    const { id } = await seedCollection(prisma, { isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, id, '01001', 2)

    await deleteCollection(prisma, id)

    expect(await prisma.collectionEntry.findMany({ where: { collectionId: id } })).toEqual([])
  })
})

describe('setDefaultCollection', () => {
  it('makes the given collection default and un-defaults the previous one', async () => {
    const a = await seedCollection(prisma, { name: 'A', isDefault: true })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })

    await setDefaultCollection(prisma, b.id)

    const refreshedA = await prisma.collection.findUniqueOrThrow({ where: { id: a.id } })
    const refreshedB = await prisma.collection.findUniqueOrThrow({ where: { id: b.id } })
    expect(refreshedA.isDefault).toBe(false)
    expect(refreshedB.isDefault).toBe(true)
  })
})

describe('importCsvAsBatch', () => {
  it('creates a stopped batch with one BatchCard per valid row', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,Card A,anarch,core,core,3,1\n' +
      '01002,Card B,anarch,core,core,2,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([])
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: result.batchId } })
    expect(batch.status).toBe('stopped')
    expect(batch.expectedCount).toBe(5)
    expect(batch.collectionId).toBe(collectionId)
    const cards = await prisma.batchCard.findMany({ where: { batchId: result.batchId }, orderBy: { cardCode: 'asc' } })
    expect(cards).toEqual([
      { batchId: result.batchId, cardCode: '01001', quantity: 3 },
      { batchId: result.batchId, cardCode: '01002', quantity: 2 },
    ])
  })

  it('does not touch CollectionEntry — the batch must be approved first', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,3,1\n'
    await importCsvAsBatch(prisma, collectionId, csv)

    expect(await prisma.collectionEntry.count()).toBe(0)
  })

  it('skips and reports an unknown card code rather than failing the whole import', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,Card A,anarch,core,core,2,1\n' +
      'nonexistent,Ghost Card,anarch,core,core,1,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([{ cardCode: 'nonexistent', reason: 'Unknown card code' }])
    const cards = await prisma.batchCard.findMany({ where: { batchId: result.batchId } })
    expect(cards).toEqual([{ batchId: result.batchId, cardCode: '01001', quantity: 2 }])
  })

  it('skips and reports a malformed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,not-a-number,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([{ cardCode: '01001', reason: 'Invalid quantity "not-a-number"' }])
    expect(await prisma.batchCard.count({ where: { batchId: result.batchId } })).toBe(0)
  })

  it('skips and reports a zero quantity — nothing to review for a card you own none of', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,0,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([{ cardCode: '01001', reason: 'Invalid quantity "0"' }])
  })

  it('handles a quoted title containing a comma and escaped quotes', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Kate "Mac" McCaffrey', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,"Kate ""Mac"" McCaffrey",anarch,core,core,1,1\n'
    const result = await importCsvAsBatch(prisma, collectionId, csv)

    expect(result.skipped).toEqual([])
    expect(await prisma.batchCard.count({ where: { batchId: result.batchId } })).toBe(1)
  })

  it('throws for an empty CSV', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await expect(importCsvAsBatch(prisma, collectionId, '')).rejects.toThrow('CSV is empty')
  })

  it('rejects importing into a collection that already has an active batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    await importCsvAsBatch(prisma, collectionId, csv)

    await expect(importCsvAsBatch(prisma, collectionId, csv)).rejects.toThrow('already active')
  })

  it('allows importing into a different collection while one has an active batch', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    await importCsvAsBatch(prisma, a.id, csv)

    const result = await importCsvAsBatch(prisma, b.id, csv)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: result.batchId } })
    expect(batch.collectionId).toBe(b.id)
  })

  it('round-trips: exporting then importing-and-approving reproduces the same collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', quantity: 2 })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await incrementOwned(prisma, collectionId, '01002', 1)

    const csv = await exportCollectionCsv(prisma, collectionId)
    const other = await createCollection(prisma, 'Other')
    const result = await importCsvAsBatch(prisma, other, csv)
    await approveBatch(prisma, other, result.batchId)

    const entries = await prisma.collectionEntry.findMany({
      where: { collectionId: other },
      orderBy: { cardCode: 'asc' },
    })
    expect(entries.map((e) => ({ cardCode: e.cardCode, quantityOwned: e.quantityOwned }))).toEqual([
      { cardCode: '01001', quantityOwned: 2 },
      { cardCode: '01002', quantityOwned: 1 },
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: FAIL — `importCsvAsBatch` does not exist yet.

- [ ] **Step 3: Write the implementation**

In `src/lib/collections.ts`, add the import at the top of the file (alongside the existing `import type { PrismaClient } from '@prisma/client'`):

```ts
import { formatBatchName, getActiveBatch } from './batches'
```

Then replace the full `ImportResult`/`importCollectionCsv` block at the bottom of the file:

```ts
export interface ImportResult {
  imported: number
  skipped: { cardCode: string; reason: string }[]
}

/** Replaces a collection's entries with what the CSV contains — matching this app's existing "re-import replaces" precedent (see Deck import). */
export async function importCollectionCsv(
  prisma: PrismaClient,
  collectionId: number,
  csvText: string
): Promise<ImportResult> {
  const rows = parseCsv(csvText.trim())
  if (rows.length === 0) {
    return { imported: 0, skipped: [] }
  }

  const [header, ...dataRows] = rows
  const codeIndex = header.indexOf('cardCode')
  const quantityIndex = header.indexOf('quantityOwned')
  if (codeIndex === -1 || quantityIndex === -1) {
    throw new Error('CSV must have cardCode and quantityOwned columns')
  }

  const existingCodes = new Set((await prisma.card.findMany({ select: { code: true } })).map((c) => c.code))

  const toInsert: { cardCode: string; quantityOwned: number }[] = []
  const skipped: { cardCode: string; reason: string }[] = []

  for (const row of dataRows) {
    const cardCode = row[codeIndex] ?? ''
    const rawQuantity = row[quantityIndex] ?? ''

    if (cardCode === '') continue // trailing blank line

    if (!existingCodes.has(cardCode)) {
      skipped.push({ cardCode, reason: 'Unknown card code' })
      continue
    }

    const quantity = Number(rawQuantity)
    if (!Number.isInteger(quantity) || quantity < 0) {
      skipped.push({ cardCode, reason: `Invalid quantity "${rawQuantity}"` })
      continue
    }

    toInsert.push({ cardCode, quantityOwned: quantity })
  }

  await prisma.$transaction([
    prisma.collectionEntry.deleteMany({ where: { collectionId } }),
    prisma.collectionEntry.createMany({
      data: toInsert.map((entry) => ({ collectionId, ...entry })),
    }),
    touchCollection(prisma, collectionId),
  ])

  return { imported: toInsert.length, skipped }
}
```

with:

```ts
export interface ImportBatchResult {
  batchId: number
  skipped: { cardCode: string; reason: string }[]
}

/**
 * Parses a CSV (same format exportCollectionCsv produces) into a new
 * Batch for review — never writes CollectionEntry rows directly, so an
 * import can be reviewed and discarded like any other batch, and merges
 * into whatever the collection already owns rather than replacing it.
 * Reuses the same "only one active batch per collection" rule startBatch
 * enforces, since this creates a Batch too.
 */
export async function importCsvAsBatch(
  prisma: PrismaClient,
  collectionId: number,
  csvText: string
): Promise<ImportBatchResult> {
  const rows = parseCsv(csvText.trim())
  if (rows.length === 0) {
    throw new Error('CSV is empty')
  }

  const [header, ...dataRows] = rows
  const codeIndex = header.indexOf('cardCode')
  const quantityIndex = header.indexOf('quantityOwned')
  if (codeIndex === -1 || quantityIndex === -1) {
    throw new Error('CSV must have cardCode and quantityOwned columns')
  }

  const existingBatch = await getActiveBatch(prisma, collectionId)
  if (existingBatch) {
    throw new Error('A batch is already active — review or finish it before starting a new one')
  }

  const existingCodes = new Set((await prisma.card.findMany({ select: { code: true } })).map((c) => c.code))

  const toInsert: { cardCode: string; quantity: number }[] = []
  const skipped: { cardCode: string; reason: string }[] = []

  for (const row of dataRows) {
    const cardCode = row[codeIndex] ?? ''
    const rawQuantity = row[quantityIndex] ?? ''

    if (cardCode === '') continue // trailing blank line

    if (!existingCodes.has(cardCode)) {
      skipped.push({ cardCode, reason: 'Unknown card code' })
      continue
    }

    const quantity = Number(rawQuantity)
    if (!Number.isInteger(quantity) || quantity <= 0) {
      skipped.push({ cardCode, reason: `Invalid quantity "${rawQuantity}"` })
      continue
    }

    toInsert.push({ cardCode, quantity })
  }

  const expectedCount = toInsert.reduce((sum, row) => sum + row.quantity, 0)
  const now = new Date()

  const batch = await prisma.batch.create({
    data: {
      collectionId,
      name: formatBatchName(now, 'Import'),
      expectedCount,
      status: 'stopped',
      startedAt: now,
      elapsedMs: 0,
      lastResumedAt: null,
      cards: { createMany: { data: toInsert.map((row) => ({ cardCode: row.cardCode, quantity: row.quantity })) } },
    },
  })

  return { batchId: batch.id, skipped }
}
```

`parseCsv` and `touchCollection` (used elsewhere in this file) are unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: PASS (24 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collections.ts src/lib/collections.test.ts
git commit -m "Replace importCollectionCsv with batch-backed importCsvAsBatch"
```

---

### Task 4: `listCollectionsWithStats`

**Files:**
- Modify: `src/lib/collections.ts`
- Modify: `src/lib/collections.test.ts`

**Interfaces:**
- Consumes: `listCollections` (existing), `computeCollectionTotals` (Phase 1, `src/lib/reports.ts`), `getActiveBatch` (Task 2, `src/lib/batches.ts`).
- Produces (used by Tasks 5 and 8): `CollectionListEntry`, `listCollectionsWithStats(prisma)`.

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/lib/collections.test.ts` (after the `importCsvAsBatch` describe block, still inside the same file — do not create a new file):

```ts

describe('listCollectionsWithStats', () => {
  it('returns stats and default-collection order for every collection', async () => {
    await seedCollection(prisma, { name: 'First' })
    await seedCollection(prisma, { name: 'Second', isDefault: false })

    const list = await listCollectionsWithStats(prisma)

    expect(list.map((c) => c.name)).toEqual(['First', 'Second'])
    expect(list[0].isDefault).toBe(true)
    expect(list[1].isDefault).toBe(false)
  })

  it('computes ownedCards/totalCards/percentOwned per collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await incrementOwned(prisma, collectionId, '01001', 1)

    const [entry] = await listCollectionsWithStats(prisma)

    expect(entry.ownedCards).toBe(1)
    expect(entry.totalCards).toBe(2)
    expect(entry.percentOwned).toBe(50)
  })

  it('keeps stats independent across two different collections', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1 })
    await incrementOwned(prisma, a.id, '01001', 1)

    const list = await listCollectionsWithStats(prisma)

    expect(list.find((c) => c.id === a.id)?.ownedCards).toBe(1)
    expect(list.find((c) => c.id === b.id)?.ownedCards).toBe(0)
  })

  it('reports pendingBatch as null when there is no active batch', async () => {
    await seedCollection(prisma)

    const [entry] = await listCollectionsWithStats(prisma)

    expect(entry.pendingBatch).toBeNull()
  })

  it('reports pendingBatch when a batch is stopped awaiting review', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    const { batchId } = await importCsvAsBatch(prisma, collectionId, csv)

    const [entry] = await listCollectionsWithStats(prisma)

    expect(entry.pendingBatch?.id).toBe(batchId)
    expect(entry.pendingBatch?.status).toBe('stopped')
  })

  it('reports pendingBatch as null again after the batch is approved', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,1,1\n'
    const { batchId } = await importCsvAsBatch(prisma, collectionId, csv)
    await approveBatch(prisma, collectionId, batchId)

    const [entry] = await listCollectionsWithStats(prisma)

    expect(entry.pendingBatch).toBeNull()
  })
})
```

Also update the import block at the top of `src/lib/collections.test.ts` to add `listCollectionsWithStats`:

```ts
import {
  getDefaultCollectionId,
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvAsBatch,
  listCollectionsWithStats,
} from './collections'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: FAIL — `listCollectionsWithStats` does not exist yet.

- [ ] **Step 3: Write the implementation**

In `src/lib/collections.ts`, add an import (alongside the `./batches` import added in Task 3):

```ts
import { computeCollectionTotals } from './reports'
```

Then append, after `listCollections`:

```ts
export interface CollectionListEntry extends CollectionSummary {
  ownedCards: number
  totalCards: number
  percentOwned: number
  pendingBatch: BatchSummary | null
}

export async function listCollectionsWithStats(prisma: PrismaClient): Promise<CollectionListEntry[]> {
  const collections = await listCollections(prisma)
  return Promise.all(
    collections.map(async (collection) => {
      const [totals, pendingBatch] = await Promise.all([
        computeCollectionTotals(prisma, collection.id),
        getActiveBatch(prisma, collection.id),
      ])
      return { ...collection, ...totals, pendingBatch }
    })
  )
}
```

Also add `BatchSummary` to the `./batches` import line from Task 3 (it currently imports `formatBatchName, getActiveBatch` — add the type):

```ts
import { formatBatchName, getActiveBatch, type BatchSummary } from './batches'
```

This is an N+1 pattern (one extra pair of queries per collection) — acceptable at this app's personal-collection scale, consistent with the same accepted pattern in `computeAllSetsCompletion`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: PASS (30 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/collections.ts src/lib/collections.test.ts
git commit -m "Add listCollectionsWithStats for the Collections page"
```

---

### Task 5: Collection management actions

**Files:**
- Modify: `src/actions/collectionActions.ts`

**Interfaces:**
- Consumes: `createCollection`, `renameCollection`, `deleteCollection`, `setDefaultCollection`, `importCsvAsBatch` (Phase 1 / Task 3, `src/lib/collections.ts`), `computeCollectionTotals` (Phase 1, `src/lib/reports.ts`), `getActiveBatch` (Task 2, `src/lib/batches.ts`), `approveBatch` (`src/actions/batchMutations.ts`, already `collectionId`-aware since Phase 1).
- Produces (used by Task 8): `createCollection(name)`, `renameCollection(collectionId, name)`, `deleteCollection(collectionId)`, `setDefaultCollection(collectionId)`, `importCsvToCollection(collectionId, csvText)`, `approveImportBatch(collectionId, batchId)`.

No test file for this task — matches this codebase's existing convention of not unit-testing thin `*Actions.ts` wrappers (established in Phase 1's `collectionActions.ts`, `deckActions.ts`, `batchActions.ts`, all untested for the same reason).

- [ ] **Step 1: Write the implementation**

Replace the full contents of `src/actions/collectionActions.ts` with:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import {
  getDefaultCollectionId,
  createCollection as createCollectionMutation,
  renameCollection as renameCollectionMutation,
  deleteCollection as deleteCollectionMutation,
  setDefaultCollection as setDefaultCollectionMutation,
  importCsvAsBatch,
  type CollectionListEntry,
} from '@/lib/collections'
import { computeCollectionTotals } from '@/lib/reports'
import { getActiveBatch, type BatchSummary } from '@/lib/batches'
import { approveBatch as approveBatchMutation } from './batchMutations'
import { addToCollectionMutation, updateCollectionQuantityMutation } from './collectionMutations'

export async function addToCollection(cardCode: string, amount: number): Promise<number> {
  const collectionId = await getDefaultCollectionId(prisma)
  const quantity = await addToCollectionMutation(prisma, collectionId, cardCode, amount)
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  return quantity
}

export async function updateCollectionQuantity(cardCode: string, quantity: number): Promise<number> {
  const collectionId = await getDefaultCollectionId(prisma)
  const updated = await updateCollectionQuantityMutation(prisma, collectionId, cardCode, quantity)
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  return updated
}

export type SimpleActionResult = { ok: true } | { ok: false; error: string }
export type CreateCollectionResult = { ok: true; collection: CollectionListEntry } | { ok: false; error: string }
export type ImportCsvResult =
  | { ok: true; batch: BatchSummary; skipped: { cardCode: string; reason: string }[] }
  | { ok: false; error: string }

export async function createCollection(name: string): Promise<CreateCollectionResult> {
  try {
    const id = await createCollectionMutation(prisma, name)
    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    const totals = await computeCollectionTotals(prisma, id)
    revalidatePath('/collections')
    return {
      ok: true,
      collection: {
        id: collection.id,
        name: collection.name,
        isDefault: collection.isDefault,
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
        ...totals,
        pendingBatch: null,
      },
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function renameCollection(collectionId: number, name: string): Promise<SimpleActionResult> {
  try {
    await renameCollectionMutation(prisma, collectionId, name)
    revalidatePath('/collections')
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function deleteCollection(collectionId: number): Promise<SimpleActionResult> {
  try {
    await deleteCollectionMutation(prisma, collectionId)
    revalidatePath('/collections')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function setDefaultCollection(collectionId: number): Promise<SimpleActionResult> {
  try {
    await setDefaultCollectionMutation(prisma, collectionId)
    revalidatePath('/collections')
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function importCsvToCollection(collectionId: number, csvText: string): Promise<ImportCsvResult> {
  try {
    const { skipped } = await importCsvAsBatch(prisma, collectionId, csvText)
    const batch = await getActiveBatch(prisma, collectionId)
    if (!batch) {
      return { ok: false, error: 'Failed to load the created batch' }
    }
    revalidatePath('/collections')
    return { ok: true, batch, skipped }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}

export async function approveImportBatch(collectionId: number, batchId: number): Promise<SimpleActionResult> {
  try {
    await approveBatchMutation(prisma, collectionId, batchId)
    revalidatePath('/')
    revalidatePath('/sets/[packCode]', 'page')
    revalidatePath('/collections')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}
```

`approveImportBatch` calls the same `approveBatchMutation` (from `./batchMutations`, already `collectionId`-aware since Phase 1) that `batchActions.ts`'s existing `approveBatch` action calls — only this action-layer wrapper is new. Discarding an import batch reuses the existing `discardBatch` action from `batchActions.ts` directly (Task 2 already added its `/collections` revalidation) — no `discardImportBatch` here.

- [ ] **Step 2: Run a quick type-check on this file**

Run: `npx tsc --noEmit`
Expected: errors remain in `src/app/collections/*` (doesn't exist yet — Task 8) and possibly the export route (Task 6) — but no error should originate from `src/actions/collectionActions.ts` itself. Read the output and confirm every remaining error's file path is outside this task's scope.

- [ ] **Step 3: Commit**

```bash
git add src/actions/collectionActions.ts
git commit -m "Add Collection management actions (create/rename/delete/set-default/import/approve)"
```

---

### Task 6: Parameterize the CSV export route

**Files:**
- Modify: `src/app/api/collection/export/route.ts`
- Modify: `src/app/api/collection/export/route.test.ts`

**Interfaces:**
- Consumes: `getDefaultCollectionId`, `exportCollectionCsv` (both existing, unchanged).
- Produces: the route now accepts an optional `?collectionId=` query param.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `src/app/api/collection/export/route.test.ts` with:

```ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection } from '@/lib/testFixtures'
import { incrementOwned } from '@/lib/collection'

// route.ts imports a module-level `prisma` singleton from '@/lib/db'. To
// exercise the real route handler against an isolated, seeded test
// database (rather than the dev DB), swap that export for one backed by
// createTestDb() before the route module is loaded.
const dbHolder = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))

vi.mock('@/lib/db', () => ({
  get prisma() {
    return dbHolder.prisma
  },
}))

const { GET } = await import('./route')

describe('GET /api/collection/export', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.collection.deleteMany()
    await prisma.card.deleteMany()
  })

  it('responds with a CSV content type and a download filename', async () => {
    await seedCollection(prisma)

    const request = new NextRequest('http://localhost/api/collection/export')
    const response = await GET(request)

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="netrunner-collection.csv"')
  })

  it('returns the default collection as CSV when no collectionId param is given', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01007', 2)

    const request = new NextRequest('http://localhost/api/collection/export')
    const response = await GET(request)
    const body = await response.text()

    expect(body).toContain('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity')
    expect(body).toContain('01007,Corroder,anarch,core,core,2,3')
  })

  it('returns the specified collection as CSV when a collectionId param is given', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, a.id, '01007', 1)
    await incrementOwned(prisma, b.id, '01007', 2)

    const request = new NextRequest(`http://localhost/api/collection/export?collectionId=${b.id}`)
    const response = await GET(request)
    const body = await response.text()

    expect(body).toContain('01007,Corroder,anarch,core,core,2,3')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/api/collection/export/route.test.ts`
Expected: FAIL — `GET()` doesn't accept a `request` argument yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/app/api/collection/export/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
import { exportCollectionCsv } from '@/lib/collection'

export async function GET(request: NextRequest) {
  const collectionIdParam = request.nextUrl.searchParams.get('collectionId')
  const collectionId = collectionIdParam ? Number(collectionIdParam) : await getDefaultCollectionId(prisma)
  const csv = await exportCollectionCsv(prisma, collectionId)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="netrunner-collection.csv"',
    },
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/collection/export/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/collection/export/route.ts src/app/api/collection/export/route.test.ts
git commit -m "Parameterize the CSV export route by collectionId"
```

---

### Task 7: Nav indicator and the Collections settings-menu entry

**Files:**
- Modify: `src/components/SettingsMenu.tsx`
- Modify: `src/components/SettingsMenu.test.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `getDefaultCollectionId` (Phase 1, `src/lib/collections.ts`).

No test file for `layout.tsx` — matches this codebase's existing convention of not unit-testing page/layout server components (their DB-touching logic is thin; correctness is covered by Task 9's manual verification).

- [ ] **Step 1: Write the failing test**

Replace the full contents of `src/components/SettingsMenu.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsMenu } from './SettingsMenu'

// jsdom doesn't implement real navigation — clicking any real <a href> (Next's
// Link or otherwise) triggers it to log "Not implemented: navigation to
// another Document". The mock still renders a real, inspectable anchor and
// still fires the component's own onClick, it just stops the browser's
// default action first so jsdom never attempts the unsupported navigation.
vi.mock('next/link', () => ({
  default: ({ onClick, ...props }: React.ComponentProps<'a'>) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
    />
  ),
}))

describe('SettingsMenu', () => {
  it('is closed by default', () => {
    render(<SettingsMenu />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the trigger opens the menu with a link to /settings', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('menuitem', { name: 'Configuration' })).toHaveAttribute('href', '/settings')
  })

  it('opens the menu with links to /collections and /builder/batches, in order', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Configuration', 'Collections', 'Batch History'])
    expect(screen.getByRole('menuitem', { name: 'Collections' })).toHaveAttribute('href', '/collections')
    expect(screen.getByRole('menuitem', { name: 'Batch History' })).toHaveAttribute('href', '/builder/batches')
  })

  it('clicking the trigger again closes the menu', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    const trigger = screen.getByRole('button', { name: 'Settings' })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking outside the dropdown closes it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <SettingsMenu />
        <p>Elsewhere on the page</p>
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByText('Elsewhere on the page'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the Configuration link closes the menu', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('menuitem', { name: 'Configuration' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the Collections link closes the menu', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('menuitem', { name: 'Collections' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the Batch History link closes the menu', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('menuitem', { name: 'Batch History' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/SettingsMenu.test.tsx`
Expected: FAIL — the "Collections" menu item doesn't exist yet.

- [ ] **Step 3: Write the implementation**

In `src/components/SettingsMenu.tsx`, insert a new `Link` between the "Configuration" and "Batch History" links:

```tsx
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-surface-hover"
          >
            Configuration
          </Link>
          <Link
            href="/collections"
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-surface-hover"
          >
            Collections
          </Link>
          <Link
            href="/builder/batches"
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-surface-hover"
          >
            Batch History
          </Link>
```

(This replaces the existing block that has just the "Configuration" and "Batch History" links — the new "Collections" `Link` is inserted between them, nothing else in the file changes.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/SettingsMenu.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Add the nav indicator**

Replace the full contents of `src/app/layout.tsx` with:

```tsx
import Link from 'next/link'
import './globals.css'
import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
import { ReportsNavDropdown } from '@/components/ReportsNavDropdown'
import { SettingsMenu } from '@/components/SettingsMenu'

export const metadata: Metadata = {
  title: 'Netrunner Collection Tracker',
  description: 'Track your Android: Netrunner card collection',
}

// Reflects the current default collection, which can change at runtime
// (Set as Default) — not something to freeze into a build-time snapshot.
// See the dashboard's identical rationale. Applies to the whole app since
// every page shares this layout's nav indicator.
export const dynamic = 'force-dynamic'

const THEME_INIT_SCRIPT = `
try {
  var theme = localStorage.getItem('netrunner-theme');
  if (theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const collectionId = await getDefaultCollectionId(prisma)
  const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-app text-primary">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <nav className="flex items-center justify-between border-b border-subtle px-8 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold">
              Dashboard
            </Link>
            <Link href="/builder">Builder</Link>
            <Link href="/decks">Decks</Link>
            <ReportsNavDropdown />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">{collection.name}</span>
            <SettingsMenu />
          </div>
        </nav>
        {children}
      </body>
    </html>
  )
}
```

The `export const dynamic = 'force-dynamic'` line matters: without it, Next.js could statically render the root layout at build time against whatever `data/netrunner.db` state exists then (or fail if it doesn't exist yet, per `npm run build`'s documented guarantee that it doesn't need a set-up database). This mirrors the exact fix Phase 1's final review already had to make once for the Dashboard page — don't skip it here.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsMenu.tsx src/components/SettingsMenu.test.tsx src/app/layout.tsx
git commit -m "Add Collections nav entry and default-collection indicator"
```

---

### Task 8: The `/collections` page

**Files:**
- Create: `src/app/collections/page.tsx`
- Create: `src/app/collections/CollectionsList.tsx`
- Create: `src/app/collections/CollectionsList.test.tsx`

**Interfaces:**
- Consumes: `listCollectionsWithStats` (Task 4), `createCollection`, `renameCollection`, `deleteCollection`, `setDefaultCollection`, `importCsvToCollection`, `approveImportBatch` (Task 5, `src/actions/collectionActions.ts`), `discardBatch`, `removeFromBatch` (existing, `src/actions/batchActions.ts`), `BatchReviewModal` (existing, `src/app/builder/BatchReviewModal.tsx`, unchanged).

- [ ] **Step 1: Write the failing tests**

Create `src/app/collections/CollectionsList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionsList } from './CollectionsList'
import {
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvToCollection,
  approveImportBatch,
} from '@/actions/collectionActions'
import { discardBatch, removeFromBatch } from '@/actions/batchActions'
import type { CollectionListEntry } from '@/lib/collections'
import type { BatchSummary } from '@/lib/batches'

vi.mock('@/actions/collectionActions', () => ({
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
  setDefaultCollection: vi.fn(),
  importCsvToCollection: vi.fn(),
  approveImportBatch: vi.fn(),
}))

vi.mock('@/actions/batchActions', () => ({
  discardBatch: vi.fn(),
  removeFromBatch: vi.fn(),
}))

const defaultCollection: CollectionListEntry = {
  id: 1,
  name: 'My Collection',
  isDefault: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ownedCards: 10,
  totalCards: 100,
  percentOwned: 10,
  pendingBatch: null,
}

const secondCollection: CollectionListEntry = {
  id: 2,
  name: 'Trade Binder',
  isDefault: false,
  createdAt: new Date('2026-02-01'),
  updatedAt: new Date('2026-02-01'),
  ownedCards: 0,
  totalCards: 100,
  percentOwned: 0,
  pendingBatch: null,
}

describe('CollectionsList', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('lists every collection with its stats and default badge', () => {
    render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

    expect(screen.getByText('My Collection')).toBeInTheDocument()
    expect(screen.getByText('10 / 100 owned (10%)')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Trade Binder')).toBeInTheDocument()
  })

  it('creating a collection with a valid name adds it to the list', async () => {
    vi.mocked(createCollection).mockResolvedValue({ ok: true, collection: secondCollection })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection]} />)

    await user.type(screen.getByLabelText('New collection'), 'Trade Binder')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(createCollection).toHaveBeenCalledWith('Trade Binder')
    await waitFor(() => expect(screen.getByText('Trade Binder')).toBeInTheDocument())
  })

  it('shows the error when creating a collection fails', async () => {
    vi.mocked(createCollection).mockResolvedValue({ ok: false, error: 'Collection name cannot be empty' })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection]} />)

    await user.type(screen.getByLabelText('New collection'), '   ')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Collection name cannot be empty')).toBeInTheDocument()
  })

  it('clicking a row expands it to reveal actions', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    expect(screen.queryByRole('button', { name: 'Set as Default' })).not.toBeInTheDocument()

    await user.click(screen.getByText('Trade Binder'))

    expect(screen.getByRole('button', { name: 'Set as Default' })).toBeInTheDocument()
  })

  it('Set as Default is disabled for the collection that is already default', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection]} />)

    await user.click(screen.getByText('My Collection'))

    expect(screen.getByRole('button', { name: 'Set as Default' })).toBeDisabled()
  })

  it('clicking Set as Default moves the badge to the clicked row', async () => {
    vi.mocked(setDefaultCollection).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    await user.click(screen.getByRole('button', { name: 'Set as Default' }))

    expect(setDefaultCollection).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.getAllByText('Default')).toHaveLength(1))
  })

  it('renaming a collection saves the new name', async () => {
    vi.mocked(renameCollection).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed Binder')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(renameCollection).toHaveBeenCalledWith(2, 'Renamed Binder')
    await waitFor(() => expect(screen.getByText('Renamed Binder')).toBeInTheDocument())
  })

  it('deleting requires a two-step confirm', async () => {
    vi.mocked(deleteCollection).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(deleteCollection).not.toHaveBeenCalled()
    expect(screen.getByText('Are you sure?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Yes' }))

    expect(deleteCollection).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.queryByText('Trade Binder')).not.toBeInTheDocument())
  })

  it('canceling the delete confirm leaves the collection in place', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(deleteCollection).not.toHaveBeenCalled()
    expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument()
    expect(screen.getByText('Trade Binder')).toBeInTheDocument()
  })

  it('Delete is disabled for the default collection', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[defaultCollection]} />)

    await user.click(screen.getByText('My Collection'))

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('importing a CSV opens the review modal with the returned batch', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 3,
      status: 'stopped',
      currentCount: 3,
      elapsedMs: 0,
      cards: [{ code: '01001', title: 'Corroder', quantity: 3 }],
    }
    vi.mocked(importCsvToCollection).mockResolvedValue({ ok: true, batch: importedBatch, skipped: [] })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const file = new File(['cardCode,quantityOwned\n01001,3\n'], 'collection.csv', { type: 'text/csv' })
    const input = screen.getByLabelText('Import CSV')
    await user.upload(input, file)

    await waitFor(() => expect(importCsvToCollection).toHaveBeenCalledWith(2, 'cardCode,quantityOwned\n01001,3\n'))
    expect(await screen.findByText('Import 2026-03-05 10:00')).toBeInTheDocument()
    expect(screen.getByText('Corroder')).toBeInTheDocument()
  })

  it('shows a skipped-rows summary above the review modal', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 1,
      status: 'stopped',
      currentCount: 1,
      elapsedMs: 0,
      cards: [{ code: '01001', title: 'Corroder', quantity: 1 }],
    }
    vi.mocked(importCsvToCollection).mockResolvedValue({
      ok: true,
      batch: importedBatch,
      skipped: [{ cardCode: 'nonexistent', reason: 'Unknown card code' }],
    })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const file = new File(['cardCode,quantityOwned\n01001,1\nnonexistent,2\n'], 'collection.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Import CSV'), file)

    expect(await screen.findByText('1 row(s) skipped')).toBeInTheDocument()
    expect(screen.getByText('nonexistent: Unknown card code')).toBeInTheDocument()
  })

  it('approving the review modal calls approveImportBatch and clears pending state', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 1,
      status: 'stopped',
      currentCount: 1,
      elapsedMs: 0,
      cards: [{ code: '01001', title: 'Corroder', quantity: 1 }],
    }
    vi.mocked(importCsvToCollection).mockResolvedValue({ ok: true, batch: importedBatch, skipped: [] })
    vi.mocked(approveImportBatch).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const file = new File(['cardCode,quantityOwned\n01001,1\n'], 'collection.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Import CSV'), file)
    await screen.findByText('Import 2026-03-05 10:00')

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(approveImportBatch).toHaveBeenCalledWith(2, 5)
    await waitFor(() => expect(screen.queryByText('Import 2026-03-05 10:00')).not.toBeInTheDocument())
  })

  it('discarding the review modal calls discardBatch and clears pending state', async () => {
    const importedBatch: BatchSummary = {
      id: 5,
      name: 'Import 2026-03-05 10:00',
      expectedCount: 1,
      status: 'stopped',
      currentCount: 1,
      elapsedMs: 0,
      cards: [{ code: '01001', title: 'Corroder', quantity: 1 }],
    }
    vi.mocked(importCsvToCollection).mockResolvedValue({ ok: true, batch: importedBatch, skipped: [] })
    vi.mocked(discardBatch).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))
    const file = new File(['cardCode,quantityOwned\n01001,1\n'], 'collection.csv', { type: 'text/csv' })
    await user.upload(screen.getByLabelText('Import CSV'), file)
    await screen.findByText('Import 2026-03-05 10:00')

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(discardBatch).toHaveBeenCalledWith(5)
    await waitFor(() => expect(screen.queryByText('Import 2026-03-05 10:00')).not.toBeInTheDocument())
  })

  it('shows a Resume link for a collection with a pending batch, opening the review modal', async () => {
    const pendingBatch: BatchSummary = {
      id: 7,
      name: 'Import 2026-03-04 09:00',
      expectedCount: 2,
      status: 'stopped',
      currentCount: 2,
      elapsedMs: 0,
      cards: [{ code: '01001', title: 'Corroder', quantity: 2 }],
    }
    const withPending: CollectionListEntry = { ...secondCollection, pendingBatch }
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[withPending]} />)

    await user.click(screen.getByText('Trade Binder'))
    expect(screen.getByText('Pending review')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume' }))

    expect(screen.getByText('Import 2026-03-04 09:00')).toBeInTheDocument()
  })

  it('exports link to the export route with this collection\'s id', async () => {
    const user = userEvent.setup()
    render(<CollectionsList initialCollections={[secondCollection]} />)

    await user.click(screen.getByText('Trade Binder'))

    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/collection/export?collectionId=2'
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/collections/CollectionsList.test.tsx`
Expected: FAIL — `./CollectionsList` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/app/collections/CollectionsList.tsx`:

```tsx
'use client'

import { useState } from 'react'
import {
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvToCollection,
  approveImportBatch,
} from '@/actions/collectionActions'
import { discardBatch, removeFromBatch } from '@/actions/batchActions'
import { BatchReviewModal } from '@/app/builder/BatchReviewModal'
import type { CollectionListEntry } from '@/lib/collections'
import type { BatchSummary } from '@/lib/batches'

export function CollectionsList({ initialCollections }: { initialCollections: CollectionListEntry[] }) {
  const [collections, setCollections] = useState<CollectionListEntry[]>(initialCollections)
  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)

  function toggle(id: number) {
    setOpenId((prev) => (prev === id ? null : id))
  }

  function updateCollection(id: number, patch: Partial<CollectionListEntry>) {
    setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  async function handleCreate() {
    setIsCreating(true)
    setCreateError(null)
    try {
      const result = await createCollection(newName)
      if (result.ok) {
        setCollections((prev) => [...prev, result.collection])
        setNewName('')
      } else {
        setCreateError(result.error)
      }
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-2">
        <div>
          <label htmlFor="new-collection-name" className="block text-sm font-medium">
            New collection
          </label>
          <input
            id="new-collection-name"
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="e.g. Trade Binder"
            className="mt-1 w-64 rounded border border-default bg-surface px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating || newName.trim() === ''}
          className="cursor-pointer rounded border border-accent bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCreating ? 'Creating…' : 'Create'}
        </button>
      </div>
      {createError && (
        <p className="text-sm text-danger" role="alert">
          {createError}
        </p>
      )}

      <ul className="space-y-4">
        {collections.map((collection) => (
          <CollectionRow
            key={collection.id}
            collection={collection}
            isOpen={openId === collection.id}
            onToggle={() => toggle(collection.id)}
            onUpdate={(patch) => updateCollection(collection.id, patch)}
            onSetDefault={() =>
              setCollections((prev) => prev.map((c) => ({ ...c, isDefault: c.id === collection.id })))
            }
            onRemove={() => setCollections((prev) => prev.filter((c) => c.id !== collection.id))}
          />
        ))}
      </ul>
    </div>
  )
}

function CollectionRow({
  collection,
  isOpen,
  onToggle,
  onUpdate,
  onSetDefault,
  onRemove,
}: {
  collection: CollectionListEntry
  isOpen: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<CollectionListEntry>) => void
  onSetDefault: () => void
  onRemove: () => void
}) {
  const [nameInput, setNameInput] = useState(collection.name)
  const [isSavingName, setIsSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [isSettingDefault, setIsSettingDefault] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [reviewBatch, setReviewBatch] = useState<BatchSummary | null>(null)
  const [skipped, setSkipped] = useState<{ cardCode: string; reason: string }[]>([])
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)

  async function handleSaveName() {
    setIsSavingName(true)
    setNameError(null)
    try {
      const result = await renameCollection(collection.id, nameInput)
      if (result.ok) {
        onUpdate({ name: nameInput.trim() })
      } else {
        setNameError(result.error)
      }
    } finally {
      setIsSavingName(false)
    }
  }

  async function handleSetDefault() {
    setIsSettingDefault(true)
    try {
      const result = await setDefaultCollection(collection.id)
      if (result.ok) onSetDefault()
    } finally {
      setIsSettingDefault(false)
    }
  }

  async function handleDelete() {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      const result = await deleteCollection(collection.id)
      if (result.ok) {
        onRemove()
      } else {
        setDeleteError(result.error)
        setIsConfirmingDelete(false)
      }
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleImport(file: File) {
    setIsImporting(true)
    setImportError(null)
    try {
      const csvText = await file.text()
      const result = await importCsvToCollection(collection.id, csvText)
      if (result.ok) {
        setReviewBatch(result.batch)
        setSkipped(result.skipped)
      } else {
        setImportError(result.error)
      }
    } finally {
      setIsImporting(false)
    }
  }

  function openPendingReview() {
    if (collection.pendingBatch) setReviewBatch(collection.pendingBatch)
  }

  async function handleApproveBatch() {
    if (!reviewBatch) return
    setIsSubmittingReview(true)
    try {
      const result = await approveImportBatch(collection.id, reviewBatch.id)
      if (result.ok) {
        setReviewBatch(null)
        setSkipped([])
        onUpdate({ pendingBatch: null })
      }
    } finally {
      setIsSubmittingReview(false)
    }
  }

  async function handleDiscardBatch() {
    if (!reviewBatch) return
    setIsSubmittingReview(true)
    try {
      const result = await discardBatch(reviewBatch.id)
      if (result.ok) {
        setReviewBatch(null)
        setSkipped([])
        onUpdate({ pendingBatch: null })
      }
    } finally {
      setIsSubmittingReview(false)
    }
  }

  async function handleRemoveCardFromReview(code: string) {
    if (!reviewBatch) return
    const card = reviewBatch.cards.find((c) => c.code === code)
    if (!card) return
    const result = await removeFromBatch(reviewBatch.id, code, card.quantity)
    if (result.ok) {
      setReviewBatch(result.batch)
    }
  }

  return (
    <li className="rounded border border-default">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center justify-between gap-2 p-3 text-left hover:bg-surface-hover"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{collection.name}</span>
            {collection.isDefault && <span className="text-sm text-accent">Default</span>}
          </div>
          <p className="text-sm text-muted">
            {collection.ownedCards} / {collection.totalCards} owned ({collection.percentOwned}%)
          </p>
        </div>
        <span className="shrink-0 text-faint" aria-hidden="true">
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {isOpen && (
        <div className="space-y-4 border-t border-subtle p-3">
          {collection.pendingBatch && !reviewBatch && (
            <p className="text-sm text-danger">
              Pending review —{' '}
              <button type="button" onClick={openPendingReview} className="cursor-pointer underline hover:text-primary">
                Resume
              </button>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSetDefault}
              disabled={collection.isDefault || isSettingDefault}
              className="cursor-pointer rounded border border-default px-3 py-1 text-sm hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSettingDefault ? 'Setting…' : 'Set as Default'}
            </button>
            <a
              href={`/api/collection/export?collectionId=${collection.id}`}
              className="rounded border border-default px-3 py-1 text-sm hover:bg-surface-hover"
            >
              Export CSV
            </a>
          </div>

          <div className="flex items-end gap-2">
            <div>
              <label htmlFor={`name-${collection.id}`} className="block text-sm font-medium">
                Name
              </label>
              <input
                id={`name-${collection.id}`}
                type="text"
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                className="mt-1 w-64 rounded border border-default bg-surface px-3 py-1.5 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveName}
              disabled={isSavingName}
              className="cursor-pointer rounded border border-accent bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingName ? 'Saving…' : 'Save'}
            </button>
          </div>
          {nameError && (
            <p className="text-sm text-danger" role="alert">
              {nameError}
            </p>
          )}

          <div>
            <label htmlFor={`import-${collection.id}`} className="block text-sm font-medium">
              Import CSV
            </label>
            <input
              id={`import-${collection.id}`}
              type="file"
              accept=".csv,text/csv"
              disabled={isImporting}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) handleImport(file)
                event.target.value = ''
              }}
              className="mt-1 text-sm"
            />
            {isImporting && <p className="text-sm text-muted">Importing…</p>}
          </div>
          {importError && (
            <p className="text-sm text-danger" role="alert">
              {importError}
            </p>
          )}

          <div>
            {!isConfirmingDelete ? (
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(true)}
                disabled={collection.isDefault}
                className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-4 py-1.5 text-sm text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Delete
              </button>
            ) : (
              <div className="flex items-center gap-2 text-sm">
                <span>Are you sure?</span>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1 text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting…' : 'Yes'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  className="cursor-pointer rounded border border-default px-3 py-1 hover:bg-surface-hover"
                >
                  Cancel
                </button>
              </div>
            )}
            {deleteError && (
              <p className="mt-1 text-sm text-danger" role="alert">
                {deleteError}
              </p>
            )}
          </div>
        </div>
      )}

      {reviewBatch && (
        <div>
          {skipped.length > 0 && (
            <div className="fixed inset-x-0 top-4 z-50 mx-auto w-full max-w-md rounded border border-danger bg-surface p-3 text-sm shadow-lg">
              <p className="font-medium text-danger">{skipped.length} row(s) skipped</p>
              <ul className="mt-1 space-y-0.5 text-muted">
                {skipped.map((row) => (
                  <li key={row.cardCode}>
                    {row.cardCode}: {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <BatchReviewModal
            batchName={reviewBatch.name}
            cards={reviewBatch.cards}
            isSubmitting={isSubmittingReview}
            onDiscard={handleDiscardBatch}
            onApprove={handleApproveBatch}
            onRemoveCard={handleRemoveCardFromReview}
            onClose={() => setReviewBatch(null)}
          />
        </div>
      )}
    </li>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/collections/CollectionsList.test.tsx`
Expected: PASS (16 tests).

- [ ] **Step 5: Add the page**

Create `src/app/collections/page.tsx`:

```tsx
import { prisma } from '@/lib/db'
import { listCollectionsWithStats } from '@/lib/collections'
import { CollectionsList } from './CollectionsList'

// Reflects live collection state (stats, pending batches) — not
// something to freeze into a build-time snapshot. See the dashboard's
// identical rationale.
export const dynamic = 'force-dynamic'

export default async function CollectionsPage() {
  const collections = await listCollectionsWithStats(prisma)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">Collections</h1>
      <CollectionsList initialCollections={collections} />
    </main>
  )
}
```

(No test file for `page.tsx` — matches this codebase's existing convention; its only logic is the one `listCollectionsWithStats` call, already covered by Task 4's tests.)

- [ ] **Step 6: Commit**

```bash
git add src/app/collections/page.tsx src/app/collections/CollectionsList.tsx src/app/collections/CollectionsList.test.tsx
git commit -m "Add the Collections management page"
```

---

### Task 9: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures. This is the first point in this plan where the whole suite is expected to be green — every file this plan touches has now been retrofitted (Tasks 1-8).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the real database migrated correctly**

```bash
npx tsx -e "
import { prisma } from './src/lib/db'
async function main() {
  const batchCount = await prisma.batch.count()
  console.log('total Batch rows:', batchCount)
  const defaultCollection = await prisma.collection.findFirst({ where: { isDefault: true } })
  console.log('default collection id:', defaultCollection?.id)
  const misassigned = await prisma.batch.findMany({ where: { collectionId: { not: defaultCollection?.id } } })
  console.log('batches not pointing at the default collection:', misassigned)
  await prisma.\$disconnect()
}
main()
"
```

Expected: `total Batch rows` matches the count you recorded in Task 1's Step 1 exactly, and `misassigned` is an empty array (nothing has changed which collection real batches belong to since Task 1 ran — only new batches created during this plan's own manual testing in Step 4 below would legitimately add to the count).

- [ ] **Step 4: Manual check against the real app**

Run `npm run dev`, wait for it to serve, then confirm — read-only except where noted, and revert anything you change before finishing:

- `/` (Dashboard) loads and shows the same totals it showed before this plan started.
- The nav bar (every page) shows the current default collection's name next to the Settings gear.
- Settings gear menu shows "Configuration", "Collections", "Batch History" in that order; "Collections" links to `/collections`.
- `/collections` loads, lists your real collection(s) with correct owned/total/percent stats and the "Default" badge on the right one.
- Create a new collection (e.g. "Test Collection — delete me"), confirm it appears in the list with 0 owned.
- Expand the new collection's row: confirm Set as Default, Export CSV, rename field, Import CSV picker, and Delete are all present, and Delete is enabled (not the default).
- Click Set as Default on the new collection, confirm the nav indicator updates to show its name, confirm the Dashboard now shows 0 owned (you're viewing the new, empty collection), then click Set as Default back on your original collection and confirm the Dashboard's totals return to what they were before.
- Export CSV on your original (real) collection, confirm the downloaded file matches your real collection.
- Import that same exported CSV back into the **new, empty test collection** (not your real one): confirm the review modal opens showing every card from the CSV, confirm zero rows were skipped, then click **Discard** (not Approve — you don't want to actually duplicate your real collection into a test collection) and confirm the modal closes and the test collection's owned count is still 0.
- Delete the test collection (two-step confirm), confirm it disappears from the list and the Dashboard/nav are unaffected.
- `/builder` still behaves exactly as before: Batch mode's Start/search/add flow works, and starting a tiny batch (expected count 1), adding a card, and approving it correctly increments that card's owned quantity by exactly 1 (verify via the set page), then revert that increment via the set page's quantity editor (set it back down by 1) so this check doesn't leave a stray +1 in your real collection.
- `/builder/batches` (Batch History) still loads and lists batches, including the test batches you just created above (approved/discarded batches are permanent records, same as Phase 1's Task 8 established — no cleanup needed for these).

Stop the dev server when done.

- [ ] **Step 5: Delete the pre-migration backup file once satisfied**

```bash
ls data/*.pre-batch-collection-backup-* 2>/dev/null
```

If you're confident the migration is correct and want to remove this safety-net file, remove it by hand (outside this plan — your call, not an automated cleanup step).

- [ ] **Step 6: Commit (only if manual checks required a fix)**

If Steps 1-4 surfaced no issues, there is nothing further to commit — Task 8's commit already completes the working feature.
