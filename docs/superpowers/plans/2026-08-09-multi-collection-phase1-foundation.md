# Multi-Collection Support, Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Collection` entity, scope `CollectionEntry` to it, migrate the user's real existing collection into an auto-created default collection, and retrofit every existing feature to read/write through "the default collection" — with no visible behavior change and no new UI.

**Architecture:** `CollectionEntry`'s identity changes from a lone `cardCode @id` to a composite `[collectionId, cardCode]`, via a hand-guided SQLite table-recreation migration that backfills existing rows into a new default `Collection`. Every function that touches `CollectionEntry` (5 files) gets an explicit `collectionId` parameter; every caller of those functions resolves "the current one" via a new `getDefaultCollectionId(prisma)` helper. A new `src/lib/collections.ts` also carries the full `Collection` CRUD (create/rename/delete/set-default) and CSV import — pure data-layer logic with no UI, built now so Phase 2 only has to build UI on top of already-tested functions.

**Tech Stack:** Next.js (App Router) server components/actions, Prisma/SQLite, Vitest.

## Global Constraints

- **This touches real, irreplaceable user data.** `data/netrunner.db` is not test data — see `CLAUDE.md`'s opening warning. Task 1 is high-risk and must not be rushed or partially verified.
- `Card.collectionEntry CollectionEntry?` (a 1:1 optional relation) becomes `Card.collectionEntries CollectionEntry[]` (1:many) — a card can now have one entry per collection. Every place that currently reads `card.collectionEntry?.quantityOwned` becomes `card.collectionEntries[0]?.quantityOwned` after `include`/`select`-ing `collectionEntries: { where: { collectionId } }` (which returns at most one row, since `[collectionId, cardCode]` is unique).
- **This plan cannot keep the whole test suite green after every single task**, unlike every prior plan in this project. Task 1's schema change breaks the type-check of all 5 files that directly touch `CollectionEntry` (`collection.ts`, `cards.ts`, `reports.ts`, `decks.ts`, `batchMutations.ts`) simultaneously — there is no way to migrate the schema without momentarily breaking every caller of the old shape, and retrofitting all 5 files plus their ~10 callers in one unreviewable task would defeat the purpose of task-by-task review for the highest-risk part of this feature. Instead:
  - Task 1 verifies migration *data correctness* directly (row counts, backfilled values) rather than via `npm test`, and fixes the one test (`db.test.ts`) that breaks immediately and self-containedly.
  - Tasks 2-7 each verify only *their own* test file (`npx vitest run <file>`), explicitly not the whole suite.
  - Only Task 8 (last) requires and verifies a fully clean `npm test && npx tsc --noEmit`.
  - Every task's brief says explicitly which verification applies — do not "fix" an out-of-scope compile error in an earlier task; it resolves itself when that file's own task runs.
- `getDefaultCollectionId(prisma)` is called by viewing pages/actions **after** any early-return that should stay database-free (e.g. an empty search query) — never unconditionally at the top of a function, so existing "does nothing on empty input" test guarantees keep holding.
- Compound-key Prisma inputs use `collectionId_cardCode` (matching this schema's existing default-naming convention for `@@id([a, b])`, already proven correct for `batchId_cardCode`).
- Spec: `docs/superpowers/specs/2026-08-09-multi-collection-phase1-foundation-design.md`.

---

### Task 1: Schema, migration, and pre-migration backup

**Files:**
- Modify: `prisma/schema.prisma`
- Create: a new migration under `prisma/migrations/`
- Modify: `src/lib/db.test.ts`

**Interfaces:**
- Produces (used by every later task): `Collection` (`id Int @id @default(autoincrement())`, `name String`, `isDefault Boolean @default(false)`, `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`, relation `entries CollectionEntry[]`) and the redefined `CollectionEntry` (`collectionId Int`, `cardCode String`, `quantityOwned Int @default(0)`, composite `@@id([collectionId, cardCode])`), plus `Card.collectionEntries CollectionEntry[]` (renamed/pluralized from `collectionEntry`).

- [ ] **Step 1: Back up the real database before touching anything**

Run, from `/var/www/netrunner`:

```bash
cp data/netrunner.db "data/netrunner.db.pre-collections-backup-$(date -u +%Y%m%dT%H%M%SZ)"
curl -s http://localhost:3000/api/collection/export -o "data/collection-backup-pre-migration-$(date -u +%Y-%m-%d).csv" 2>/dev/null || echo "dev server not running — skip the CSV backup, the raw .db copy above is the real safety net"
```

(The CSV backup is a nice-to-have human-readable copy if a dev server happens to be running; the raw SQLite file copy is the actual safety net and works regardless.)

Expected: a new `data/netrunner.db.pre-collections-backup-<timestamp>` file exists, same size as `data/netrunner.db`.

- [ ] **Step 2: Update the schema**

In `prisma/schema.prisma`, change the `Card` model's `collectionEntry CollectionEntry?` field to:

```prisma
  collectionEntries CollectionEntry[]
```

(keep every other field on `Card` exactly as-is — this is the only line that changes in that model).

Replace the `CollectionEntry` model:

```prisma
model CollectionEntry {
  cardCode      String @id
  card          Card   @relation(fields: [cardCode], references: [code])
  quantityOwned Int    @default(0)
}
```

with:

```prisma
model Collection {
  id        Int      @id @default(autoincrement())
  name      String
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  entries   CollectionEntry[]
}

model CollectionEntry {
  collectionId  Int
  collection    Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  cardCode      String
  card          Card       @relation(fields: [cardCode], references: [code])
  quantityOwned Int        @default(0)

  @@id([collectionId, cardCode])
}
```

- [ ] **Step 3: Generate the migration skeleton (do not apply yet)**

Run: `npx prisma migrate dev --create-only --name add_collections`

This creates a new folder under `prisma/migrations/` with a `migration.sql` inside, **without applying it**. Prisma will detect this is a primary-key-affecting change to `CollectionEntry` and generate a SQLite table-recreation (`PRAGMA foreign_keys=OFF` / `CREATE TABLE "new_CollectionEntry"` / copy / `DROP TABLE` / `RENAME` / `PRAGMA foreign_keys=ON`) alongside a plain `CREATE TABLE "Collection"`. It has no way to know what `collectionId` existing rows should get, so its copy step will be wrong or missing — that's expected, fixed in the next step.

- [ ] **Step 4: Hand-edit the migration to seed the default collection and backfill correctly**

Open the generated `migration.sql`. It should end up with this overall shape (adjust exact constraint names to whatever Prisma actually generated in Step 3 if they differ slightly from below — the important part is the *order of operations* and the backfill subquery, not the exact generated names):

```sql
-- CreateTable
CREATE TABLE "Collection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Seed the default collection every existing CollectionEntry row will be backfilled into
INSERT INTO "Collection" ("name", "isDefault", "createdAt", "updatedAt")
VALUES ('My Collection', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CollectionEntry" (
    "collectionId" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "quantityOwned" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("collectionId", "cardCode"),
    CONSTRAINT "CollectionEntry_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionEntry_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "Card" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CollectionEntry" ("collectionId", "cardCode", "quantityOwned")
SELECT (SELECT "id" FROM "Collection" WHERE "isDefault" = true LIMIT 1), "cardCode", "quantityOwned" FROM "CollectionEntry";
DROP TABLE "CollectionEntry";
ALTER TABLE "new_CollectionEntry" RENAME TO "CollectionEntry";
PRAGMA foreign_keys=ON;
```

The two things you are adding by hand that Prisma could not generate on its own: the `INSERT INTO "Collection" ... VALUES ('My Collection', ...)` seed row, and the `(SELECT "id" FROM "Collection" WHERE "isDefault" = true LIMIT 1)` subquery in the `new_CollectionEntry` backfill `INSERT` (in place of whatever Prisma put there, likely nothing or a placeholder, since it can't infer this). The `Collection` table creation must come **before** the `CollectionEntry` redefinition in the file, since the backfill subquery depends on that row already existing.

- [ ] **Step 5: Dry-run the migration against a copy of the real database first**

```bash
mkdir -p /tmp/collections-migration-dryrun
cp data/netrunner.db /tmp/collections-migration-dryrun/test.db
DATABASE_URL="file:/tmp/collections-migration-dryrun/test.db" npx prisma migrate deploy
```

Then verify against that copy, using a throwaway script (do not commit this script; delete it after use):

```bash
DATABASE_URL="file:/tmp/collections-migration-dryrun/test.db" npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const collections = await prisma.collection.findMany()
  console.log('collections:', collections)
  const entryCount = await prisma.collectionEntry.count()
  console.log('collectionEntry count:', entryCount)
  const orphaned = await prisma.collectionEntry.findMany({ where: { collectionId: { not: collections[0]?.id } } })
  console.log('entries NOT pointing at the default collection (should be empty):', orphaned)
  await prisma.\$disconnect()
}
main()
"
```

Expected: exactly one `Collection` row (`name: 'My Collection'`, `isDefault: true`), `collectionEntry count` matches the pre-migration count exactly (compare against a `SELECT COUNT(*) FROM CollectionEntry` you ran against the original `data/netrunner.db` before this task started), and the orphaned-entries check returns an empty array. **If any of these checks fail, stop — do not proceed to Step 6. Report the discrepancy.**

- [ ] **Step 6: Apply the migration to the real database**

Only after Step 5's checks all pass:

```bash
npx prisma migrate deploy
```

Then re-run the same verification queries from Step 5 (adjusted to use the default `DATABASE_URL`, i.e. no `DATABASE_URL=` override) against the real `data/netrunner.db`. Same expected results.

- [ ] **Step 7: Fix `db.test.ts`, the one test that breaks immediately and self-containedly**

This test doesn't call any retrofitted library function (it exercises the schema directly), so it can be fixed now rather than waiting for a later task. In `src/lib/db.test.ts`, replace:

```ts
  it('tracks a collection entry for a card', async () => {
    await prisma.collectionEntry.create({ data: { cardCode: '01007', quantityOwned: 2 } })
    const entry = await prisma.collectionEntry.findUniqueOrThrow({ where: { cardCode: '01007' } })
    expect(entry.quantityOwned).toBe(2)
  })
```

with:

```ts
  it('tracks a collection entry for a card, scoped to a collection', async () => {
    const collection = await prisma.collection.create({ data: { name: 'Test Collection', isDefault: true } })
    await prisma.collectionEntry.create({
      data: { collectionId: collection.id, cardCode: '01007', quantityOwned: 2 },
    })
    const entry = await prisma.collectionEntry.findUniqueOrThrow({
      where: { collectionId_cardCode: { collectionId: collection.id, cardCode: '01007' } },
    })
    expect(entry.quantityOwned).toBe(2)
  })
```

- [ ] **Step 8: Verify**

Run: `npx vitest run src/lib/db.test.ts`
Expected: PASS (2 tests).

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

Do **not** run the full `npm test` or `npx tsc --noEmit` yet — per this plan's Global Constraints, the codebase will not compile cleanly until Task 7 completes. This is expected.

- [ ] **Step 9: Clean up the dry-run artifacts**

```bash
rm -rf /tmp/collections-migration-dryrun
```

(This is outside the repo entirely — `/tmp`, not `data/` — so it's fine to remove directly; nothing here is the user's real data.)

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/lib/db.test.ts
git commit -m "Add Collection table, scope CollectionEntry to it, migrate existing data"
```

Do not commit the `.pre-collections-backup-*` file or any CSV backup — those stay local as a safety net, not part of the repo (check `git status` before committing to confirm they're not staged; `data/*.db` and `data/*.csv` are already gitignored, so a plain `git add` of the listed files above won't pick them up).

---

### Task 2: Collection CRUD module, CSV import, and test fixture

**Files:**
- Create: `src/lib/collections.ts`
- Create: `src/lib/collections.test.ts`
- Modify: `src/lib/testFixtures.ts`

**Interfaces:**
- Consumes: `Collection`/`CollectionEntry` (Task 1).
- Produces (used by Tasks 3-8, and by Phase 2 later): `CollectionSummary`, `getDefaultCollectionId(prisma): Promise<number>`, `listCollections(prisma): Promise<CollectionSummary[]>`, `createCollection(prisma, name): Promise<number>`, `renameCollection(prisma, collectionId, name): Promise<void>`, `deleteCollection(prisma, collectionId): Promise<void>`, `setDefaultCollection(prisma, collectionId): Promise<void>`, `ImportResult`, `importCollectionCsv(prisma, collectionId, csvText): Promise<ImportResult>`. Also `seedCollection(prisma, options?)` in `testFixtures.ts`, used by every later task's tests.

- [ ] **Step 1: Add the `seedCollection` test fixture first (needed by this task's own tests)**

Append to `src/lib/testFixtures.ts`:

```ts
interface SeedCollectionOptions {
  name?: string
  isDefault?: boolean
}

export async function seedCollection(prisma: PrismaClient, options: SeedCollectionOptions = {}) {
  return prisma.collection.create({
    data: {
      name: options.name ?? 'Test Collection',
      isDefault: options.isDefault ?? true,
    },
  })
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/collections.test.ts`:

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
  importCollectionCsv,
} from './collections'
import { exportCollectionCsv, incrementOwned } from './collection'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
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

describe('importCollectionCsv', () => {
  it('replaces the collection\'s entries with what the CSV contains', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 9)

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01002,Card B,anarch,core,core,3,1\n'
    const result = await importCollectionCsv(prisma, collectionId, csv)

    expect(result).toEqual({ imported: 1, skipped: [] })
    const entries = await prisma.collectionEntry.findMany({ where: { collectionId } })
    expect(entries).toEqual([{ collectionId, cardCode: '01002', quantityOwned: 3 }])
  })

  it('skips and reports an unknown card code rather than failing the whole import', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,Card A,anarch,core,core,2,1\n' +
      'nonexistent,Ghost Card,anarch,core,core,1,1\n'
    const result = await importCollectionCsv(prisma, collectionId, csv)

    expect(result.imported).toBe(1)
    expect(result.skipped).toEqual([{ cardCode: 'nonexistent', reason: 'Unknown card code' }])
  })

  it('skips and reports a malformed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })

    const csv = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n01001,Card A,anarch,core,core,not-a-number,1\n'
    const result = await importCollectionCsv(prisma, collectionId, csv)

    expect(result.imported).toBe(0)
    expect(result.skipped).toEqual([{ cardCode: '01001', reason: 'Invalid quantity "not-a-number"' }])
  })

  it('handles a quoted title containing a comma and escaped quotes', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Kate "Mac" McCaffrey', packCode: 'core' })

    const csv =
      'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n' +
      '01001,"Kate ""Mac"" McCaffrey",anarch,core,core,1,1\n'
    const result = await importCollectionCsv(prisma, collectionId, csv)

    expect(result).toEqual({ imported: 1, skipped: [] })
  })

  it('round-trips: exporting then importing reproduces the same collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', quantity: 2 })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await incrementOwned(prisma, collectionId, '01002', 1)

    const csv = await exportCollectionCsv(prisma, collectionId)
    const other = await createCollection(prisma, 'Other')
    const result = await importCollectionCsv(prisma, other, csv)

    expect(result).toEqual({ imported: 2, skipped: [] })
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

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: FAIL — `collections.ts` does not exist yet.

- [ ] **Step 4: Write the implementation**

Create `src/lib/collections.ts`:

```ts
import type { PrismaClient } from '@prisma/client'

export interface CollectionSummary {
  id: number
  name: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

function toSummary(collection: {
  id: number
  name: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}): CollectionSummary {
  return {
    id: collection.id,
    name: collection.name,
    isDefault: collection.isDefault,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  }
}

export async function getDefaultCollectionId(prisma: PrismaClient): Promise<number> {
  const collection = await prisma.collection.findFirst({ where: { isDefault: true } })
  if (!collection) {
    throw new Error('No default collection exists')
  }
  return collection.id
}

export async function listCollections(prisma: PrismaClient): Promise<CollectionSummary[]> {
  const collections = await prisma.collection.findMany({ orderBy: { createdAt: 'asc' } })
  return collections.map(toSummary)
}

function validateName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    throw new Error('Collection name cannot be empty')
  }
  return trimmed
}

export async function createCollection(prisma: PrismaClient, name: string): Promise<number> {
  const collection = await prisma.collection.create({ data: { name: validateName(name), isDefault: false } })
  return collection.id
}

export async function renameCollection(prisma: PrismaClient, collectionId: number, name: string): Promise<void> {
  await prisma.collection.update({ where: { id: collectionId }, data: { name: validateName(name) } })
}

export async function deleteCollection(prisma: PrismaClient, collectionId: number): Promise<void> {
  const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
  if (collection.isDefault) {
    throw new Error('Cannot delete the default collection')
  }
  await prisma.collection.delete({ where: { id: collectionId } })
}

export async function setDefaultCollection(prisma: PrismaClient, collectionId: number): Promise<void> {
  await prisma.$transaction([
    prisma.collection.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    prisma.collection.update({ where: { id: collectionId }, data: { isDefault: true } }),
  ])
}

/** Parses CSV text (quoted fields, embedded commas/quotes/newlines) into rows of raw string cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += char
    i += 1
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

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
    prisma.collection.update({ where: { id: collectionId }, data: {} }),
  ])

  return { imported: toInsert.length, skipped }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/collections.ts src/lib/collections.test.ts src/lib/testFixtures.ts
git commit -m "Add Collection CRUD, CSV import, and seedCollection test fixture"
```

Per this plan's Global Constraints, do not run the full `npm test`/`npx tsc --noEmit` yet — still expected to fail until Task 7.

---

### Task 3: Retrofit `collection.ts` and its callers

**Files:**
- Modify: `src/lib/collection.ts`
- Modify: `src/lib/collection.test.ts`
- Modify: `src/actions/collectionMutations.ts`
- Modify: `src/actions/collectionMutations.test.ts`
- Modify: `src/actions/collectionActions.ts`
- Modify: `src/app/api/collection/export/route.ts`
- Modify: `src/app/api/collection/export/route.test.ts`

**Interfaces:**
- Consumes: `getDefaultCollectionId` (Task 2), `seedCollection` (Task 2).
- Produces (used by Task 7's tests, indirectly): `incrementOwned(prisma, collectionId, cardCode, amount)`, `setOwned(prisma, collectionId, cardCode, quantity)`, `getOwnedQuantity(prisma, collectionId, cardCode)`, `exportCollectionCsv(prisma, collectionId)`.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/lib/collection.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { incrementOwned, setOwned, getOwnedQuantity, exportCollectionCsv } from './collection'
import type { PrismaClient } from '@prisma/client'

describe('collection', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.collection.deleteMany()
    await prisma.card.deleteMany()
  })

  it('getOwnedQuantity returns 0 for a card with no collection entry', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    expect(await getOwnedQuantity(prisma, collectionId, '01007')).toBe(0)
  })

  it('incrementOwned creates an entry when none exists', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    const quantity = await incrementOwned(prisma, collectionId, '01007', 2)
    expect(quantity).toBe(2)
  })

  it('incrementOwned adds to an existing owned count', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 1)
    const quantity = await incrementOwned(prisma, collectionId, '01007', 2)
    expect(quantity).toBe(3)
  })

  it('incrementOwned rejects non-positive amounts', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await expect(incrementOwned(prisma, collectionId, '01007', 0)).rejects.toThrow()
  })

  it('setOwned overwrites the owned count regardless of prior value', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 3)
    const quantity = await setOwned(prisma, collectionId, '01007', 1)
    expect(quantity).toBe(1)
  })

  it('setOwned accepts 0 to mark a card as not owned', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 3)
    const quantity = await setOwned(prisma, collectionId, '01007', 0)
    expect(quantity).toBe(0)
  })

  it('keeps quantities independent across two different collections for the same card', async () => {
    const a = await seedCollection(prisma, { name: 'Collection A' })
    const b = await seedCollection(prisma, { name: 'Collection B', isDefault: false })
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    await incrementOwned(prisma, a.id, '01007', 2)
    await incrementOwned(prisma, b.id, '01007', 5)

    expect(await getOwnedQuantity(prisma, a.id, '01007')).toBe(2)
    expect(await getOwnedQuantity(prisma, b.id, '01007')).toBe(5)
  })

  it("incrementOwned bumps the parent collection's updatedAt", async () => {
    const { id: collectionId, updatedAt: originalUpdatedAt } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    await incrementOwned(prisma, collectionId, '01007', 1)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(collection.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  describe('exportCollectionCsv', () => {
    it('returns just the header when nothing is owned', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      const csv = await exportCollectionCsv(prisma, collectionId)
      expect(csv).toBe('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n')
    })

    it('includes one row per owned card, with printed quantity', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, {
        code: '02001',
        title: 'Corroder',
        packCode: 'sg',
        packName: 'System Gateway',
        factionCode: 'anarch',
        quantity: 3,
      })
      await incrementOwned(prisma, collectionId, '02001', 2)

      const csv = await exportCollectionCsv(prisma, collectionId)

      const lines = csv.trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[1]).toBe('02001,Corroder,anarch,sg,System Gateway,2,3')
    })

    it('leaves printedQuantity blank for a card with no declared quantity', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: null })
      await incrementOwned(prisma, collectionId, '01007', 1)

      const csv = await exportCollectionCsv(prisma, collectionId)

      expect(csv.trim().split('\n')[1]).toBe('01007,Corroder,anarch,core,core,1,')
    })

    it('quotes and escapes a title containing a double quote', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01007', title: 'Kate "Mac" McCaffrey', packCode: 'core' })
      await incrementOwned(prisma, collectionId, '01007', 1)

      const csv = await exportCollectionCsv(prisma, collectionId)

      expect(csv.trim().split('\n')[1]).toContain('"Kate ""Mac"" McCaffrey"')
    })

    it('excludes a card with no collection entry', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

      const csv = await exportCollectionCsv(prisma, collectionId)

      expect(csv).toBe('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n')
    })

    it('only exports entries from the given collection, not others', async () => {
      const a = await seedCollection(prisma, { name: 'Collection A' })
      const b = await seedCollection(prisma, { name: 'Collection B', isDefault: false })
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
      await incrementOwned(prisma, a.id, '01007', 2)
      await incrementOwned(prisma, b.id, '01007', 9)

      const csv = await exportCollectionCsv(prisma, a.id)

      expect(csv.trim().split('\n')[1]).toContain(',2,')
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/collection.test.ts`
Expected: FAIL — `incrementOwned` etc. don't accept a `collectionId` argument yet (type error) and `seedCollection`/`prisma.collection` don't work against the old schema shape's assumptions in the current implementation.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/lib/collection.ts` with:

```ts
import type { PrismaClient } from '@prisma/client'

export async function incrementOwned(
  prisma: PrismaClient,
  collectionId: number,
  cardCode: string,
  amount: number
): Promise<number> {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const [entry] = await prisma.$transaction([
    prisma.collectionEntry.upsert({
      where: { collectionId_cardCode: { collectionId, cardCode } },
      create: { collectionId, cardCode, quantityOwned: amount },
      update: { quantityOwned: { increment: amount } },
    }),
    prisma.collection.update({ where: { id: collectionId }, data: {} }),
  ])

  return entry.quantityOwned
}

export async function setOwned(
  prisma: PrismaClient,
  collectionId: number,
  cardCode: string,
  quantity: number
): Promise<number> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`quantity must be a non-negative integer, got ${quantity}`)
  }

  const [entry] = await prisma.$transaction([
    prisma.collectionEntry.upsert({
      where: { collectionId_cardCode: { collectionId, cardCode } },
      create: { collectionId, cardCode, quantityOwned: quantity },
      update: { quantityOwned: quantity },
    }),
    prisma.collection.update({ where: { id: collectionId }, data: {} }),
  ])

  return entry.quantityOwned
}

export async function getOwnedQuantity(prisma: PrismaClient, collectionId: number, cardCode: string): Promise<number> {
  const entry = await prisma.collectionEntry.findUnique({
    where: { collectionId_cardCode: { collectionId, cardCode } },
  })
  return entry?.quantityOwned ?? 0
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** CSV of every owned card in a collection: code, title, faction, set, owned quantity, and printed quantity. */
export async function exportCollectionCsv(prisma: PrismaClient, collectionId: number): Promise<string> {
  const entries = await prisma.collectionEntry.findMany({
    where: { collectionId },
    include: { card: { include: { pack: true, faction: true } } },
    orderBy: [{ card: { packCode: 'asc' } }, { card: { position: 'asc' } }],
  })

  const header = 'cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n'
  const rows = entries.map((entry) => {
    const card = entry.card
    return (
      [
        csvEscape(card.code),
        csvEscape(card.title),
        csvEscape(card.faction.name),
        csvEscape(card.packCode),
        csvEscape(card.pack.name),
        String(entry.quantityOwned),
        card.quantity === null ? '' : String(card.quantity),
      ].join(',') + '\n'
    )
  })

  return header + rows.join('')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/collection.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Update `collectionMutations.ts` and its test**

Replace the full contents of `src/actions/collectionMutations.ts` with:

```ts
import type { PrismaClient } from '@prisma/client'
import { incrementOwned, setOwned } from '@/lib/collection'

export async function addToCollectionMutation(
  prisma: PrismaClient,
  collectionId: number,
  cardCode: string,
  amount: number
): Promise<number> {
  return incrementOwned(prisma, collectionId, cardCode, amount)
}

export async function updateCollectionQuantityMutation(
  prisma: PrismaClient,
  collectionId: number,
  cardCode: string,
  quantity: number
): Promise<number> {
  return setOwned(prisma, collectionId, cardCode, quantity)
}
```

Replace the full contents of `src/actions/collectionMutations.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addToCollectionMutation, updateCollectionQuantityMutation } from './collectionMutations'
import * as collectionLib from '@/lib/collection'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/collection', () => ({
  incrementOwned: vi.fn(),
  setOwned: vi.fn(),
}))

describe('collection action wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('addToCollectionMutation delegates to incrementOwned, not setOwned', async () => {
    vi.mocked(collectionLib.incrementOwned).mockResolvedValue(5)
    const prisma = {} as PrismaClient

    const result = await addToCollectionMutation(prisma, 1, '01007', 2)

    expect(collectionLib.incrementOwned).toHaveBeenCalledWith(prisma, 1, '01007', 2)
    expect(collectionLib.setOwned).not.toHaveBeenCalled()
    expect(result).toBe(5)
  })

  it('updateCollectionQuantityMutation delegates to setOwned, not incrementOwned', async () => {
    vi.mocked(collectionLib.setOwned).mockResolvedValue(1)
    const prisma = {} as PrismaClient

    const result = await updateCollectionQuantityMutation(prisma, 1, '01007', 1)

    expect(collectionLib.setOwned).toHaveBeenCalledWith(prisma, 1, '01007', 1)
    expect(collectionLib.incrementOwned).not.toHaveBeenCalled()
    expect(result).toBe(1)
  })
})
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/actions/collectionMutations.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Update `collectionActions.ts` to resolve the default collection**

Replace the full contents of `src/actions/collectionActions.ts` with:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
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
```

(No test file exists for `collectionActions.ts` — matches this codebase's existing convention of not unit-testing thin `*Actions.ts` wrappers.)

- [ ] **Step 8: Update the export route and its test**

Replace the full contents of `src/app/api/collection/export/route.ts` with:

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
import { exportCollectionCsv } from '@/lib/collection'

export async function GET() {
  const collectionId = await getDefaultCollectionId(prisma)
  const csv = await exportCollectionCsv(prisma, collectionId)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="netrunner-collection.csv"',
    },
  })
}
```

Replace the full contents of `src/app/api/collection/export/route.test.ts` with:

```ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection } from '@/lib/testFixtures'
import { incrementOwned } from '@/lib/collection'

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

    const response = await GET()

    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="netrunner-collection.csv"')
  })

  it('returns the default collection as CSV', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01007', 2)

    const response = await GET()
    const body = await response.text()

    expect(body).toContain('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity')
    expect(body).toContain('01007,Corroder,anarch,core,core,2,3')
  })
})
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/collection/export/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add src/lib/collection.ts src/lib/collection.test.ts src/actions/collectionMutations.ts src/actions/collectionMutations.test.ts src/actions/collectionActions.ts src/app/api/collection/export/route.ts src/app/api/collection/export/route.test.ts
git commit -m "Retrofit collection.ts and its callers for multi-collection support"
```

Per this plan's Global Constraints, whole-suite `npm test`/`tsc --noEmit` still won't pass yet (cards.ts/reports.ts/decks.ts/batchMutations.ts remain un-retrofitted) — expected.

---

### Task 4: Retrofit `cards.ts` and its callers

**Files:**
- Modify: `src/lib/cards.ts`
- Modify: `src/lib/cards.test.ts`
- Modify: `src/app/api/cards/search/route.ts`
- Modify: `src/app/sets/[packCode]/page.tsx` (partial — only the `listCardsInPack` call; its `computeSetCompletion` call is Task 5's concern)

**Interfaces:**
- Consumes: `getDefaultCollectionId` (Task 2), `seedCollection` (Task 2).
- Produces (used later): `searchCards(prisma, collectionId, filters)`, `listCardsInPack(prisma, collectionId, packCode)`. `getOtherPrintings` is unchanged — confirmed it never touches `CollectionEntry`.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/lib/cards.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { incrementOwned } from './collection'
import { searchCards, listCardsInPack, getOtherPrintings } from './cards'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.hiddenBuilderPack.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.card.deleteMany()
})

describe('searchCards', () => {
  it('finds cards by a case-insensitive partial title match', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '01011', title: 'Mimic', packCode: 'core' })

    const results = await searchCards(prisma, collectionId, { query: 'corro' })

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Corroder')
  })

  it('includes owned quantity in results', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01007', 2)

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(2)
  })

  it('returns 0 owned quantity for cards not in the collection', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(0)
  })

  it('only reflects the given collection\'s ownership, not another collection\'s', async () => {
    const mine = await seedCollection(prisma, { name: 'Mine' })
    const other = await seedCollection(prisma, { name: 'Other', isDefault: false })
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, other.id, '01007', 4)

    const results = await searchCards(prisma, mine.id, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(0)
  })

  it('filters by faction when provided', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', factionCode: 'anarch' })
    await seedCard(prisma, { code: '02001', title: 'Corroder Alt', packCode: 'core', factionCode: 'shaper' })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder', factionCode: 'anarch' })

    expect(results).toHaveLength(1)
    expect(results[0].code).toBe('01007')
  })

  it('excludes cards from a hidden pack in the general search', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '02007', title: 'Corroder Alt', packCode: 'sg' })
    await prisma.hiddenBuilderPack.create({ data: { packCode: 'core' } })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results.map((r) => r.code)).toEqual(['02007'])
  })

  it('is unaffected when no packs are hidden', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results.map((r) => r.code)).toEqual(['01007'])
  })

  it('includes full card-detail fields, joining faction and type names', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, {
      code: '01007',
      title: 'Corroder',
      packCode: 'core',
      factionCode: 'anarch',
      typeCode: 'program',
    })

    const [card] = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(card.factionName).toBe('anarch')
    expect(card.typeName).toBe('program')
    expect(card.sideCode).toBe('runner')
    expect(card.uniqueness).toBe(false)
    expect(card.cost).toBeNull()
    expect(card.factionCost).toBeNull()
    expect(card.strength).toBeNull()
    expect(card.deckLimit).toBeNull()
    expect(card.keywords).toBeNull()
    expect(card.text).toBeNull()
  })

  it("includes the card's declared printed quantity", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: 3 })

    const results = await searchCards(prisma, collectionId, { query: 'Corroder' })

    expect(results[0].quantity).toBe(3)
  })
})

describe('listCardsInPack', () => {
  it('lists cards in a pack ordered by position with owned quantities', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', position: 2 })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', position: 1 })
    await incrementOwned(prisma, collectionId, '01001', 3)

    const cards = await listCardsInPack(prisma, collectionId, 'core')

    expect(cards.map((c) => c.code)).toEqual(['01001', '01002'])
    expect(cards[0].ownedQuantity).toBe(3)
    expect(cards[1].ownedQuantity).toBe(0)
  })

  it('includes card-detail fields, joining faction and type names', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, {
      code: '01001',
      title: 'Card A',
      packCode: 'core',
      position: 1,
      factionCode: 'anarch',
      typeCode: 'program',
    })

    const [card] = await listCardsInPack(prisma, collectionId, 'core')

    expect(card.factionName).toBe('anarch')
    expect(card.typeName).toBe('program')
    expect(card.sideCode).toBe('runner')
    expect(card.uniqueness).toBe(false)
    expect(card.cost).toBeNull()
    expect(card.factionCost).toBeNull()
    expect(card.strength).toBeNull()
    expect(card.deckLimit).toBeNull()
    expect(card.keywords).toBeNull()
    expect(card.text).toBeNull()
  })

  it("includes each card's declared printed quantity", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Corroder', packCode: 'core', quantity: 2 })

    const [card] = await listCardsInPack(prisma, collectionId, 'core')

    expect(card.quantity).toBe(2)
  })
})

describe('getOtherPrintings', () => {
  it('finds another printing of the same card title in a different set', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', packName: 'Core Set' })
    await seedCard(prisma, { code: '31006', title: 'Corroder', packCode: 'su21', packName: 'System Update 2021' })

    const printings = await getOtherPrintings(prisma, '01007')

    expect(printings).toEqual([{ code: '31006', packCode: 'su21', packName: 'System Update 2021' }])
  })

  it('excludes the card itself', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '31006', title: 'Corroder', packCode: 'su21' })

    const printings = await getOtherPrintings(prisma, '01007')

    expect(printings.some((printing) => printing.code === '01007')).toBe(false)
  })

  it('returns an empty list for a card with no other printings', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '01011', title: 'Mimic', packCode: 'core' })

    const printings = await getOtherPrintings(prisma, '01007')

    expect(printings).toEqual([])
  })

  it('returns an empty list for a card code that does not exist', async () => {
    const printings = await getOtherPrintings(prisma, 'nonexistent')

    expect(printings).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/cards.test.ts`
Expected: FAIL — `searchCards`/`listCardsInPack` don't accept a `collectionId` argument yet.

- [ ] **Step 3: Write the implementation**

In `src/lib/cards.ts`, replace the `searchCards` function:

```ts
export async function searchCards(
  prisma: PrismaClient,
  filters: CardSearchFilters
): Promise<CardSearchResult[]> {
  const hiddenPacks = await prisma.hiddenBuilderPack.findMany({ select: { packCode: true } })
  const hiddenPackCodes = hiddenPacks.map((row) => row.packCode)

  const cards = await prisma.card.findMany({
    where: {
      title: { contains: filters.query },
      ...(filters.factionCode ? { factionCode: filters.factionCode } : {}),
      ...(filters.typeCode ? { typeCode: filters.typeCode } : {}),
      ...(filters.packCode
        ? { packCode: filters.packCode }
        : hiddenPackCodes.length > 0
          ? { packCode: { notIn: hiddenPackCodes } }
          : {}),
      ...(filters.sideCode ? { sideCode: filters.sideCode } : {}),
    },
    include: { pack: true, collectionEntry: true, faction: true, type: true },
    orderBy: { title: 'asc' },
    take: 50,
  })

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
    ownedQuantity: card.collectionEntry?.quantityOwned ?? 0,
    quantity: card.quantity,
  }))
}
```

with:

```ts
export async function searchCards(
  prisma: PrismaClient,
  collectionId: number,
  filters: CardSearchFilters
): Promise<CardSearchResult[]> {
  const hiddenPacks = await prisma.hiddenBuilderPack.findMany({ select: { packCode: true } })
  const hiddenPackCodes = hiddenPacks.map((row) => row.packCode)

  const cards = await prisma.card.findMany({
    where: {
      title: { contains: filters.query },
      ...(filters.factionCode ? { factionCode: filters.factionCode } : {}),
      ...(filters.typeCode ? { typeCode: filters.typeCode } : {}),
      ...(filters.packCode
        ? { packCode: filters.packCode }
        : hiddenPackCodes.length > 0
          ? { packCode: { notIn: hiddenPackCodes } }
          : {}),
      ...(filters.sideCode ? { sideCode: filters.sideCode } : {}),
    },
    include: {
      pack: true,
      collectionEntries: { where: { collectionId } },
      faction: true,
      type: true,
    },
    orderBy: { title: 'asc' },
    take: 50,
  })

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

Leave `getOtherPrintings` completely untouched. Replace the `listCardsInPack` function:

```ts
export async function listCardsInPack(prisma: PrismaClient, packCode: string): Promise<PackCardEntry[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    include: { collectionEntry: true, faction: true, type: true },
    orderBy: { position: 'asc' },
  })

  return cards.map((card) => ({
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
    ownedQuantity: card.collectionEntry?.quantityOwned ?? 0,
    quantity: card.quantity,
  }))
}
```

with:

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

  return cards.map((card) => ({
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
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/cards.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Update the search route**

Replace the full contents of `src/app/api/cards/search/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { searchCards } from '@/lib/cards'
import { getDefaultCollectionId } from '@/lib/collections'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? ''

  if (query.trim().length === 0) {
    return NextResponse.json([])
  }

  const collectionId = await getDefaultCollectionId(prisma)
  const results = await searchCards(prisma, collectionId, {
    query,
    factionCode: request.nextUrl.searchParams.get('faction') ?? undefined,
    typeCode: request.nextUrl.searchParams.get('type') ?? undefined,
    packCode: request.nextUrl.searchParams.get('pack') ?? undefined,
    sideCode: request.nextUrl.searchParams.get('side') ?? undefined,
  })

  return NextResponse.json(results)
}
```

Note: `getDefaultCollectionId` is called **after** the empty-query early return, preserving `search/route.test.ts`'s existing "blank query touches no database at all" assertions (those tests spy on `prisma.card.findMany` only, not `prisma.collection.findFirst`, but keeping the ordering as-is avoids any risk of a spurious extra call before that guard). No changes are needed to `search/route.test.ts` itself — it doesn't seed a `Collection`, and none of its existing assertions depend on one existing, EXCEPT its non-empty-query tests will now internally call `getDefaultCollectionId`, which will throw if no default collection exists in that test's DB. Add `seedCollection` to those tests:

In `src/app/api/cards/search/route.test.ts`, change the import line from:

```ts
import { seedCard } from '@/lib/testFixtures'
```

to:

```ts
import { seedCard, seedCollection } from '@/lib/testFixtures'
```

Then, in each of the three tests that issue a non-empty query (`'returns matching cards for a real query'`, `'applies the faction filter param'`, `'applies the type, pack, and side filter params'`), add `await seedCollection(prisma)` as the first line of the test body (before the existing `seedCard` calls). The two empty/blank-query tests (`'returns [] for a missing q param...'`, `'returns [] for a blank q param...'`) do **not** need `seedCollection` — they return before `getDefaultCollectionId` would ever be called.

Also add `await prisma.collection.deleteMany()` to that file's `beforeEach`, alongside the existing `collectionEntry.deleteMany()`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/app/api/cards/search/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Update the set browser page's `listCardsInPack` call**

In `src/app/sets/[packCode]/page.tsx`, add an import:

```tsx
import { getDefaultCollectionId } from '@/lib/collections'
```

Then change:

```tsx
  const [cards, completion] = await Promise.all([
    listCardsInPack(prisma, packCode),
    computeSetCompletion(prisma, packCode),
  ])
```

to:

```tsx
  const collectionId = await getDefaultCollectionId(prisma)
  const [cards, completion] = await Promise.all([
    listCardsInPack(prisma, collectionId, packCode),
    computeSetCompletion(prisma, packCode),
  ])
```

Leave the `computeSetCompletion(prisma, packCode)` call exactly as-is for now — Task 5 updates it to also take `collectionId` (reusing the variable just introduced here). This file will not fully type-check until Task 5 runs; that's expected per this plan's Global Constraints.

- [ ] **Step 8: Commit**

```bash
git add src/lib/cards.ts src/lib/cards.test.ts src/app/api/cards/search/route.ts src/app/api/cards/search/route.test.ts src/app/sets/\[packCode\]/page.tsx
git commit -m "Retrofit cards.ts and its callers for multi-collection support"
```

---

### Task 5: Retrofit `reports.ts` and its callers

**Files:**
- Modify: `src/lib/reports.ts`
- Modify: `src/lib/reports.test.ts`
- Modify: `src/app/page.tsx` (Dashboard)
- Modify: `src/app/sets/[packCode]/page.tsx` (finishes what Task 4 started)
- Modify: `src/app/reports/under-owned-cards/page.tsx`

**Interfaces:**
- Consumes: `getDefaultCollectionId` (Task 2), `seedCollection` (Task 2).
- Produces (used later): `computeSetCompletion(prisma, collectionId, packCode)`, `computeAllSetsCompletion(prisma, collectionId)`, `computeCollectionTotals(prisma, collectionId)`, `listCardsUnderExpectedQuantity(prisma, collectionId)`. `listUnsizedPacks` and `listPacksMissingImage` are unchanged — confirmed neither touches `CollectionEntry`.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/lib/reports.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { incrementOwned } from './collection'
import {
  computeSetCompletion,
  computeAllSetsCompletion,
  computeCollectionTotals,
  groupSetsByCycle,
  listUnsizedPacks,
  listPacksMissingImage,
  releaseYear,
  cardContribution,
  listCardsUnderExpectedQuantity,
} from './reports'
import type { PrismaClient } from '@prisma/client'

describe('reports', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.collection.deleteMany()
    await prisma.card.deleteMany()
    await prisma.pack.deleteMany()
    await prisma.cycle.deleteMany()
  })

  it('computes percent owned for a set', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await incrementOwned(prisma, collectionId, '01001', 1)

    const completion = await computeSetCompletion(prisma, collectionId, 'core')

    expect(completion).toEqual({
      packCode: 'core',
      packName: 'core',
      cycleCode: 'core',
      cycleName: 'core',
      dateRelease: null,
      setType: null,
      ownedCount: 1,
      totalCount: 2,
      percentOwned: 50,
    })
  })

  it("includes the pack's official set type", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, {
      code: '01001',
      title: 'Card A',
      packCode: 'core',
      packSize: 1,
      position: 1,
      packSetType: 'deluxe',
    })

    const completion = await computeSetCompletion(prisma, collectionId, 'core')

    expect(completion?.setType).toBe('deluxe')
  })

  it('counts partial ownership of a multi-copy card toward the percentage, not just whether you own any', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 2)

    const completion = await computeSetCompletion(prisma, collectionId, 'core')

    expect(completion?.ownedCount).toBe(2)
    expect(completion?.totalCount).toBe(3)
    expect(completion?.percentOwned).toBe(67)
  })

  it("caps a card's contribution at its printed quantity, even if you own more than that", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 5)

    const completion = await computeSetCompletion(prisma, collectionId, 'core')

    expect(completion?.ownedCount).toBe(3)
    expect(completion?.totalCount).toBe(3)
    expect(completion?.percentOwned).toBe(100)
  })

  it('returns null for a pack with no declared size', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Draft Card', packCode: 'draft', packSize: null, position: 1 })
    const completion = await computeSetCompletion(prisma, collectionId, 'draft')
    expect(completion).toBeNull()
  })

  it('excludes sets with no declared size from the full list', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1 })
    await seedCard(prisma, { code: '02001', title: 'Draft Card', packCode: 'draft', packSize: null, position: 1 })

    const all = await computeAllSetsCompletion(prisma, collectionId)

    expect(all.map((c) => c.packCode)).toEqual(['core'])
  })

  it('lists packs with no declared size, excluding sized packs', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1 })
    await seedCard(prisma, {
      code: 'd0001',
      title: 'Draft Card',
      packCode: 'draft',
      packName: 'Draft',
      packSize: null,
      position: 1,
    })

    const unsized = await listUnsizedPacks(prisma)

    expect(unsized).toEqual([{ packCode: 'draft', packName: 'Draft', cycleCode: 'core', setType: null }])
  })

  it('lists packs with no locally-downloaded cover image', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'draft', packSize: 1, position: 1 })
    await seedCard(prisma, {
      code: '02001',
      title: 'Card B',
      packCode: 'sg',
      packName: 'System Gateway',
      packSize: 1,
      position: 1,
    })

    const missing = await listPacksMissingImage(prisma)

    expect(missing.map((p) => p.packCode)).toEqual(['draft'])
  })

  it('computes overall collection totals across all cards', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await seedCard(prisma, { code: 'd0001', title: 'Draft Card', packCode: 'draft', packSize: null, position: 1 })
    await incrementOwned(prisma, collectionId, '01001', 1)

    const totals = await computeCollectionTotals(prisma, collectionId)

    expect(totals).toEqual({ ownedCards: 1, totalCards: 3, percentOwned: 33 })
  })

  it('weights overall totals by printed quantity too, not just distinct cards owned', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 1, position: 2, quantity: 1 })
    await incrementOwned(prisma, collectionId, '01001', 2)

    const totals = await computeCollectionTotals(prisma, collectionId)

    expect(totals).toEqual({ ownedCards: 2, totalCards: 4, percentOwned: 50 })
  })

  it('keeps completion independent across two different collections', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1 })
    await incrementOwned(prisma, a.id, '01001', 1)

    const totalsA = await computeCollectionTotals(prisma, a.id)
    const totalsB = await computeCollectionTotals(prisma, b.id)

    expect(totalsA.ownedCards).toBe(1)
    expect(totalsB.ownedCards).toBe(0)
  })

  describe('listCardsUnderExpectedQuantity', () => {
    it('includes a card owned less than its printed quantity', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
      await incrementOwned(prisma, collectionId, '01001', 2)

      const sets = await listCardsUnderExpectedQuantity(prisma, collectionId)

      expect(sets).toEqual([
        {
          packCode: 'core',
          packName: 'core',
          cards: [{ code: '01001', title: 'Card A', factionName: 'anarch', quantityOwned: 2, quantity: 3 }],
        },
      ])
    })

    it('excludes a fully-owned card', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
      await incrementOwned(prisma, collectionId, '01001', 3)

      expect(await listCardsUnderExpectedQuantity(prisma, collectionId)).toEqual([])
    })

    it('excludes a card owned more than its printed quantity', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
      await incrementOwned(prisma, collectionId, '01001', 5)

      expect(await listCardsUnderExpectedQuantity(prisma, collectionId)).toEqual([])
    })

    it('excludes a card owned zero of', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })

      expect(await listCardsUnderExpectedQuantity(prisma, collectionId)).toEqual([])
    })

    it('excludes a partially-owned card with no declared printed quantity', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, {
        code: '01001',
        title: 'Draft Card',
        packCode: 'draft',
        packSize: null,
        position: 1,
        quantity: null,
      })
      await incrementOwned(prisma, collectionId, '01001', 1)

      expect(await listCardsUnderExpectedQuantity(prisma, collectionId)).toEqual([])
    })

    it('omits a set with no under-owned cards, includes one that has a shortfall', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1, quantity: 3 })
      await incrementOwned(prisma, collectionId, '01001', 3)
      await seedCard(prisma, { code: '02001', title: 'Card B', packCode: 'genesis1', packSize: 1, position: 1, quantity: 2 })
      await incrementOwned(prisma, collectionId, '02001', 1)

      const sets = await listCardsUnderExpectedQuantity(prisma, collectionId)

      expect(sets.map((s) => s.packCode)).toEqual(['genesis1'])
    })

    it('sorts under-owned cards within a set by title', async () => {
      const { id: collectionId } = await seedCollection(prisma)
      await seedCard(prisma, { code: '01002', title: 'Zebra Card', packCode: 'core', packSize: 1, position: 2, quantity: 2 })
      await incrementOwned(prisma, collectionId, '01002', 1)
      await seedCard(prisma, { code: '01001', title: 'Alpha Card', packCode: 'core', packSize: 1, position: 1, quantity: 2 })
      await incrementOwned(prisma, collectionId, '01001', 1)

      const sets = await listCardsUnderExpectedQuantity(prisma, collectionId)

      expect(sets[0].cards.map((c) => c.title)).toEqual(['Alpha Card', 'Zebra Card'])
    })
  })
})

describe('cardContribution', () => {
  it('counts partial ownership up to the printed quantity', () => {
    expect(cardContribution(2, 3)).toBe(2)
  })

  it('caps at the printed quantity when more are owned', () => {
    expect(cardContribution(5, 3)).toBe(3)
  })

  it('falls back to a quantity of 1 when the printed quantity is unknown', () => {
    expect(cardContribution(1, null)).toBe(1)
    expect(cardContribution(5, null)).toBe(1)
  })

  it('returns 0 for an unowned card', () => {
    expect(cardContribution(0, 3)).toBe(0)
  })
})

describe('groupSetsByCycle', () => {
  it('groups sets by their cycle code, preserving input order within each group', () => {
    const sets = [
      {
        packCode: 'core',
        packName: 'Core Set',
        cycleCode: 'core',
        cycleName: 'Core Set',
        dateRelease: '2012-09-06',
        setType: 'core',
        ownedCount: 1,
        totalCount: 2,
        percentOwned: 50,
      },
      {
        packCode: 'asis',
        packName: 'A Study in Static',
        cycleCode: 'genesis',
        cycleName: 'Genesis',
        dateRelease: '2013-03-21',
        setType: 'data_pack',
        ownedCount: 0,
        totalCount: 20,
        percentOwned: 0,
      },
      {
        packCode: 'cotc',
        packName: 'Cyber Exodus',
        cycleCode: 'genesis',
        cycleName: 'Genesis',
        dateRelease: '2013-05-16',
        setType: 'data_pack',
        ownedCount: 5,
        totalCount: 20,
        percentOwned: 25,
      },
    ]

    const grouped = groupSetsByCycle(sets)

    expect([...grouped.keys()]).toEqual(['core', 'genesis'])
    expect(grouped.get('genesis')?.map((s) => s.packCode)).toEqual(['asis', 'cotc'])
  })
})

describe('releaseYear', () => {
  it('extracts the year from an ISO release date', () => {
    expect(releaseYear('2017-02-23')).toBe('2017')
  })

  it('returns null when there is no release date', () => {
    expect(releaseYear(null)).toBeNull()
  })

  it('returns null for an unparseable date string', () => {
    expect(releaseYear('not-a-date')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/reports.test.ts`
Expected: FAIL — `computeSetCompletion` etc. don't accept a `collectionId` argument yet.

- [ ] **Step 3: Write the implementation**

In `src/lib/reports.ts`, replace `computeSetCompletion`:

```ts
export async function computeSetCompletion(
  prisma: PrismaClient,
  packCode: string
): Promise<SetCompletion | null> {
  const pack = await prisma.pack.findUnique({ where: { code: packCode }, include: { cycle: true } })
  if (!pack || !pack.size) {
    return null
  }

  const cards = await prisma.card.findMany({
    where: { packCode },
    select: { quantity: true, collectionEntry: { select: { quantityOwned: true } } },
  })

  const totalCount = cards.reduce((sum, card) => sum + (card.quantity ?? 1), 0)
  const ownedCount = cards.reduce(
    (sum, card) => sum + cardContribution(card.collectionEntry?.quantityOwned ?? 0, card.quantity),
    0
  )

  return {
    packCode: pack.code,
    packName: pack.name,
    cycleCode: pack.cycleCode,
    cycleName: pack.cycle.name,
    dateRelease: pack.dateRelease,
    setType: pack.setType,
    ownedCount,
    totalCount,
    percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
  }
}
```

with:

```ts
export async function computeSetCompletion(
  prisma: PrismaClient,
  collectionId: number,
  packCode: string
): Promise<SetCompletion | null> {
  const pack = await prisma.pack.findUnique({ where: { code: packCode }, include: { cycle: true } })
  if (!pack || !pack.size) {
    return null
  }

  const cards = await prisma.card.findMany({
    where: { packCode },
    select: {
      quantity: true,
      collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
    },
  })

  const totalCount = cards.reduce((sum, card) => sum + (card.quantity ?? 1), 0)
  const ownedCount = cards.reduce(
    (sum, card) => sum + cardContribution(card.collectionEntries[0]?.quantityOwned ?? 0, card.quantity),
    0
  )

  return {
    packCode: pack.code,
    packName: pack.name,
    cycleCode: pack.cycleCode,
    cycleName: pack.cycle.name,
    dateRelease: pack.dateRelease,
    setType: pack.setType,
    ownedCount,
    totalCount,
    percentOwned: totalCount === 0 ? 0 : Math.round((ownedCount / totalCount) * 100),
  }
}
```

Replace `computeAllSetsCompletion`:

```ts
export async function computeAllSetsCompletion(prisma: PrismaClient): Promise<SetCompletion[]> {
  const packs = await prisma.pack.findMany({
    where: { size: { not: null } },
    orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }],
  })

  const results: SetCompletion[] = []
  for (const pack of packs) {
    const completion = await computeSetCompletion(prisma, pack.code)
    if (completion) {
      results.push(completion)
    }
  }

  return results
}
```

with:

```ts
export async function computeAllSetsCompletion(prisma: PrismaClient, collectionId: number): Promise<SetCompletion[]> {
  const packs = await prisma.pack.findMany({
    where: { size: { not: null } },
    orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }],
  })

  const results: SetCompletion[] = []
  for (const pack of packs) {
    const completion = await computeSetCompletion(prisma, collectionId, pack.code)
    if (completion) {
      results.push(completion)
    }
  }

  return results
}
```

Replace `computeCollectionTotals`:

```ts
export async function computeCollectionTotals(prisma: PrismaClient): Promise<CollectionTotals> {
  const cards = await prisma.card.findMany({
    select: { quantity: true, collectionEntry: { select: { quantityOwned: true } } },
  })

  const totalCards = cards.reduce((sum, card) => sum + (card.quantity ?? 1), 0)
  const ownedCards = cards.reduce(
    (sum, card) => sum + cardContribution(card.collectionEntry?.quantityOwned ?? 0, card.quantity),
    0
  )

  return {
    ownedCards,
    totalCards,
    percentOwned: totalCards === 0 ? 0 : Math.round((ownedCards / totalCards) * 100),
  }
}
```

with:

```ts
export async function computeCollectionTotals(prisma: PrismaClient, collectionId: number): Promise<CollectionTotals> {
  const cards = await prisma.card.findMany({
    select: {
      quantity: true,
      collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
    },
  })

  const totalCards = cards.reduce((sum, card) => sum + (card.quantity ?? 1), 0)
  const ownedCards = cards.reduce(
    (sum, card) => sum + cardContribution(card.collectionEntries[0]?.quantityOwned ?? 0, card.quantity),
    0
  )

  return {
    ownedCards,
    totalCards,
    percentOwned: totalCards === 0 ? 0 : Math.round((ownedCards / totalCards) * 100),
  }
}
```

Leave `listUnsizedPacks` and `listPacksMissingImage` completely untouched. Replace `listCardsUnderExpectedQuantity`:

```ts
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

with:

```ts
export async function listCardsUnderExpectedQuantity(prisma: PrismaClient, collectionId: number): Promise<UnderOwnedSet[]> {
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
        collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
      },
      orderBy: { title: 'asc' },
    })

    const underOwned: UnderOwnedCard[] = cards
      .filter((card) => {
        const owned = card.collectionEntries[0]?.quantityOwned ?? 0
        return owned > 0 && owned < card.quantity!
      })
      .map((card) => ({
        code: card.code,
        title: card.title,
        factionName: card.faction.name,
        quantityOwned: card.collectionEntries[0]!.quantityOwned,
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
Expected: PASS (26 tests).

- [ ] **Step 5: Update the dashboard**

In `src/app/page.tsx`, add an import:

```tsx
import { getDefaultCollectionId } from '@/lib/collections'
```

Then change:

```tsx
export default async function DashboardPage() {
  const [sets, totals, unsizedPacks] = await Promise.all([
    computeAllSetsCompletion(prisma),
    computeCollectionTotals(prisma),
    listUnsizedPacks(prisma),
  ])
```

to:

```tsx
export default async function DashboardPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const [sets, totals, unsizedPacks] = await Promise.all([
    computeAllSetsCompletion(prisma, collectionId),
    computeCollectionTotals(prisma, collectionId),
    listUnsizedPacks(prisma),
  ])
```

- [ ] **Step 6: Finish the set browser page**

In `src/app/sets/[packCode]/page.tsx`, change (the `collectionId` variable was already introduced by Task 4):

```tsx
  const collectionId = await getDefaultCollectionId(prisma)
  const [cards, completion] = await Promise.all([
    listCardsInPack(prisma, collectionId, packCode),
    computeSetCompletion(prisma, packCode),
  ])
```

to:

```tsx
  const collectionId = await getDefaultCollectionId(prisma)
  const [cards, completion] = await Promise.all([
    listCardsInPack(prisma, collectionId, packCode),
    computeSetCompletion(prisma, collectionId, packCode),
  ])
```

- [ ] **Step 7: Update the under-owned-cards report page**

Replace the full contents of `src/app/reports/under-owned-cards/page.tsx` with:

```tsx
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { listCardsUnderExpectedQuantity } from '@/lib/reports'
import { getDefaultCollectionId } from '@/lib/collections'

// Reflects live collection state (owned quantities) — not something to
// freeze into a build-time snapshot. See the dashboard's identical
// rationale.
export const dynamic = 'force-dynamic'

export default async function UnderOwnedCardsReportPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const sets = await listCardsUnderExpectedQuantity(prisma, collectionId)

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
              <h2 className="font-semibold">
                <Link href={`/sets/${set.packCode}`} className="underline hover:text-accent">
                  {set.packName}
                </Link>
              </h2>
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

- [ ] **Step 8: Commit**

```bash
git add src/lib/reports.ts src/lib/reports.test.ts src/app/page.tsx src/app/sets/\[packCode\]/page.tsx src/app/reports/under-owned-cards/page.tsx
git commit -m "Retrofit reports.ts and its callers for multi-collection support"
```

---

### Task 6: Retrofit `decks.ts` and its callers

**Files:**
- Modify: `src/lib/decks.ts`
- Modify: `src/lib/decks.test.ts`
- Modify: `src/app/decks/page.tsx`
- Modify: `src/actions/deckActions.ts`

**Interfaces:**
- Consumes: `getDefaultCollectionId` (Task 2), `seedCollection` (Task 2).
- Produces (used later): `getDecksWithOwnership(prisma, collectionId)`, `getDeckWithOwnership(prisma, collectionId, id)`.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/lib/decks.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
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
  await prisma.collection.deleteMany()
  await prisma.card.deleteMany()
})

describe('getDecksWithOwnership', () => {
  it('computes aggregate and per-card ownership', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', factionCode: 'anarch' })
    await incrementOwned(prisma, collectionId, '01001', 2)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.name).toBe('Test Deck')
    expect(deck.totalCount).toBe(3)
    expect(deck.ownedCount).toBe(2)
    expect(deck.percentOwned).toBe(67)
    expect(deck.cards).toEqual([
      { code: '01001', title: 'Card A', factionName: 'anarch', neededQuantity: 3, ownedQuantity: 2, found: true },
    ])
  })

  it("caps a card's contribution at the needed quantity, not what is owned beyond it", async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, collectionId, '01001', 5)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

    expect(deck.ownedCount).toBe(3)
    expect(deck.cards[0].ownedQuantity).toBe(5)
  })

  it('flags a deck card whose code is not in the local card database, without crashing', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: 'unknown-code', quantity: 3 } })

    const [deck] = await getDecksWithOwnership(prisma, collectionId)

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
    const { id: collectionId } = await seedCollection(prisma)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Older', importedAt: new Date('2026-01-01') } })
    await prisma.deck.create({ data: { id: 2, uuid: 'uuid-2', name: 'Newer', importedAt: new Date('2026-02-01') } })

    const decks = await getDecksWithOwnership(prisma, collectionId)

    expect(decks.map((d) => d.name)).toEqual(['Newer', 'Older'])
  })

  it('returns an empty list when no decks are imported', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    expect(await getDecksWithOwnership(prisma, collectionId)).toEqual([])
  })

  it('keeps ownership independent across two different collections', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await incrementOwned(prisma, a.id, '01001', 3)
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 3 } })

    const [deckA] = await getDecksWithOwnership(prisma, a.id)
    const [deckB] = await getDecksWithOwnership(prisma, b.id)

    expect(deckA.ownedCount).toBe(3)
    expect(deckB.ownedCount).toBe(0)
  })
})

describe('getDeckWithOwnership', () => {
  it('returns the ownership summary for a single deck', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.deck.create({ data: { id: 1, uuid: 'uuid-1', name: 'Test Deck' } })
    await prisma.deckCard.create({ data: { deckId: 1, cardCode: '01001', quantity: 2 } })

    const deck = await getDeckWithOwnership(prisma, collectionId, 1)

    expect(deck?.name).toBe('Test Deck')
    expect(deck?.totalCount).toBe(2)
  })

  it('returns null for a deck id that does not exist', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    expect(await getDeckWithOwnership(prisma, collectionId, 999)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/decks.test.ts`
Expected: FAIL — `getDecksWithOwnership`/`getDeckWithOwnership` don't accept a `collectionId` argument yet.

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/lib/decks.ts` with:

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

async function computeDeckSummary(
  prisma: PrismaClient,
  collectionId: number,
  deck: DeckWithCards
): Promise<DeckSummary> {
  const cardCodes = deck.cards.map((deckCard) => deckCard.cardCode)

  const [cards, collectionEntries] = await Promise.all([
    prisma.card.findMany({ where: { code: { in: cardCodes } }, include: { faction: true } }),
    prisma.collectionEntry.findMany({ where: { collectionId, cardCode: { in: cardCodes } } }),
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

export async function getDecksWithOwnership(prisma: PrismaClient, collectionId: number): Promise<DeckSummary[]> {
  const decks = await prisma.deck.findMany({
    include: { cards: { orderBy: { cardCode: 'asc' } } },
    orderBy: { importedAt: 'desc' },
  })
  return Promise.all(decks.map((deck) => computeDeckSummary(prisma, collectionId, deck)))
}

export async function getDeckWithOwnership(
  prisma: PrismaClient,
  collectionId: number,
  id: number
): Promise<DeckSummary | null> {
  const deck = await prisma.deck.findUnique({
    where: { id },
    include: { cards: { orderBy: { cardCode: 'asc' } } },
  })
  if (!deck) {
    return null
  }
  return computeDeckSummary(prisma, collectionId, deck)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/decks.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Update the decks page**

Replace the full contents of `src/app/decks/page.tsx` with:

```tsx
import { prisma } from '@/lib/db'
import { getDecksWithOwnership } from '@/lib/decks'
import { getDefaultCollectionId } from '@/lib/collections'
import { DeckSection } from './DeckSection'

// Reflects live DB state (owned quantities, imported decks) — not
// something to freeze into a build-time snapshot. See the dashboard's
// identical rationale.
export const dynamic = 'force-dynamic'

export default async function DecksPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const decks = await getDecksWithOwnership(prisma, collectionId)

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Decks</h1>
      <DeckSection initialDecks={decks} />
    </main>
  )
}
```

- [ ] **Step 6: Update `deckActions.ts`'s `importDeck`**

Replace the full contents of `src/actions/deckActions.ts` with:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { parseDecklistId, fetchDecklist } from '@/lib/netrunnerdb'
import { getDeckWithOwnership, type DeckSummary } from '@/lib/decks'
import { getDefaultCollectionId } from '@/lib/collections'
import { saveDeck, removeDeck } from './deckMutations'

export async function importDeck(
  input: string
): Promise<{ ok: true; deck: DeckSummary } | { ok: false; error: string }> {
  const decklistId = parseDecklistId(input)
  if (decklistId === null) {
    return { ok: false, error: 'Enter a valid NetrunnerDB decklist URL or ID' }
  }

  try {
    const decklist = await fetchDecklist(decklistId)
    await saveDeck(prisma, decklist.id, decklist.uuid, decklist.name, decklist.cards)
    revalidatePath('/decks')

    const collectionId = await getDefaultCollectionId(prisma)
    const summary = await getDeckWithOwnership(prisma, collectionId, decklist.id)
    if (!summary) {
      return { ok: false, error: 'Failed to load the imported deck' }
    }
    return { ok: true, deck: summary }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to import deck' }
  }
}

export async function deleteDeck(id: number): Promise<void> {
  await removeDeck(prisma, id)
  revalidatePath('/decks')
}
```

(No test file exists for `deckActions.ts` — matches this codebase's existing convention.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/decks.ts src/lib/decks.test.ts src/app/decks/page.tsx src/actions/deckActions.ts
git commit -m "Retrofit decks.ts and its callers for multi-collection support"
```

---

### Task 7: Retrofit `batchMutations.ts`'s `approveBatch` and its caller

**Files:**
- Modify: `src/actions/batchMutations.ts` (only `approveBatch`)
- Modify: `src/actions/batchMutations.test.ts`
- Modify: `src/actions/batchActions.ts` (only the `approveBatch` wrapper)

**Interfaces:**
- Consumes: `getDefaultCollectionId` (Task 2), `seedCollection` (Task 2).
- Produces (used by Task 8): `approveBatch(prisma, collectionId, batchId)`. `startBatch`, `addCardToBatch`, `pauseBatch`, `continueBatch`, `discardBatch`, `removeFromBatch` are all unchanged — confirmed none of them touches `CollectionEntry`.

- [ ] **Step 1: Write the failing tests**

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
    const batchId = await startBatch(prisma, 60)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.expectedCount).toBe(60)
    expect(batch.name).toMatch(/^Batch \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(batch.lastResumedAt).not.toBeNull()
  })

  it('rejects a non-positive expected count', async () => {
    await expect(startBatch(prisma, 0)).rejects.toThrow('expectedCount must be a positive integer')
  })

  it('rejects starting a second batch while one is already active', async () => {
    await startBatch(prisma, 60)

    await expect(startBatch(prisma, 40)).rejects.toThrow('already active')
  })
})

describe('addCardToBatch', () => {
  it('adds a new card to the batch', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const cards = await prisma.batchCard.findMany({ where: { batchId } })
    expect(cards).toEqual([{ batchId, cardCode: '01001', quantity: 3 }])
  })

  it('accumulates quantity across repeated adds of the same card', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)

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
    const batchId = await startBatch(prisma, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(0)
  })

  it('auto-stops the batch once the expected count is reached', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
    expect(batch.lastResumedAt).toBeNull()
  })

  it('does not auto-stop before the expected count is reached', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)

    await addCardToBatch(prisma, batchId, '01001', 2)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('rejects adding to a batch that is not running', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await pauseBatch(prisma, batchId)

    await expect(addCardToBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "paused"')
  })
})

describe('pauseBatch / continueBatch', () => {
  it('pausing freezes the elapsed time and clears lastResumedAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, 60)

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toBeNull()
    vi.useRealTimers()
  })

  it('continuing resumes from paused without losing the accumulated elapsed time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, 60)
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
    const batchId = await startBatch(prisma, 60)
    await pauseBatch(prisma, batchId)

    await expect(pauseBatch(prisma, batchId)).rejects.toThrow('status "paused"')
  })

  it('rejects continuing a batch that is not paused', async () => {
    const batchId = await startBatch(prisma, 60)

    await expect(continueBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })

  it('rejects continuing a batch that has auto-stopped — stopped is a dead end, no Continue', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)
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
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(0)
  })

  it('archives a stopped batch as discarded', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
  })

  it('rejects discarding a running batch', async () => {
    const batchId = await startBatch(prisma, 60)

    await expect(discardBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })
})

describe('approveBatch', () => {
  it('merges every batch card into the collection and archives the batch as approved', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
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
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, collectionId, batchId)

    expect(await getOwnedQuantity(prisma, collectionId, '01001')).toBe(5)
  })

  it('bumps the collection\'s updatedAt', async () => {
    const { id: collectionId, updatedAt: originalUpdatedAt } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, collectionId, batchId)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })
    expect(collection.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  it('rejects approving a running batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    const batchId = await startBatch(prisma, 60)

    await expect(approveBatch(prisma, collectionId, batchId)).rejects.toThrow('status "running"')
  })
})

describe('removeFromBatch', () => {
  it("reduces a card's quantity by a partial amount, keeping the row", async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await removeFromBatch(prisma, batchId, '01001', 1)

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(2)
  })

  it('deletes the row when removing its full quantity', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await removeFromBatch(prisma, batchId, '01001', 3)

    const card = await prisma.batchCard.findUnique({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card).toBeNull()
  })

  it('rejects removing more than the current quantity', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 2)

    await expect(removeFromBatch(prisma, batchId, '01001', 3)).rejects.toThrow('only 2 in the batch')
  })

  it('rejects on an approved batch', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 1)
    await addCardToBatch(prisma, batchId, '01001', 1)
    await approveBatch(prisma, collectionId, batchId)

    await expect(removeFromBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "approved"')
  })

  it('rejects on a discarded batch', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 1)
    await pauseBatch(prisma, batchId)
    await discardBatch(prisma, batchId)

    await expect(removeFromBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "discarded"')
  })

  it('reverts a stopped batch to paused when the removal drops the count below the target', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)
    let batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await removeFromBatch(prisma, batchId, '01001', 1)

    batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
  })

  it('stays stopped if the remaining count is still at or above the target', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)
    await addCardToBatch(prisma, batchId, '01001', 2)
    await addCardToBatch(prisma, batchId, '01002', 2)
    let batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')

    await removeFromBatch(prisma, batchId, '01002', 1)

    batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
  })

  it('does not change status when removing from a running batch', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await removeFromBatch(prisma, batchId, '01001', 1)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('does not change status when removing from an already-paused batch', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await removeFromBatch(prisma, batchId, '01001', 1)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/actions/batchMutations.test.ts`
Expected: FAIL — `approveBatch` doesn't accept a `collectionId` argument yet.

- [ ] **Step 3: Write the implementation**

In `src/actions/batchMutations.ts`, replace `approveBatch`:

```ts
export async function approveBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({
    where: { id: batchId },
    include: { cards: true },
  })
  if (batch.status !== 'paused' && batch.status !== 'stopped') {
    throw new Error(`Cannot approve a batch with status "${batch.status}"`)
  }

  // Same upsert shape as incrementOwned (src/lib/collection.ts) — inlined
  // so the whole merge is one atomic transaction alongside archiving the
  // batch, rather than N separate increments that could partially apply.
  await prisma.$transaction([
    ...batch.cards.map((batchCard) =>
      prisma.collectionEntry.upsert({
        where: { cardCode: batchCard.cardCode },
        create: { cardCode: batchCard.cardCode, quantityOwned: batchCard.quantity },
        update: { quantityOwned: { increment: batchCard.quantity } },
      })
    ),
    prisma.batch.update({ where: { id: batchId }, data: { status: 'approved' } }),
  ])
}
```

with:

```ts
export async function approveBatch(prisma: PrismaClient, collectionId: number, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({
    where: { id: batchId },
    include: { cards: true },
  })
  if (batch.status !== 'paused' && batch.status !== 'stopped') {
    throw new Error(`Cannot approve a batch with status "${batch.status}"`)
  }

  // Same upsert shape as incrementOwned (src/lib/collection.ts) — inlined
  // so the whole merge is one atomic transaction alongside archiving the
  // batch, rather than N separate increments that could partially apply.
  await prisma.$transaction([
    ...batch.cards.map((batchCard) =>
      prisma.collectionEntry.upsert({
        where: { collectionId_cardCode: { collectionId, cardCode: batchCard.cardCode } },
        create: { collectionId, cardCode: batchCard.cardCode, quantityOwned: batchCard.quantity },
        update: { quantityOwned: { increment: batchCard.quantity } },
      })
    ),
    prisma.batch.update({ where: { id: batchId }, data: { status: 'approved' } }),
    prisma.collection.update({ where: { id: collectionId }, data: {} }),
  ])
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/actions/batchMutations.test.ts`
Expected: PASS (23 tests).

- [ ] **Step 5: Update `batchActions.ts`'s `approveBatch` wrapper**

In `src/actions/batchActions.ts`, add an import:

```ts
import { getDefaultCollectionId } from '@/lib/collections'
```

Then change:

```ts
export async function approveBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    await approveBatchMutation(prisma, batchId)
    revalidatePath('/')
    revalidatePath('/sets/[packCode]', 'page')
    revalidatePath('/builder')
    revalidatePath('/builder/batches')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}
```

to:

```ts
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
```

(No test file exists for `batchActions.ts` — matches this codebase's existing convention.)

- [ ] **Step 6: Commit**

```bash
git add src/actions/batchMutations.ts src/actions/batchMutations.test.ts src/actions/batchActions.ts
git commit -m "Retrofit approveBatch for multi-collection support"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures. This is the first point in the plan where the whole suite is expected to be green — every file that touches `CollectionEntry` has now been retrofitted (Tasks 1-7).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify the real database migrated correctly**

```bash
npx tsx -e "
import { prisma } from './src/lib/db'
async function main() {
  const collections = await prisma.collection.findMany()
  console.log('collections:', collections)
  const entryCount = await prisma.collectionEntry.count()
  console.log('total collectionEntry rows:', entryCount)
  const totalOwned = await prisma.collectionEntry.aggregate({ _sum: { quantityOwned: true } })
  console.log('total quantityOwned:', totalOwned._sum.quantityOwned)
  await prisma.\$disconnect()
}
main()
"
```

Expected: exactly one collection (`name: 'My Collection'`, `isDefault: true`), and the row count / total quantity **exactly match** what Task 1 recorded before the migration ran (check the numbers you noted during Task 1's Step 5/6 verification, or compare against the CSV backup from Task 1's Step 1 if you have it).

- [ ] **Step 4: Manual check against the real app**

Run `npm run dev`, wait for it to serve, then confirm — read-only, do not add/remove/edit any real card quantities beyond what you can immediately revert, and restore anything you change before finishing:
- `/` (Dashboard) loads and shows the same totals it showed before this plan started.
- `/builder` (Simple mode) search still shows correct owned quantities; adding 1 of a card and then immediately using the set page's quantity editor to revert it back confirms writes still land in the same place reads see.
- `/sets/<packCode>` for a set you own cards in shows the same owned/missing breakdown as before.
- `/decks` (if you have an imported deck) still shows correct ownership percentages.
- `/reports/under-owned-cards` still lists the same under-owned cards as before.
- `/api/collection/export` still downloads a CSV matching your real collection.
- Batch mode: starting a tiny batch (e.g. expected count 1), adding a card, and approving it correctly increments that card's owned quantity by exactly 1 (verify via the set page), then that increment is worth reverting (use the set page's quantity editor to set it back down by 1) so this manual check doesn't leave a stray +1 in your real collection.

Stop the dev server when done.

- [ ] **Step 5: Delete the pre-migration backup files once satisfied**

Only after every check above passes:

```bash
ls data/*.pre-collections-backup-* data/collection-backup-pre-migration-*.csv 2>/dev/null
```

If you're confident the migration is correct and want to remove these safety-net files, remove them by hand (outside this plan — they're your call, not an automated cleanup step, since they're your last resort if something is later discovered to be wrong).

- [ ] **Step 6: Commit (only if manual checks required a fix)**

If Steps 1-4 surfaced no issues, there is nothing further to commit — Task 7's commit already completes the working migration.
