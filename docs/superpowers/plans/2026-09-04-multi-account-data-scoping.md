# Multi-Account Data Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every account its own private collections, decks, and preferences (`userId` on `Collection`/`Deck`/`Setting`/`HiddenBuilderPack`, `Batch`/`CollectionEntry` scoped transitively through `Collection`), closing the live gap where any account created via Phase 1's open self-registration can currently read/write the same shared real collection.

**Architecture:** A shared ownership guard (`requireOwnedCollection`, `requireOwnedDeck`) enforced inside the data layer (`src/lib/*.ts`), not just at the Server Action boundary. `userId` is threaded through as the parameter immediately after `prisma`, matching this codebase's existing "explicit id, early parameter" convention. The real, currently-unowned `data/netrunner.db` rows are migrated in a deliberately separate, human-confirmed tail of this plan (sign up for real → claim script → tighten migration) rather than folded into the normal TDD flow, per `CLAUDE.md`'s standing rule on real collection data.

**Tech Stack:** Next.js (App Router) server components/actions, Prisma/SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-multi-account-data-scoping-design.md`

## Global Constraints

- **This eventually touches real, irreplaceable user data**, same standing rule as every plan before it (`CLAUDE.md`'s opening warning). Tasks 1-16 never touch `data/netrunner.db` for anything except adding new, nullable, non-destructive columns (verified by row-count checks) — no existing data is ever modified or deleted until Tasks 18-19, which are explicit, separately-confirmed checkpoints, not something to run unattended.
- **Schema transition pattern, used identically for `Collection`, `Deck`, and `Setting`/`HiddenBuilderPack`:** each gets its `userId` column added as nullable in an early task (safe against existing rows — SQLite allows adding a nullable column to a non-empty table with no risk), applied immediately to the real `data/netrunner.db`. `prisma/schema.prisma` is then updated **in that same task** to the fully-final shape (`userId` required) even though the real database's applied-migration history has only gone as far as "nullable." This is safe because every test in this codebase runs via `createTestDb()` (`src/lib/testDb.ts`), which does `prisma db push` against a **fresh, empty** scratch database built directly from the current `schema.prisma` — it never touches migration history or `data/netrunner.db`, so it always sees the final required-`userId` shape from Task 1 onward with zero transitional friction. The one thing to never do before Task 19: run `prisma migrate dev`, `db push`, or `generate` with `DATABASE_URL` pointed at the real `data/netrunner.db` — that would try to reconcile the (temporarily mismatched) schema against it. Task 19 is what actually reconciles them, once every row has a real `userId`.
- **`Setting`/`HiddenBuilderPack` deviate from the spec's literal `@@id([userId, key])` syntax**, discovered while writing this plan: Prisma requires every field in a composite `@@id` to be non-optional, so a table can't go through the same "nullable now, required later" transition on its primary key the way `Collection.userId` can on a plain column. Both tables instead gain a surrogate `id Int @id @default(autoincrement())` and keep `userId`/`key` (or `packCode`) as a `@@unique([userId, key])` pair instead of the PK itself — `@@unique` *does* allow a nullable component field in Prisma, so these two tables can use the exact same nullable-then-tighten transition as `Collection`/`Deck`. This preserves the spec's actual intent (one row per account per key, enforced uniquely) with syntax that supports the transition.
- **This plan cannot keep the whole test suite green after every task**, same exception the multi-collection Phase 1 plan already used for the same reason: `userId` becomes a required parameter on functions many files call, and retrofitting every caller in one unreviewable task would defeat task-by-task review. Instead: Tasks 1-9 (schema + data layer) each verify only their own test file(s) (`npx vitest run <file>`) — not the whole suite, since callers elsewhere haven't been updated yet. Tasks 10-15 (wiring callers) restore compilation file-by-file. Only Task 16 (last of the "normal" tasks) requires and verifies a fully clean `npm test && npx tsc --noEmit`.
- The ownership guards throw a plain `Error` with a generic message (`"Collection not found"` / `"Deck not found"`) for both "doesn't exist" and "exists but belongs to someone else" — no distinguishable signal, so a client probing IDs can't tell which case they hit. Server Actions already catch and surface `err.message` today; this reads exactly like any other not-found error.
- Compound-key Prisma inputs use the `field1_field2` naming Prisma derives from `@@unique([field1, field2])`/`@@id([field1, field2])` (e.g. `userId_key`, `userId_netrunnerdbId`) — matching this schema's existing convention, already proven correct for `collectionId_cardCode` and `batchId_cardCode`.

---

### Task 1: `Collection` gains `userId`, fixture updates, `requireOwnedCollection`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: a new migration under `prisma/migrations/`
- Modify: `src/lib/testFixtures.ts`
- Modify: `src/lib/collections.ts`
- Modify: `src/lib/collections.test.ts`

**Interfaces:**
- Produces (used by every later task): `Collection.userId Int` (required, in `schema.prisma`; nullable on the real DB until Task 19), `seedUser(prisma, options?): Promise<{ id: number; email: string }>`, `seedCollection(prisma, userId, options?)`, `requireOwnedCollection(prisma: PrismaClient, userId: number, collectionId: number): Promise<CollectionSummary>`.

- [ ] **Step 1: Add the nullable column to the schema and generate the migration**

In `prisma/schema.prisma`, add to the `Collection` model (right after `id`):

```prisma
  userId    Int?
  user      User?             @relation(fields: [userId], references: [id], onDelete: Cascade)
```

And add `collections Collection[]` to the `User` model.

Run: `npx prisma migrate dev --name add_user_id_to_collection`

Expected: Prisma generates and applies a migration adding a nullable `userId` column (plus an index) to `Collection` in `data/netrunner.db` — no prompts, since a nullable column never needs a default for existing rows.

- [ ] **Step 2: Verify against the real database**

```bash
npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const total = await prisma.collection.count()
  const nullUserId = await prisma.collection.count({ where: { userId: null } })
  console.log('total collections:', total, '— null userId:', nullUserId)
  await prisma.\$disconnect()
}
main()
"
```

Expected: `total` matches whatever `data/netrunner.db` had before this task (2, per this project's current real data), and `nullUserId` equals `total` — nothing has an owner yet.

- [ ] **Step 3: Flip `schema.prisma` to its final, required shape**

Change the two lines added in Step 1 to:

```prisma
  userId    Int
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
```

Run: `npx prisma generate`

Do **not** run `migrate dev` or `db push` again — this edit is deliberately not reflected in a new migration yet (see Global Constraints). `npx prisma validate` should still report the schema as valid; the mismatch against the real database's applied-migration history is expected and resolved in Task 19.

- [ ] **Step 4: Add `seedUser` and update `seedCollection` in the shared test fixtures**

In `src/lib/testFixtures.ts`, add:

```ts
let userCounter = 0

export async function seedUser(prisma: PrismaClient, options: { email?: string } = {}) {
  userCounter += 1
  return prisma.user.create({
    data: {
      email: options.email ?? `test-user-${userCounter}@example.com`,
      passwordHash: 'not-a-real-hash',
    },
  })
}
```

Change `seedCollection`'s signature to take `userId` as an explicit early parameter, matching this codebase's convention:

```ts
export async function seedCollection(prisma: PrismaClient, userId: number, options: SeedCollectionOptions = {}) {
  return prisma.collection.create({
    data: {
      userId,
      name: options.name ?? 'Test Collection',
      isDefault: options.isDefault ?? true,
    },
  })
}
```

- [ ] **Step 5: Write the failing tests for `requireOwnedCollection`**

In `src/lib/collections.test.ts`, update the `seedUser`/`seedCollection` import and add:

```ts
import { seedCard, seedCollection, seedUser } from './testFixtures'
```

```ts
import { requireOwnedCollection } from './collections'
```

```ts
describe('requireOwnedCollection', () => {
  it('returns the collection when it belongs to the given user', async () => {
    const user = await seedUser(prisma)
    const collection = await seedCollection(prisma, user.id)

    const result = await requireOwnedCollection(prisma, user.id, collection.id)

    expect(result.id).toBe(collection.id)
  })

  it('throws when the collection belongs to a different user', async () => {
    const owner = await seedUser(prisma, { email: 'owner@example.com' })
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const collection = await seedCollection(prisma, owner.id)

    await expect(requireOwnedCollection(prisma, stranger.id, collection.id)).rejects.toThrow('Collection not found')
  })

  it('throws the identical message when the collection does not exist at all', async () => {
    const user = await seedUser(prisma)

    await expect(requireOwnedCollection(prisma, user.id, 999999)).rejects.toThrow('Collection not found')
  })
})
```

Since every other existing test in this file calls `seedCollection(prisma, { ... })` (old two-arg shape), update every one of those call sites too: each becomes `seedCollection(prisma, (await seedUser(prisma)).id, { ... })`, or — where a test already needs a named `user` variable for other assertions — `seedCollection(prisma, user.id, { ... })`. This is mechanical; there is no behavior change to any existing test, just the new required argument.

- [ ] **Step 6: Run to verify the new tests fail**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: FAIL — `requireOwnedCollection` is not exported, and every `seedCollection` call site is missing an argument (TypeScript error surfaces as a test-run failure).

- [ ] **Step 7: Implement `requireOwnedCollection`**

In `src/lib/collections.ts`, add (near `getCollection`, which it supersedes for ownership-checked lookups):

```ts
export async function requireOwnedCollection(
  prisma: PrismaClient,
  userId: number,
  collectionId: number
): Promise<CollectionSummary> {
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId } })
  if (!collection) {
    throw new Error('Collection not found')
  }
  return toSummary(collection)
}
```

- [ ] **Step 8: Run to verify the tests pass**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: PASS. (The rest of `collections.ts`'s exports still take no `userId` yet — that's Task 4. Do not touch them here.)

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/testFixtures.ts src/lib/collections.ts src/lib/collections.test.ts
git commit -m "Add nullable Collection.userId, requireOwnedCollection guard, seedUser fixture"
```

---

### Task 2: `Deck` primary-key reshape + `userId`, `requireOwnedDeck`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: a new migration under `prisma/migrations/`
- Modify: `src/lib/decks.ts`
- Modify: `src/lib/decks.test.ts`

**Interfaces:**
- Produces: `Deck.id` (internal autoincrement, was previously NetrunnerDB's decklist id directly), `Deck.netrunnerdbId Int` (holds the original external id), `Deck.userId Int` (required in `schema.prisma`; nullable on the real DB until Task 19), `requireOwnedDeck(prisma: PrismaClient, userId: number, deckId: number): Promise<void>`.
- Consumes: `seedUser` (Task 1).

- [ ] **Step 1: Update the schema**

Replace the `Deck` model in `prisma/schema.prisma`:

```prisma
model Deck {
  /// Internal, autoincrement — was NetrunnerDB's decklist id directly
  /// before multi-account data scoping. Two different accounts can now
  /// each hold their own row for the same public decklist.
  id            Int        @id @default(autoincrement())
  /// The original NetrunnerDB decklist id — still used for the outbound
  /// netrunnerdb.com/en/decklist/<id> link and to detect a re-import by
  /// the same account.
  netrunnerdbId Int
  userId        Int?
  user          User?      @relation(fields: [userId], references: [id], onDelete: Cascade)
  uuid          String
  name          String
  importedAt    DateTime   @default(now())
  dateCreation  DateTime?
  sortOrder     Int        @default(0)
  cards         DeckCard[]

  @@unique([userId, netrunnerdbId])
}
```

(`userId` starts nullable here for the same real-DB-safety reason as `Collection` — flipped to required in Step 3 below. `@@unique` — unlike `@@id` — allows a nullable component, so this compiles.)

Add `decks Deck[]` to the `User` model.

- [ ] **Step 2: Generate and hand-edit the migration**

Run: `npx prisma migrate dev --create-only --name reshape_deck_primary_key`

This is a primary-key-affecting change, so Prisma generates a SQLite table-recreation for `Deck` (and, since `DeckCard.deckId` references it, `DeckCard` too) — matching the same `PRAGMA foreign_keys=OFF` / `CREATE TABLE "new_X"` / copy / `DROP` / `RENAME` / `PRAGMA foreign_keys=ON` shape already used in this repo's `20260820120500_replace_batch_card_created_at_with_sort_index` migration. Prisma has no way to know that `netrunnerdbId` should be backfilled from the *old* `id` column, or that `DeckCard.deckId` needs remapping to the *new* `id` values — hand-edit the generated `migration.sql` to this overall shape (adjust exact generated constraint names if they differ):

```sql
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Deck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "netrunnerdbId" INTEGER NOT NULL,
    "userId" INTEGER,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateCreation" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Deck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Deck" ("id", "netrunnerdbId", "userId", "uuid", "name", "importedAt", "dateCreation", "sortOrder")
SELECT "id", "id", NULL, "uuid", "name", "importedAt", "dateCreation", "sortOrder" FROM "Deck";
DROP TABLE "Deck";
ALTER TABLE "new_Deck" RENAME TO "Deck";
CREATE UNIQUE INDEX "Deck_userId_netrunnerdbId_key" ON "Deck"("userId", "netrunnerdbId");

CREATE TABLE "new_DeckCard" (
    "deckId" INTEGER NOT NULL,
    "cardCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    PRIMARY KEY ("deckId", "cardCode"),
    CONSTRAINT "DeckCard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DeckCard_cardCode_fkey" FOREIGN KEY ("cardCode") REFERENCES "Card" ("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DeckCard" ("deckId", "cardCode", "quantity")
SELECT "deckId", "cardCode", "quantity" FROM "DeckCard";
DROP TABLE "DeckCard";
ALTER TABLE "new_DeckCard" RENAME TO "DeckCard";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
```

The key line to get right: `SELECT "id", "id", NULL, ...` — the *old* `id` column populates both the *new* `id` (SQLite reuses the same rowid values here since nothing renumbers them) and the new `netrunnerdbId` column identically, since before this migration they were the same value. `DeckCard` is rebuilt last, referencing the already-renamed `Deck` table, but since `deckId` values are untouched (old `id` values equal new `id` values), no remapping subquery is actually needed — it's a straight copy.

- [ ] **Step 3: Dry-run against a copy of the real database, then apply**

```bash
mkdir -p /tmp/deck-migration-dryrun
cp data/netrunner.db /tmp/deck-migration-dryrun/test.db
DATABASE_URL="file:/tmp/deck-migration-dryrun/test.db" npx prisma migrate deploy
DATABASE_URL="file:/tmp/deck-migration-dryrun/test.db" npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const decks = await prisma.deck.findMany({ select: { id: true, netrunnerdbId: true, userId: true } })
  console.log('decks:', decks)
  const deckCardCount = await prisma.deckCard.count()
  console.log('deckCard count:', deckCardCount)
  await prisma.\$disconnect()
}
main()
"
rm -rf /tmp/deck-migration-dryrun
```

Expected: every deck's `id` equals its `netrunnerdbId`, every `userId` is `null`, and `deckCard count` matches what `data/netrunner.db` had before this task. **If anything looks wrong, stop — do not proceed.**

Then apply for real: `npx prisma migrate deploy`, and re-run the same verification query (without the `DATABASE_URL` override) against the real `data/netrunner.db`. Same expected results.

- [ ] **Step 4: Flip `userId` to required in `schema.prisma`**

```prisma
  userId        Int
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)
```

Run: `npx prisma generate`. Same deliberate mismatch-with-real-DB note as Task 1 Step 3 applies here.

- [ ] **Step 5: Write the failing tests for `requireOwnedDeck`**

In `src/lib/decks.test.ts`, find how decks are currently seeded (likely direct `prisma.deck.create(...)` calls) and add a `userId: user.id, netrunnerdbId: <same value as id>` to each — the exact call sites depend on this file's current fixtures; update every one so the file compiles. Add:

```ts
import { seedUser } from './testFixtures'
import { requireOwnedDeck } from './decks'
```

```ts
describe('requireOwnedDeck', () => {
  it('resolves without throwing when the deck belongs to the given user', async () => {
    const user = await seedUser(prisma)
    const deck = await prisma.deck.create({
      data: { netrunnerdbId: 1001, userId: user.id, uuid: 'uuid-1', name: 'Test Deck' },
    })

    await expect(requireOwnedDeck(prisma, user.id, deck.id)).resolves.toBeUndefined()
  })

  it('throws when the deck belongs to a different user', async () => {
    const owner = await seedUser(prisma, { email: 'owner@example.com' })
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const deck = await prisma.deck.create({
      data: { netrunnerdbId: 1001, userId: owner.id, uuid: 'uuid-1', name: 'Test Deck' },
    })

    await expect(requireOwnedDeck(prisma, stranger.id, deck.id)).rejects.toThrow('Deck not found')
  })

  it('throws the identical message when the deck does not exist at all', async () => {
    const user = await seedUser(prisma)

    await expect(requireOwnedDeck(prisma, user.id, 999999)).rejects.toThrow('Deck not found')
  })
})
```

- [ ] **Step 6: Run to verify the new tests fail**

Run: `npx vitest run src/lib/decks.test.ts`
Expected: FAIL — `requireOwnedDeck` not exported, plus any now-missing `userId`/`netrunnerdbId` on existing fixture `deck.create` calls.

- [ ] **Step 7: Implement `requireOwnedDeck`, and add `netrunnerdbId`/`userId` to `DeckSummary`**

In `src/lib/decks.ts`, add:

```ts
export async function requireOwnedDeck(prisma: PrismaClient, userId: number, deckId: number): Promise<void> {
  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId } })
  if (!deck) {
    throw new Error('Deck not found')
  }
}
```

Add `netrunnerdbId: number` to the `DeckSummary` interface, and in `computeDeckSummary`'s return object, add `netrunnerdbId: deck.netrunnerdbId,` alongside the existing `id: deck.id,`. (This is a pure additive field — nothing consumes it yet; Task 15 wires `src/app/decks/[id]/page.tsx`'s outbound NetrunnerDB link to use it instead of `deck.id`.)

- [ ] **Step 8: Run to verify the tests pass**

Run: `npx vitest run src/lib/decks.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/decks.ts src/lib/decks.test.ts
git commit -m "Reshape Deck's primary key off NetrunnerDB's id, add nullable userId, requireOwnedDeck guard"
```

---

### Task 3: `Setting`/`HiddenBuilderPack` gain `userId`, and a `SyncCheckpoint` table for the one global key that isn't a user preference

**Files:**
- Modify: `prisma/schema.prisma`
- Create: a new migration under `prisma/migrations/`

**Interfaces:**
- Produces: `Setting.userId Int` (required in `schema.prisma`), `Setting.id` (new surrogate PK), `HiddenBuilderPack.userId Int` (required in `schema.prisma`), `HiddenBuilderPack.id` (new surrogate PK), `SyncCheckpoint` (new model). No guard function needed — Task 9 threads `userId` directly into every `settingsMutations.ts` query, since these tables are never looked up by a bare client-supplied id the way `Collection`/`Deck` are.

**Found while cross-checking every caller of `getSetting`/`setSetting` for this plan's self-review:** `src/lib/tournamentDeckSync.ts` also reads/writes `Setting` directly, for `SYNC_CHECKPOINT_KEY` (`'tournamentDecksSyncedThrough'`) — the `npm run sync-decks` background job's resume checkpoint. That's genuinely global process state (there's one crawl, shared by the whole instance, run from a CLI script with no logged-in user at all), not a per-account preference — it would be wrong to force it through the now-per-user `Setting` table alongside `builderMode`/`navStyle`. It gets its own tiny table instead of overloading `Setting` with a permanently-nullable `userId` (which would also be a real correctness risk: a `@@unique([userId, key])` constraint with `userId: null` can't reliably `upsert` in SQLite, since SQL treats every `NULL` as distinct from every other `NULL` for uniqueness purposes — repeated "upserts" against a null `userId` would just keep inserting new rows instead of updating one).

- [ ] **Step 1: Update the schema**

Replace both models, and add a new one:

```prisma
model Setting {
  id     Int    @id @default(autoincrement())
  userId Int?
  user   User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  key    String
  value  String

  @@unique([userId, key])
}

model HiddenBuilderPack {
  id       Int    @id @default(autoincrement())
  userId   Int?
  user     User?  @relation(fields: [userId], references: [id], onDelete: Cascade)
  packCode String
  pack     Pack   @relation(fields: [packCode], references: [code])

  @@unique([userId, packCode])
}

/// Global (instance-wide, not per-account) process state — currently
/// only the npm run sync-decks background job's resume checkpoint. Kept
/// separate from Setting specifically because it has no owning user.
model SyncCheckpoint {
  key   String @id
  value String
}
```

Add `settings Setting[]` and `hiddenBuilderPacks HiddenBuilderPack[]` to the `User` model.

- [ ] **Step 2: Generate, apply, and verify**

Run: `npx prisma migrate dev --name add_user_id_to_settings`

This is also a PK-affecting change (both tables move off a natural-key PK to a surrogate `id`), so Prisma again generates a table-recreation for `Setting`/`HiddenBuilderPack`, plus a plain `CREATE TABLE` for the new `SyncCheckpoint`. Unlike Task 2, there's nothing to backfill by hand for `Setting`/`HiddenBuilderPack` — every existing row's `userId` is simply `NULL`, and Prisma can generate this migration correctly without hand-editing (no cross-referencing subquery needed). Inspect the generated SQL to confirm it copies `key`/`value` (and `packCode`) straight across with `userId` left `NULL` and a fresh auto-incrementing `id`; if so, apply directly — no dry-run copy needed for a migration this simple (nothing computed, nothing to get wrong).

Verify:

```bash
npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  console.log('settings:', await prisma.setting.findMany())
  console.log('hiddenBuilderPacks:', await prisma.hiddenBuilderPack.findMany())
  console.log('syncCheckpoints:', await prisma.syncCheckpoint.findMany())
  await prisma.\$disconnect()
}
main()
"
```

Expected: same `key`/`value`/`packCode` values as before this task, all with `userId: null`, and `syncCheckpoints` is empty (nothing copied into it yet — that's the next step).

- [ ] **Step 3: Move the existing sync checkpoint row out of `Setting`, if one exists**

This is fully deterministic (no external dependency — unlike `userId`, there's no need to wait for anyone to sign up), so it happens now rather than at the end with the rest of the real-data migration:

```bash
npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const existing = await prisma.setting.findFirst({ where: { key: 'tournamentDecksSyncedThrough' } })
  if (existing) {
    await prisma.syncCheckpoint.create({ data: { key: existing.key, value: existing.value } })
    await prisma.setting.delete({ where: { id: existing.id } })
    console.log('Moved checkpoint:', existing.value)
  } else {
    console.log('No existing checkpoint row — nothing to move (sync-decks has never been run against this database).')
  }
  await prisma.\$disconnect()
}
main()
"
```

- [ ] **Step 4: Flip `userId` to required in `schema.prisma`**

```prisma
  userId Int
  user   User  @relation(fields: [userId], references: [id], onDelete: Cascade)
```

on both `Setting` and `HiddenBuilderPack` (not `SyncCheckpoint`, which has no `userId` at all). Run `npx prisma generate`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add nullable userId to Setting and HiddenBuilderPack, surrogate PKs, split out SyncCheckpoint"
```

(No test changes in this task — `settingsMutations.test.ts` still calls the old, un-threaded functions; it starts failing to compile here and gets fixed in Task 9, per this plan's Global Constraint about not keeping every file green mid-flight.)

---

### Task 4: Thread `userId` through `src/lib/collections.ts`

**Files:**
- Modify: `src/lib/collections.ts`
- Modify: `src/lib/collections.test.ts`

**Interfaces:**
- Produces: `getDefaultCollection(prisma, userId)`, `getDefaultCollectionId(prisma, userId)` (now creates an empty default collection if the user has none, instead of throwing), `getCollection(prisma, userId, collectionId)`, `listCollections(prisma, userId)`, `listCollectionsWithStats(prisma, userId)`, `createCollection(prisma, userId, name)`, `renameCollection(prisma, userId, collectionId, name)`, `deleteCollection(prisma, userId, collectionId)`, `setDefaultCollection(prisma, userId, collectionId)`, `reorderCollections(prisma, userId, orderedIds)`, `importCsvAsBatch(prisma, userId, collectionId, csvText)`.
- Consumes: `requireOwnedCollection` (Task 1), `seedUser`/`seedCollection` (Task 1).

- [ ] **Step 1: Update every test in `collections.test.ts` for the new signatures**

Every call in this file to one of the functions listed above gains `user.id` (or an inline `(await seedUser(prisma)).id` where the test doesn't already have a `user`) as the parameter right after `prisma`. Add new cases:

```ts
describe('getDefaultCollectionId', () => {
  // ...existing tests, updated to pass user.id...

  it('auto-creates an empty default collection when the user has none', async () => {
    const user = await seedUser(prisma)

    const id = await getDefaultCollectionId(prisma, user.id)

    const collection = await prisma.collection.findUniqueOrThrow({ where: { id } })
    expect(collection.userId).toBe(user.id)
    expect(collection.isDefault).toBe(true)
    expect(collection.name).toBe('My Collection')
  })

  it('does not create a second default collection on a repeat call', async () => {
    const user = await seedUser(prisma)
    const firstId = await getDefaultCollectionId(prisma, user.id)

    const secondId = await getDefaultCollectionId(prisma, user.id)

    expect(secondId).toBe(firstId)
    expect(await prisma.collection.count({ where: { userId: user.id } })).toBe(1)
  })
})

describe('cross-account isolation', () => {
  it('listCollections only returns the given user\'s own collections', async () => {
    const alice = await seedUser(prisma, { email: 'alice@example.com' })
    const bob = await seedUser(prisma, { email: 'bob@example.com' })
    await seedCollection(prisma, alice.id, { name: "Alice's" })
    await seedCollection(prisma, bob.id, { name: "Bob's" })

    const result = await listCollections(prisma, alice.id)

    expect(result.map((c) => c.name)).toEqual(["Alice's"])
  })

  it('renameCollection throws when the collection belongs to another user', async () => {
    const owner = await seedUser(prisma, { email: 'owner@example.com' })
    const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
    const collection = await seedCollection(prisma, owner.id)

    await expect(renameCollection(prisma, stranger.id, collection.id, 'Hijacked')).rejects.toThrow(
      'Collection not found'
    )
  })

  it('setDefaultCollection does not touch another user\'s isDefault flag', async () => {
    const alice = await seedUser(prisma, { email: 'alice@example.com' })
    const bob = await seedUser(prisma, { email: 'bob@example.com' })
    const aliceCollection = await seedCollection(prisma, alice.id, { isDefault: true })
    const bobCollection = await seedCollection(prisma, bob.id, { isDefault: true })
    const aliceSecond = await seedCollection(prisma, alice.id, { isDefault: false })

    await setDefaultCollection(prisma, alice.id, aliceSecond.id)

    expect((await prisma.collection.findUniqueOrThrow({ where: { id: bobCollection.id } })).isDefault).toBe(true)
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: aliceCollection.id } })).isDefault).toBe(false)
    expect((await prisma.collection.findUniqueOrThrow({ where: { id: aliceSecond.id } })).isDefault).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: FAIL — every listed function is still missing the `userId` parameter.

- [ ] **Step 3: Implement the signature changes**

Rewrite the relevant parts of `src/lib/collections.ts`:

```ts
export async function getDefaultCollection(prisma: PrismaClient, userId: number): Promise<CollectionSummary> {
  const collection = await prisma.collection.findFirst({ where: { userId, isDefault: true } })
  if (collection) {
    return toSummary(collection)
  }
  const created = await prisma.collection.create({
    data: { userId, name: 'My Collection', isDefault: true, sortOrder: 0 },
  })
  return toSummary(created)
}

export async function getDefaultCollectionId(prisma: PrismaClient, userId: number): Promise<number> {
  const collection = await getDefaultCollection(prisma, userId)
  return collection.id
}

export async function getCollection(
  prisma: PrismaClient,
  userId: number,
  collectionId: number
): Promise<CollectionSummary | null> {
  const collection = await prisma.collection.findFirst({ where: { id: collectionId, userId } })
  return collection ? toSummary(collection) : null
}

export async function listCollections(prisma: PrismaClient, userId: number): Promise<CollectionSummary[]> {
  const collections = await prisma.collection.findMany({
    where: { userId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return collections.map(toSummary)
}

export async function listCollectionsWithStats(prisma: PrismaClient, userId: number): Promise<CollectionListEntry[]> {
  const collections = await listCollections(prisma, userId)
  return Promise.all(
    collections.map(async (collection) => {
      const [totals, activeBatch] = await Promise.all([
        computeCollectionTotals(prisma, collection.id),
        getActiveBatch(prisma, collection.id),
      ])
      const pendingBatch = activeBatch?.status === 'running' ? null : activeBatch
      return { ...collection, ...totals, pendingBatch }
    })
  )
}

export async function createCollection(prisma: PrismaClient, userId: number, name: string): Promise<number> {
  const maxSortOrder = await prisma.collection.aggregate({ where: { userId }, _max: { sortOrder: true } })
  const collection = await prisma.collection.create({
    data: { userId, name: validateName(name), isDefault: false, sortOrder: (maxSortOrder._max.sortOrder ?? 0) + 1 },
  })
  return collection.id
}

export async function renameCollection(
  prisma: PrismaClient,
  userId: number,
  collectionId: number,
  name: string
): Promise<void> {
  await requireOwnedCollection(prisma, userId, collectionId)
  await prisma.collection.update({ where: { id: collectionId }, data: { name: validateName(name) } })
}

export async function deleteCollection(prisma: PrismaClient, userId: number, collectionId: number): Promise<void> {
  const collection = await requireOwnedCollection(prisma, userId, collectionId)
  if (collection.isDefault) {
    throw new Error('Cannot delete the default collection')
  }
  await prisma.collection.delete({ where: { id: collectionId } })
}

export async function setDefaultCollection(prisma: PrismaClient, userId: number, collectionId: number): Promise<void> {
  await requireOwnedCollection(prisma, userId, collectionId)
  await prisma.$transaction([
    prisma.collection.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } }),
    prisma.collection.update({ where: { id: collectionId }, data: { isDefault: true } }),
  ])
}

export async function reorderCollections(prisma: PrismaClient, userId: number, orderedIds: number[]): Promise<void> {
  for (const id of orderedIds) {
    await requireOwnedCollection(prisma, userId, id)
  }
  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.collection.update({ where: { id }, data: { sortOrder: index } }))
  )
}
```

And, at the top of `importCsvAsBatch`, add `userId: number` as the parameter after `prisma` and a `await requireOwnedCollection(prisma, userId, collectionId)` as its first line (the rest of the function body is unchanged — it already only acts on the validated `collectionId`).

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collections.ts src/lib/collections.test.ts
git commit -m "Thread userId through src/lib/collections.ts"
```

(This breaks compilation of every caller of these functions — expected per Global Constraints, fixed starting Task 10.)

---

### Task 5: Thread `userId` through `src/lib/collection.ts`

**Files:**
- Modify: `src/lib/collection.ts`
- Modify: `src/lib/collection.test.ts`

**Interfaces:**
- Produces: `incrementOwned(prisma, userId, collectionId, cardCode, amount)`, `setOwned(prisma, userId, collectionId, cardCode, quantity)`, `getOwnedQuantity(prisma, userId, collectionId, cardCode)`, `exportCollectionCsv(prisma, userId, collectionId)`.
- Consumes: `requireOwnedCollection` (Task 1).

- [ ] **Step 1: Update every test call site in `collection.test.ts`**

Add `import { requireOwnedCollection } from './collections'` is not needed directly in the test file, but every existing `incrementOwned(prisma, collectionId, ...)`-shaped call becomes `incrementOwned(prisma, user.id, collectionId, ...)` (seeding a `user` via `seedUser` wherever the file doesn't already have one — check this file's current fixture setup for the exact pattern). Add:

```ts
it('incrementOwned throws when the collection belongs to another user', async () => {
  const owner = await seedUser(prisma, { email: 'owner@example.com' })
  const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
  const collection = await seedCollection(prisma, owner.id)
  await seedCard(prisma, { code: '01001', title: 'Test Card', packCode: 'core' })

  await expect(incrementOwned(prisma, stranger.id, collection.id, '01001', 1)).rejects.toThrow('Collection not found')
})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/lib/collection.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export async function incrementOwned(
  prisma: PrismaClient,
  userId: number,
  collectionId: number,
  cardCode: string,
  amount: number
): Promise<number> {
  await requireOwnedCollection(prisma, userId, collectionId)
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }
  const [entry] = await prisma.$transaction([
    prisma.collectionEntry.upsert({
      where: { collectionId_cardCode: { collectionId, cardCode } },
      create: { collectionId, cardCode, quantityOwned: amount },
      update: { quantityOwned: { increment: amount } },
    }),
    touchCollection(prisma, collectionId),
  ])
  return entry.quantityOwned
}
```

Apply the identical `userId` parameter + `await requireOwnedCollection(prisma, userId, collectionId)` first line to `setOwned`, `getOwnedQuantity`, and `exportCollectionCsv`, keeping the rest of each function body unchanged. Add `import { requireOwnedCollection } from './collections'` at the top (replacing/joining the existing `touchCollection` import from the same module).

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/collection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collection.ts src/lib/collection.test.ts
git commit -m "Thread userId through src/lib/collection.ts"
```

---

### Task 6: Thread `userId` through `src/lib/quickSet.ts`

**Files:**
- Modify: `src/lib/quickSet.ts`
- Modify: `src/lib/quickSet.test.ts`

**Interfaces:**
- Produces: `quickAddSet(prisma, userId, collectionId, packCode)`, `clearSet(prisma, userId, collectionId, packCode)`, `undoQuickSetChange(prisma, userId, collectionId, changes)`.
- Consumes: `requireOwnedCollection` (Task 1).

- [ ] **Step 1: Update every test call site, add a cross-account test**

Same mechanical update as Task 5 — every call gains `user.id` after `prisma`. Add:

```ts
it('quickAddSet throws when the collection belongs to another user', async () => {
  const owner = await seedUser(prisma, { email: 'owner@example.com' })
  const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
  const collection = await seedCollection(prisma, owner.id)
  await seedCard(prisma, { code: '01001', title: 'Test Card', packCode: 'core' })

  await expect(quickAddSet(prisma, stranger.id, collection.id, 'core')).rejects.toThrow('Collection not found')
})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/lib/quickSet.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `import { requireOwnedCollection } from './collections'` (joining the existing `touchCollection` import). Give `quickAddSet`, `clearSet`, and `undoQuickSetChange` each a `userId: number` parameter right after `prisma`, with `await requireOwnedCollection(prisma, userId, collectionId)` as their first line — `applyChanges` (the shared private helper) is unchanged, since it's only ever called internally after that check has already run.

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/lib/quickSet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quickSet.ts src/lib/quickSet.test.ts
git commit -m "Thread userId through src/lib/quickSet.ts"
```

---

### Task 7: Thread `userId` through batches (`src/lib/batches.ts` + `src/actions/batchMutations.ts`)

**Files:**
- Modify: `src/lib/batches.ts`
- Modify: `src/lib/batches.test.ts`
- Modify: `src/actions/batchMutations.ts`
- Modify: `src/actions/batchMutations.test.ts`

**Interfaces:**
- Produces: `getActiveBatch(prisma, userId, collectionId)`, `listArchivedBatches(prisma, userId, collectionId?)`, `startBatch(prisma, userId, collectionId, expectedCount)`, `addCardToBatch(prisma, userId, batchId, cardCode, amount)`, `pauseBatch(prisma, userId, batchId)`, `continueBatch(prisma, userId, batchId)`, `discardBatch(prisma, userId, batchId)`, `approveBatch(prisma, userId, collectionId, batchId)`, `revertApprovedBatch(prisma, userId, collectionId, batchId)`, `removeFromBatch(prisma, userId, collectionId, batchId, cardCode, amount)`.
- Consumes: `requireOwnedCollection` (Task 1).

- [ ] **Step 1: Update every test call site in both test files, add cross-account tests**

Same mechanical update as prior tasks. In `batchMutations.test.ts`, add (this is the gap found while writing the design spec — `pauseBatch`/`continueBatch`/`discardBatch` previously took only `batchId` with no ownership check at all possible):

```ts
it('pauseBatch throws when the batch\'s collection belongs to another user', async () => {
  const owner = await seedUser(prisma, { email: 'owner@example.com' })
  const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
  const collection = await seedCollection(prisma, owner.id)
  const batchId = await startBatch(prisma, owner.id, collection.id, 1)

  await expect(pauseBatch(prisma, stranger.id, batchId)).rejects.toThrow('Collection not found')
})

it('addCardToBatch throws when the batch\'s collection belongs to another user', async () => {
  const owner = await seedUser(prisma, { email: 'owner@example.com' })
  const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
  const collection = await seedCollection(prisma, owner.id)
  await seedCard(prisma, { code: '01001', title: 'Test Card', packCode: 'core' })
  const batchId = await startBatch(prisma, owner.id, collection.id, 1)

  await expect(addCardToBatch(prisma, stranger.id, batchId, '01001', 1)).rejects.toThrow('Collection not found')
})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/lib/batches.test.ts src/actions/batchMutations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/batches.ts`**

Give `getActiveBatch` and `listArchivedBatches` a `userId: number` parameter right after `prisma`. `getActiveBatch` (which always receives a concrete `collectionId`) calls `await requireOwnedCollection(prisma, userId, collectionId)` first. `listArchivedBatches`'s optional-`collectionId` mode needs a different shape, since "no collectionId" means "across every collection *this user* owns", not literally every collection in the database:

```ts
export async function listArchivedBatches(
  prisma: PrismaClient,
  userId: number,
  collectionId?: number
): Promise<BatchSummary[]> {
  if (collectionId !== undefined) {
    await requireOwnedCollection(prisma, userId, collectionId)
  }
  const batches = await prisma.batch.findMany({
    where: {
      collection: { userId },
      ...(collectionId !== undefined ? { collectionId } : {}),
      status: { in: ['approved', 'discarded'] },
    },
    include: BATCH_CARDS_INCLUDE,
    orderBy: { startedAt: 'desc' },
  })
  return batches.map(toSummary)
}
```

Add `import { requireOwnedCollection } from './collections'`.

- [ ] **Step 4: Implement `src/actions/batchMutations.ts`**

`startBatch`, `approveBatch`, `revertApprovedBatch`, `removeFromBatch` already take an explicit `collectionId` — give each a `userId: number` parameter right after `prisma`, with `await requireOwnedCollection(prisma, userId, collectionId)` as their first line (before their existing body).

`addCardToBatch`, `pauseBatch`, `continueBatch`, `discardBatch` currently take only `batchId` — they don't have a `collectionId` to check yet at the point they're called, so derive it from the batch itself once loaded, then check that. For `pauseBatch`:

```ts
export async function pauseBatch(prisma: PrismaClient, userId: number, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  await requireOwnedCollection(prisma, userId, batch.collectionId)
  if (batch.status !== 'running') {
    throw new Error(`Cannot pause a batch with status "${batch.status}"`)
  }
  await freeze(prisma, batchId, batch.lastResumedAt!, 'paused')
}
```

Apply the identical shape (add `userId`, load the batch, `requireOwnedCollection(prisma, userId, batch.collectionId)` immediately after the load, keep the existing status check and body after that) to `continueBatch` and `discardBatch`.

For `addCardToBatch`, the batch is already loaded as its first statement (`const batch = await prisma.batch.findUniqueOrThrow(...)`) — add `userId: number` as the parameter right after `prisma`, and insert `await requireOwnedCollection(prisma, userId, batch.collectionId)` immediately after that existing load, before the `if (batch.status !== 'running')` check.

Add `import { requireOwnedCollection } from '@/lib/collections'`.

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx vitest run src/lib/batches.test.ts src/actions/batchMutations.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/batches.ts src/lib/batches.test.ts src/actions/batchMutations.ts src/actions/batchMutations.test.ts
git commit -m "Thread userId through batch lib/mutations, close the pause/continue/discard ownership gap"
```

---

### Task 8: Thread `userId` through decks (`src/lib/decks.ts` + `src/actions/deckMutations.ts`)

**Files:**
- Modify: `src/lib/decks.ts`
- Modify: `src/lib/decks.test.ts`
- Modify: `src/actions/deckMutations.ts`
- Modify: `src/actions/deckMutations.test.ts`

**Interfaces:**
- Produces: `getDecksWithOwnership(prisma, userId, collectionId)`, `getDeckWithOwnership(prisma, userId, collectionId, id)`, `exportDeckCsv(prisma, userId, collectionId, id)`, `saveDeck(prisma, userId, netrunnerdbId, uuid, name, dateCreation, cards)` (now returns the internal `id`, since callers need it and it's no longer identical to the input), `removeDeck(prisma, userId, id)`, `reorderDecks(prisma, userId, orderedIds)`.
- Consumes: `requireOwnedDeck` (Task 2).

- [ ] **Step 1: Update every test call site, add cross-account tests**

Same mechanical update as prior tasks — note `saveDeck`'s second parameter is now `netrunnerdbId`, not `id`, and it returns the new internal id rather than `void`. Add:

```ts
it('getDeckWithOwnership returns null for a deck belonging to another user', async () => {
  const owner = await seedUser(prisma, { email: 'owner@example.com' })
  const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
  const ownerCollection = await seedCollection(prisma, owner.id)
  const strangerCollection = await seedCollection(prisma, stranger.id)
  const deckId = await saveDeck(prisma, owner.id, 1001, 'uuid-1', 'Test Deck', null, {})

  const result = await getDeckWithOwnership(prisma, stranger.id, strangerCollection.id, deckId)

  expect(result).toBeNull()
})

it('saveDeck lets two different accounts each import the same NetrunnerDB decklist', async () => {
  const alice = await seedUser(prisma, { email: 'alice@example.com' })
  const bob = await seedUser(prisma, { email: 'bob@example.com' })

  const aliceDeckId = await saveDeck(prisma, alice.id, 1001, 'uuid-1', 'Test Deck', null, {})
  const bobDeckId = await saveDeck(prisma, bob.id, 1001, 'uuid-1', 'Test Deck', null, {})

  expect(aliceDeckId).not.toBe(bobDeckId)
  const aliceDeck = await prisma.deck.findUniqueOrThrow({ where: { id: aliceDeckId } })
  const bobDeck = await prisma.deck.findUniqueOrThrow({ where: { id: bobDeckId } })
  expect(aliceDeck.netrunnerdbId).toBe(1001)
  expect(bobDeck.netrunnerdbId).toBe(1001)
})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/lib/decks.test.ts src/actions/deckMutations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/decks.ts`**

```ts
export async function getDecksWithOwnership(prisma: PrismaClient, userId: number, collectionId: number): Promise<DeckSummary[]> {
  const decks = await prisma.deck.findMany({
    where: { userId },
    include: { cards: { orderBy: { cardCode: 'asc' } } },
    orderBy: [{ sortOrder: 'asc' }, { importedAt: 'desc' }],
  })
  return Promise.all(decks.map((deck) => computeDeckSummary(prisma, collectionId, deck)))
}

export async function getDeckWithOwnership(
  prisma: PrismaClient,
  userId: number,
  collectionId: number,
  id: number
): Promise<DeckSummary | null> {
  const deck = await prisma.deck.findFirst({
    where: { id, userId },
    include: { cards: { orderBy: { cardCode: 'asc' } } },
  })
  if (!deck) {
    return null
  }
  return computeDeckSummary(prisma, collectionId, deck)
}

export async function exportDeckCsv(prisma: PrismaClient, userId: number, collectionId: number, id: number): Promise<string | null> {
  const deck = await getDeckWithOwnership(prisma, userId, collectionId, id)
  // ...rest unchanged...
}
```

(`getDecksWithOwnership`/`getDeckWithOwnership` check ownership directly via their own `where` clause rather than calling `requireOwnedDeck` first, since that would mean two separate queries for what's naturally one lookup — `requireOwnedDeck` exists for callers that need a pure ownership check with no other data, e.g. the coming `removeDeck`.)

- [ ] **Step 4: Implement `src/actions/deckMutations.ts`**

```ts
export async function saveDeck(
  prisma: PrismaClient,
  userId: number,
  netrunnerdbId: number,
  uuid: string,
  name: string,
  dateCreation: string | null,
  cards: Record<string, number>
): Promise<number> {
  const minSortOrder = await prisma.deck.aggregate({ where: { userId }, _min: { sortOrder: true } })
  const parsedDateCreation = dateCreation === null ? null : new Date(dateCreation)
  const deck = await prisma.deck.upsert({
    where: { userId_netrunnerdbId: { userId, netrunnerdbId } },
    create: {
      userId,
      netrunnerdbId,
      uuid,
      name,
      dateCreation: parsedDateCreation,
      sortOrder: (minSortOrder._min.sortOrder ?? 0) - 1,
    },
    update: { uuid, name, dateCreation: parsedDateCreation },
  })
  await prisma.$transaction([
    prisma.deckCard.deleteMany({ where: { deckId: deck.id } }),
    prisma.deckCard.createMany({
      data: Object.entries(cards).map(([cardCode, quantity]) => ({ deckId: deck.id, cardCode, quantity })),
    }),
  ])
  return deck.id
}

export async function removeDeck(prisma: PrismaClient, userId: number, id: number): Promise<void> {
  await requireOwnedDeck(prisma, userId, id)
  await prisma.$transaction([
    prisma.deckCard.deleteMany({ where: { deckId: id } }),
    prisma.deck.deleteMany({ where: { id } }),
  ])
}

export async function reorderDecks(prisma: PrismaClient, userId: number, orderedIds: number[]): Promise<void> {
  for (const id of orderedIds) {
    await requireOwnedDeck(prisma, userId, id)
  }
  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.deck.update({ where: { id }, data: { sortOrder: index } }))
  )
}
```

(The original `saveDeck` ran its upsert and the `deckCard` rewrite in one `$transaction` array; splitting the upsert out is necessary here because the new `deckId` used by the `deckCard` writes isn't known until the upsert has actually run — it's no longer just "the same `id` the caller passed in.")

Add `import { requireOwnedDeck } from '@/lib/decks'`.

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx vitest run src/lib/decks.test.ts src/actions/deckMutations.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/decks.ts src/lib/decks.test.ts src/actions/deckMutations.ts src/actions/deckMutations.test.ts
git commit -m "Thread userId through decks lib/mutations, key saveDeck on (userId, netrunnerdbId)"
```

---

### Task 9: Thread `userId` through `src/actions/settingsMutations.ts`, split the sync checkpoint out

**Files:**
- Modify: `src/actions/settingsMutations.ts`
- Modify: `src/actions/settingsMutations.test.ts`
- Create: `src/lib/syncCheckpoint.ts`
- Create: `src/lib/syncCheckpoint.test.ts`
- Modify: `src/lib/tournamentDeckSync.ts`

**Interfaces:**
- Produces: `getHiddenBuilderPackCodes(prisma, userId)`, `setHiddenBuilderPacks(prisma, userId, packCodes)`, `getSetting(prisma, userId, key)`, `setSetting(prisma, userId, key, value)`, `getBuilderMode(prisma, userId)`, `setBuilderMode(prisma, userId, mode)`, `getNavStyle(prisma, userId)`, `setNavStyle(prisma, userId, style)`, `getSyncCheckpoint(prisma): Promise<string | null>`, `setSyncCheckpoint(prisma, value: string): Promise<void>`.

- [ ] **Step 1: Update every test call site, add a cross-account test**

```ts
it('getSetting only sees the given user\'s own value', async () => {
  const alice = await seedUser(prisma, { email: 'alice@example.com' })
  const bob = await seedUser(prisma, { email: 'bob@example.com' })
  await setSetting(prisma, alice.id, 'theme', 'dark')

  expect(await getSetting(prisma, bob.id, 'theme')).toBeNull()
  expect(await getSetting(prisma, alice.id, 'theme')).toBe('dark')
})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/actions/settingsMutations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export async function getHiddenBuilderPackCodes(prisma: PrismaClient, userId: number): Promise<string[]> {
  const rows = await prisma.hiddenBuilderPack.findMany({ where: { userId }, select: { packCode: true } })
  return rows.map((row) => row.packCode)
}

export async function setHiddenBuilderPacks(prisma: PrismaClient, userId: number, packCodes: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.hiddenBuilderPack.deleteMany({ where: { userId } }),
    prisma.hiddenBuilderPack.createMany({ data: packCodes.map((packCode) => ({ userId, packCode })) }),
  ])
}

export async function getSetting(prisma: PrismaClient, userId: number, key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { userId_key: { userId, key } } })
  return row?.value ?? null
}

export async function setSetting(prisma: PrismaClient, userId: number, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value },
    update: { value },
  })
}
```

`getBuilderMode`/`setBuilderMode`/`getNavStyle`/`setNavStyle` each just gain `userId: number` as the parameter right after `prisma`, passed straight through to the `getSetting`/`setSetting` call inside them — no other change to their bodies.

- [ ] **Step 4: Write, implement, and verify `src/lib/syncCheckpoint.ts`, and switch `tournamentDeckSync.ts` over to it**

`src/lib/tournamentDeckSync.ts` reads/writes `Setting` directly for `SYNC_CHECKPOINT_KEY` (Task 3 already moved its existing data out of `Setting` into the new `SyncCheckpoint` table) — it needs to move to a dedicated, non-per-user module instead of the now-per-user `getSetting`/`setSetting`.

```ts
// src/lib/syncCheckpoint.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { getSyncCheckpoint, setSyncCheckpoint } from './syncCheckpoint'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.syncCheckpoint.deleteMany()
})

describe('getSyncCheckpoint / setSyncCheckpoint', () => {
  it('returns null when no checkpoint has been set', async () => {
    expect(await getSyncCheckpoint(prisma)).toBeNull()
  })

  it('persists and returns a checkpoint value', async () => {
    await setSyncCheckpoint(prisma, '2026-01-15')

    expect(await getSyncCheckpoint(prisma)).toBe('2026-01-15')
  })

  it('overwrites rather than duplicates on a second call', async () => {
    await setSyncCheckpoint(prisma, '2026-01-15')
    await setSyncCheckpoint(prisma, '2026-01-16')

    expect(await getSyncCheckpoint(prisma)).toBe('2026-01-16')
    expect(await prisma.syncCheckpoint.count()).toBe(1)
  })
})
```

Run: `npx vitest run src/lib/syncCheckpoint.test.ts` — expect FAIL (module doesn't exist).

```ts
// src/lib/syncCheckpoint.ts
import type { PrismaClient } from '@prisma/client'

const CHECKPOINT_KEY = 'tournamentDecksSyncedThrough'

export async function getSyncCheckpoint(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.syncCheckpoint.findUnique({ where: { key: CHECKPOINT_KEY } })
  return row?.value ?? null
}

export async function setSyncCheckpoint(prisma: PrismaClient, value: string): Promise<void> {
  await prisma.syncCheckpoint.upsert({
    where: { key: CHECKPOINT_KEY },
    create: { key: CHECKPOINT_KEY, value },
    update: { value },
  })
}
```

Run: `npx vitest run src/lib/syncCheckpoint.test.ts` — expect PASS.

In `src/lib/tournamentDeckSync.ts`, replace `import { getSetting, setSetting } from '@/actions/settingsMutations'` with `import { getSyncCheckpoint, setSyncCheckpoint } from './syncCheckpoint'`, and its two call sites:

```ts
const checkpoint = await getSyncCheckpoint(prisma)
```

and (further down, where it currently calls `setSetting(prisma, SYNC_CHECKPOINT_KEY, cursor)`):

```ts
await setSyncCheckpoint(prisma, cursor)
```

`SYNC_CHECKPOINT_KEY` and `FLOOR_DATE` stay exported from this file exactly as today — only the storage call sites change. Check `src/lib/tournamentDeckSync.test.ts` for any mock of `@/actions/settingsMutations`'s `getSetting`/`setSetting` and update it to mock `./syncCheckpoint`'s `getSyncCheckpoint`/`setSyncCheckpoint` instead, keeping the same test assertions.

- [ ] **Step 5: Run to verify everything in this task passes**

Run: `npx vitest run src/actions/settingsMutations.test.ts src/lib/syncCheckpoint.test.ts src/lib/tournamentDeckSync.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/actions/settingsMutations.ts src/actions/settingsMutations.test.ts src/lib/syncCheckpoint.ts src/lib/syncCheckpoint.test.ts src/lib/tournamentDeckSync.ts src/lib/tournamentDeckSync.test.ts
git commit -m "Thread userId through settingsMutations.ts, move the sync checkpoint to its own non-per-user table"
```

---

### Task 10: Wire `userId` into Collection + Quick Add Set actions

**Files:**
- Modify: `src/actions/collectionActions.ts`
- Modify: `src/actions/collectionActions.test.ts`
- Modify: `src/actions/quickSetActions.ts`
- Modify: `src/actions/quickSetActions.test.ts`

**Interfaces:**
- Consumes: every `src/lib/collections.ts` export (Task 4), every `src/lib/collection.ts` export (Task 5), every `src/lib/quickSet.ts` export (Task 6), `requireCurrentUser` (`src/lib/currentUser.ts`, built in Phase 1, unused until now).

- [ ] **Step 1: Update `collectionActions.test.ts` and `quickSetActions.test.ts` to mock/seed a current user**

These test files likely mock `@/lib/db`'s `prisma` export already (check the current pattern in each file). Add a matching mock for `@/lib/currentUser`'s `requireCurrentUser`, returning a fixed test user id, e.g.:

```ts
vi.mock('@/lib/currentUser', () => ({
  requireCurrentUser: vi.fn().mockResolvedValue({ id: 1, email: 'test@example.com', emailVerifiedAt: null, createdAt: new Date() }),
}))
```

placed alongside this file's existing `vi.mock('@/lib/db', ...)` call. No other test assertions need to change — these action tests already assert on behavior, and the mocked `requireCurrentUser` just supplies a stable `userId` for whatever mocked lib function receives it.

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/actions/collectionActions.test.ts src/actions/quickSetActions.test.ts`
Expected: FAIL — the mocked lib functions are still being called without a `userId` argument, so assertions on call arguments (`expect(someLibFn).toHaveBeenCalledWith(...)`) mismatch.

- [ ] **Step 3: Implement `collectionActions.ts`**

Add `import { requireCurrentUser } from '@/lib/currentUser'`. Every exported action gets `const { id: userId } = await requireCurrentUser()` as its first line, and passes `userId` through to whichever `collections.ts`/`collection.ts`/`batchMutations.ts` function it calls. For example:

```ts
export async function addToCollection(cardCode: string, amount: number): Promise<number> {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  const quantity = await addToCollectionMutation(prisma, userId, collectionId, cardCode, amount)
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  revalidatePath('/collections/[id]', 'page')
  return quantity
}
```

(`addToCollectionMutation`/`updateCollectionQuantityMutation` in `src/actions/collectionMutations.ts` are thin wrappers around `incrementOwned`/`setOwned` — give them the same `userId` parameter, threaded straight through, in the same task.) Apply the identical shape (resolve `userId` first, pass it as the first argument after `prisma` to every downstream call) to `updateCollectionQuantity`, `createCollection`, `renameCollection`, `deleteCollection`, `setDefaultCollection`, `reorderCollections`, `importCsvToCollection`, `removeFromImportBatch`, `approveImportBatch`.

- [ ] **Step 4: Implement `quickSetActions.ts`**

Same pattern — `requireCurrentUser()` first line, `userId` threaded into `quickAddSetMutation`/`clearSetMutation`/`undoQuickSetChangeMutation`.

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx vitest run src/actions/collectionActions.test.ts src/actions/quickSetActions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/actions/collectionActions.ts src/actions/collectionActions.test.ts src/actions/quickSetActions.ts src/actions/quickSetActions.test.ts src/actions/collectionMutations.ts
git commit -m "Wire requireCurrentUser into collection and quick-add-set actions"
```

---

### Task 11: Wire `userId` into `src/actions/batchActions.ts`

**Files:**
- Modify: `src/actions/batchActions.ts`
- Modify: `src/actions/batchActions.test.ts` (if it exists — check; if this file's coverage lives inside `batchMutations.test.ts` instead, add the equivalent cases there)

**Interfaces:**
- Consumes: every `src/actions/batchMutations.ts` export (Task 7), `requireCurrentUser`.

- [ ] **Step 1: Update tests for the mocked current user**

Same `vi.mock('@/lib/currentUser', ...)` addition as Task 10.

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/actions/batchActions.test.ts` (adjust path if this file doesn't exist under this exact name — confirm via `ls src/actions/*.test.ts`)
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `import { requireCurrentUser } from '@/lib/currentUser'`. `withActiveBatch`'s signature doesn't need to change — it's already parameterized by `collectionId`; what changes is every exported action resolving `userId` first and passing it through to both `withActiveBatch`'s `getActiveBatch` call and the mutation it wraps:

```ts
async function withActiveBatch(
  userId: number,
  collectionId: number,
  mutate: () => Promise<MutateResult>
): Promise<BatchActionResult> {
  try {
    const mutateResult = await mutate()
    const batch = await getActiveBatch(prisma, userId, collectionId)
    // ...unchanged...
  } catch (err) {
    // ...unchanged...
  }
}

export async function startBatch(expectedCount: number): Promise<BatchActionResult> {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  return withActiveBatch(userId, collectionId, () => startBatchMutation(prisma, userId, collectionId, expectedCount))
}

export async function addCardToBatch(batchId: number, cardCode: string, amount: number): Promise<BatchActionResult> {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  return withActiveBatch(userId, collectionId, () => addCardToBatchMutation(prisma, userId, batchId, cardCode, amount))
}
```

Apply the same "resolve `userId`, pass it everywhere" pattern to `pauseBatch`, `continueBatch`, `discardBatch`, `approveBatch`, `removeFromBatch`, `importCsv`, `revertApprovedBatch` — each one's existing body is otherwise unchanged, just with `userId` inserted as the new second argument to whichever `batchMutations`/`collections` function it already calls.

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run src/actions/batchActions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/batchActions.ts src/actions/batchActions.test.ts
git commit -m "Wire requireCurrentUser into batch actions"
```

---

### Task 12: Wire `userId` into Deck + Discover actions

**Files:**
- Modify: `src/actions/deckActions.ts`
- Modify: `src/actions/deckActions.test.ts` (if present)
- Modify: `src/actions/discoverActions.ts`
- Modify: `src/actions/discoverActions.test.ts`

**Interfaces:**
- Consumes: every `src/lib/decks.ts`/`src/actions/deckMutations.ts` export (Task 8), `requireCurrentUser`.

- [ ] **Step 1: Update tests for the mocked current user**

Same pattern as Tasks 10-11.

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/actions/deckActions.test.ts src/actions/discoverActions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `deckActions.ts`**

```ts
export async function importDeck(input: string): Promise<{ ok: true; deck: DeckSummary } | { ok: false; error: string }> {
  const decklistId = parseDecklistId(input)
  if (decklistId === null) {
    return { ok: false, error: 'Enter a valid NetrunnerDB decklist URL or ID' }
  }

  try {
    const { id: userId } = await requireCurrentUser()
    const decklist = await fetchDecklist(decklistId)
    const deckId = await saveDeck(prisma, userId, decklist.id, decklist.uuid, decklist.name, decklist.dateCreation, decklist.cards)
    revalidatePath('/decks')

    const collectionId = await getDefaultCollectionId(prisma, userId)
    const summary = await getDeckWithOwnership(prisma, userId, collectionId, deckId)
    if (!summary) {
      return { ok: false, error: 'Failed to load the imported deck' }
    }
    return { ok: true, deck: summary }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to import deck' }
  }
}

export async function deleteDeck(id: number): Promise<void> {
  const { id: userId } = await requireCurrentUser()
  await removeDeck(prisma, userId, id)
  revalidatePath('/decks')
}

export async function reorderDecks(orderedIds: number[]): Promise<SimpleActionResult> {
  try {
    const { id: userId } = await requireCurrentUser()
    await reorderDecksMutation(prisma, userId, orderedIds)
    revalidatePath('/decks')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}
```

(Note `saveDeck`'s call site here now passes `decklist.id` as the *`netrunnerdbId`* argument — same value as before, just a renamed parameter — and captures its return value as `deckId` instead of assuming it equals `decklist.id`.)

- [ ] **Step 4: Implement `discoverActions.ts`**

```ts
export async function fetchDiscoverDecks(filters: DiscoverFilters): Promise<{ decks: DiscoverDeck[]; total: number }> {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  return getDiscoverDecks(prisma, collectionId, filters)
}

export async function saveDiscoveredDeck(id: number): Promise<SimpleActionResult> {
  const deck = await prisma.tournamentDeck.findUnique({ where: { id }, include: { cards: true } })
  if (!deck) {
    return { ok: false, error: 'Deck not found' }
  }

  try {
    const { id: userId } = await requireCurrentUser()
    const cards = Object.fromEntries(deck.cards.map((card) => [card.cardCode, card.quantity]))
    await saveDeck(prisma, userId, deck.id, deck.uuid, deck.name, deck.dateCreation.toISOString(), cards)
    revalidatePath('/decks')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save deck' }
  }
}
```

Add `import { requireCurrentUser } from '@/lib/currentUser'` to both files.

- [ ] **Step 5: Run to verify the tests pass**

Run: `npx vitest run src/actions/deckActions.test.ts src/actions/discoverActions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/actions/deckActions.ts src/actions/deckActions.test.ts src/actions/discoverActions.ts src/actions/discoverActions.test.ts
git commit -m "Wire requireCurrentUser into deck and discover actions"
```

---

### Task 13: Wire `userId` into `src/actions/settingsActions.ts`

**Files:**
- Modify: `src/actions/settingsActions.ts`

**Interfaces:**
- Consumes: `src/actions/settingsMutations.ts` (Task 9), `requireCurrentUser`.

(No dedicated test file for this one today — `settingsActions.ts` is thin pass-through over the already-tested `settingsMutations.ts`, same as it was before this feature. If a `settingsActions.test.ts` exists, apply the same mock pattern as prior tasks; otherwise this task is implementation-only.)

- [ ] **Step 1: Implement**

```ts
export async function updateHiddenBuilderPacks(packCodes: string[]): Promise<void> {
  const { id: userId } = await requireCurrentUser()
  await setHiddenBuilderPacks(prisma, userId, packCodes)
  revalidatePath('/settings')
}

export async function updateBuilderMode(mode: BuilderMode): Promise<void> {
  const { id: userId } = await requireCurrentUser()
  await setBuilderMode(prisma, userId, mode)
  revalidatePath('/settings')
  revalidatePath('/builder')
}

export async function updateNavStyle(style: NavStyle): Promise<void> {
  const { id: userId } = await requireCurrentUser()
  await setNavStyle(prisma, userId, style)
  revalidatePath('/', 'layout')
}
```

Add `import { requireCurrentUser } from '@/lib/currentUser'`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit 2>&1 | grep settingsActions` — expect no output (this file's own errors are gone; unrelated errors elsewhere are expected and fixed in later tasks).

- [ ] **Step 3: Commit**

```bash
git add src/actions/settingsActions.ts
git commit -m "Wire requireCurrentUser into settings actions"
```

---

### Task 14: Wire `userId` into API Route Handlers

**Files:**
- Modify: `src/app/api/cards/search/route.ts`
- Modify: `src/app/api/cards/printings/route.ts`
- Modify: `src/app/api/cards/detail/route.ts`
- Modify: `src/app/api/collection/export/route.ts`
- Modify: `src/app/api/deck/export/route.ts`
- Modify each corresponding `route.test.ts`

**Interfaces:**
- Consumes: `getCurrentUser` (`src/lib/currentUser.ts`), `requireOwnedCollection` (Task 1), `requireOwnedDeck` (Task 2).

Route Handlers can't use `requireCurrentUser()`'s `redirect()` cleanly (that's a Server Component/Action mechanism), so these use the non-throwing `getCurrentUser()` and return a 401 directly — mirroring `src/proxy.ts`'s own existing `/api/*` branch. This is defense-in-depth: `proxy.ts` already blocks an unauthenticated request from reaching any of these routes at all; this is the same "checked at the gate and independently inside every handler" shape Phase 1 already established for auth generally.

- [ ] **Step 1: Update each route's test file for a mocked current user, add a 401 case**

Same `vi.mock('@/lib/currentUser', ...)` pattern as prior action tests. Add one new test per route, e.g. for `cards/search`:

```ts
it('returns 401 when there is no current user', async () => {
  vi.mocked(getCurrentUser).mockResolvedValueOnce(null)
  const request = new NextRequest('http://localhost/api/cards/search?q=test')

  const response = await GET(request)

  expect(response.status).toBe(401)
})
```

(Adjust the exact mocked-module import name/shape to match how each `route.test.ts` currently mocks `@/lib/db`'s `prisma`.)

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/app/api/cards/search/route.test.ts src/app/api/cards/printings/route.test.ts src/app/api/cards/detail/route.test.ts src/app/api/collection/export/route.test.ts src/app/api/deck/export/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement — `cards/search`, `cards/printings`, `cards/detail`**

Each follows the identical shape; for `cards/search`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { searchCards } from '@/lib/cards'
import { getDefaultCollectionId } from '@/lib/collections'
import { getCurrentUser } from '@/lib/currentUser'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? ''

  if (query.trim().length === 0) {
    return NextResponse.json([])
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const collectionId = await getDefaultCollectionId(prisma, user.id)
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

Apply the identical `getCurrentUser()` + 401-guard + `user.id`-in-place-of-nothing pattern to `cards/printings` and `cards/detail` (each keeps its existing early-return-on-missing-`code` check *before* the auth check, matching this codebase's existing "stay database-free on trivially-invalid input" convention already noted in the multi-collection Phase 1 plan).

- [ ] **Step 4: Implement — `collection/export`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getDefaultCollection, requireOwnedCollection } from '@/lib/collections'
import { exportCollectionCsv } from '@/lib/collection'
import { getCurrentUser } from '@/lib/currentUser'

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'collection'
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const collectionIdParam = request.nextUrl.searchParams.get('collectionId')

  let collectionId: number
  let collectionName: string

  if (collectionIdParam === null || collectionIdParam === '') {
    const collection = await getDefaultCollection(prisma, user.id)
    collectionId = collection.id
    collectionName = collection.name
  } else {
    const parsed = Number(collectionIdParam)
    if (!Number.isInteger(parsed)) {
      return NextResponse.json({ error: `Invalid collectionId "${collectionIdParam}"` }, { status: 400 })
    }
    let collection
    try {
      collection = await requireOwnedCollection(prisma, user.id, parsed)
    } catch {
      return NextResponse.json({ error: `Collection ${parsed} not found` }, { status: 404 })
    }
    collectionId = collection.id
    collectionName = collection.name
  }

  const csv = await exportCollectionCsv(prisma, user.id, collectionId)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="netrunner-${slugify(collectionName)}.csv"`,
    },
  })
}
```

- [ ] **Step 5: Implement — `deck/export`**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
import { exportDeckCsv } from '@/lib/decks'
import { getCurrentUser } from '@/lib/currentUser'

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'deck'
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deckIdParam = request.nextUrl.searchParams.get('deckId')
  const parsed = Number(deckIdParam)
  if (deckIdParam === null || deckIdParam === '' || !Number.isInteger(parsed)) {
    return NextResponse.json({ error: `Invalid deckId "${deckIdParam}"` }, { status: 400 })
  }

  const deck = await prisma.deck.findFirst({ where: { id: parsed, userId: user.id } })
  if (!deck) {
    return NextResponse.json({ error: `Deck ${parsed} not found` }, { status: 404 })
  }

  const collectionId = await getDefaultCollectionId(prisma, user.id)
  const csv = await exportDeckCsv(prisma, user.id, collectionId, parsed)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="netrunner-deck-${slugify(deck.name)}.csv"`,
    },
  })
}
```

- [ ] **Step 6: Run to verify the tests pass**

Run: `npx vitest run src/app/api/cards/search/route.test.ts src/app/api/cards/printings/route.test.ts src/app/api/cards/detail/route.test.ts src/app/api/collection/export/route.test.ts src/app/api/deck/export/route.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api
git commit -m "Wire current-user resolution into API route handlers, 401 without a session"
```

---

### Task 15: Wire `userId` into Server Component pages

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/builder/page.tsx`
- Modify: `src/app/sets/[packCode]/page.tsx`
- Modify: `src/app/collections/page.tsx`
- Modify: `src/app/collections/[id]/page.tsx`
- Modify: `src/app/reports/under-owned-cards/page.tsx`
- Modify: `src/app/decks/page.tsx`
- Modify: `src/app/decks/[id]/page.tsx`
- Modify: `src/app/discover/page.tsx`
- Modify: `src/app/builder/batches/page.tsx`
- Modify: `src/app/settings/page.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `requireCurrentUser`, `getCurrentUser`, every lib function threaded in Tasks 4-9.

No test files here — these are Server Components, and this codebase's existing pages of this shape have no dedicated render tests (confirmed by their current lack of a `.test.tsx` in this directory listing). Verified in Task 16 via `npm run build` + manual smoke check, and structurally by `npx tsc --noEmit`.

**`src/app/layout.tsx` needs `getCurrentUser()`, not `requireCurrentUser()`** — found while cross-checking every caller of `getNavStyle` for this plan's self-review. This is the *root* layout: it wraps every route, including the public, unauthenticated `/login`/`/signup`/`/verify-email`/`/forgot-password`/`/reset-password` pages `src/proxy.ts` deliberately lets through without a session. If the layout called `requireCurrentUser()` (which redirects to `/login` when there's no session), visiting `/login` itself would immediately redirect back to `/login` — nobody could ever reach the page that lets them log in. `getCurrentUser()` doesn't throw or redirect; the layout falls back to a sensible default nav style when there's no session yet.

- [ ] **Step 1: `src/app/page.tsx`**

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function DashboardPage() {
  const { id: userId } = await requireCurrentUser()
  const collection = await getDefaultCollection(prisma, userId)
  const [sets, totals, unsizedPacks, collections] = await Promise.all([
    computeAllSetsCompletion(prisma, collection.id),
    computeCollectionTotals(prisma, collection.id),
    listUnsizedPacks(prisma),
    listCollections(prisma, userId),
  ])
  // ...rest unchanged, still reading collection.id/collection.name...
}
```

- [ ] **Step 2: `src/app/builder/page.tsx`**

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function BuilderPage() {
  const { id: userId } = await requireCurrentUser()
  const collection = await getDefaultCollection(prisma, userId)
  const [builderMode, activeBatch] = await Promise.all([
    getBuilderMode(prisma, userId),
    getActiveBatch(prisma, userId, collection.id),
  ])
  // ...rest unchanged...
}
```

- [ ] **Step 3: `src/app/sets/[packCode]/page.tsx`**

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function SetPage({ params, searchParams }: { /* unchanged */ }) {
  const { packCode } = await params
  const { collectionId: requestedCollectionId } = await searchParams
  const { id: userId } = await requireCurrentUser()

  const pack = await prisma.pack.findUnique({ where: { code: packCode }, include: { cycle: true } })
  if (!pack) {
    notFound()
  }

  let collection
  if (requestedCollectionId) {
    const parsedId = Number(requestedCollectionId)
    if (!Number.isInteger(parsedId)) notFound()
    collection = await getCollection(prisma, userId, parsedId)
    if (!collection) notFound()
  } else {
    collection = await getDefaultCollection(prisma, userId)
  }
  // ...rest unchanged...
}
```

- [ ] **Step 4: `src/app/collections/page.tsx` and `src/app/collections/[id]/page.tsx`**

`collections/page.tsx`:

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function CollectionsPage() {
  const { id: userId } = await requireCurrentUser()
  const collections = await listCollectionsWithStats(prisma, userId)
  // ...rest unchanged...
}
```

`collections/[id]/page.tsx`:

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsedId = Number(id)
  if (!Number.isInteger(parsedId)) {
    notFound()
  }

  const { id: userId } = await requireCurrentUser()
  const collection = await getCollection(prisma, userId, parsedId)
  if (!collection) {
    notFound()
  }

  const [sets, totals, unsizedPacks, collections] = await Promise.all([
    computeAllSetsCompletion(prisma, collection.id),
    computeCollectionTotals(prisma, collection.id),
    listUnsizedPacks(prisma),
    listCollections(prisma, userId),
  ])
  // ...rest unchanged...
}
```

(A collection id in the URL belonging to another account now correctly 404s via the same `getCollection` ownership check used everywhere else — no bespoke handling needed here.)

- [ ] **Step 5: `src/app/reports/under-owned-cards/page.tsx`**

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function UnderOwnedCardsReportPage() {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  const sets = await listCardsUnderExpectedQuantity(prisma, collectionId)
  // ...rest unchanged...
}
```

- [ ] **Step 6: `src/app/decks/page.tsx` and `src/app/decks/[id]/page.tsx`**

`decks/page.tsx`:

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function DecksPage() {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  const [decks, factions] = await Promise.all([
    getDecksWithOwnership(prisma, userId, collectionId),
    prisma.faction.findMany({ orderBy: { name: 'asc' } }),
  ])
  // ...rest unchanged...
}
```

`decks/[id]/page.tsx` — note the outbound NetrunnerDB link switches from `deck.id` to `deck.netrunnerdbId` (per Task 2's `DeckSummary` addition), since `deck.id` is now this app's own internal id, not NetrunnerDB's:

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function DeckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsedId = Number(id)
  if (!Number.isInteger(parsedId)) {
    notFound()
  }

  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  const [deck, decks] = await Promise.all([
    getDeckWithOwnership(prisma, userId, collectionId, parsedId),
    getDecksWithOwnership(prisma, userId, collectionId),
  ])
  if (!deck) {
    notFound()
  }
  // ...rest unchanged, except the NetrunnerDB link:...
```

```tsx
            <a
              href={`https://netrunnerdb.com/en/decklist/${deck.netrunnerdbId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer text-sm text-accent hover:underline"
            >
              View on NetrunnerDB
            </a>
```

(The `?deckId=${deck.id}` export link and `<DeleteDeckButton deckId={deck.id} />` stay as `deck.id` — those address *this app's* internal record, correctly.)

- [ ] **Step 7: `src/app/discover/page.tsx`**

The direct `prisma.deck.findMany({ select: { id: true } })` call here (used to compute `savedDeckIds`, i.e. which discovered decks the viewer has already imported) needs a `userId` filter — without it, every account would see every other account's imports as already-saved:

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function DiscoverPage() {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  const [{ decks, total }, savedDecks, factions] = await Promise.all([
    getDiscoverDecks(prisma, collectionId, DEFAULT_FILTERS),
    prisma.deck.findMany({ where: { userId }, select: { netrunnerdbId: true } }),
    prisma.faction.findMany({ orderBy: { name: 'asc' } }),
  ])

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Discover</h1>
      <DiscoverSection
        initialDecks={decks}
        initialTotal={total}
        savedDeckIds={savedDecks.map((deck) => deck.netrunnerdbId)}
        factionOptions={factions.map((faction) => ({ code: faction.code, name: faction.name, sideCode: faction.sideCode }))}
      />
    </main>
  )
}
```

(`savedDeckIds` must switch from the internal `id` to `netrunnerdbId` here specifically, since it's compared against `TournamentDeck.id`/NetrunnerDB decklist ids coming from `getDiscoverDecks` — check `DiscoverSection`'s prop type and `getDiscoverDecks`'s return shape to confirm this comparison, and adjust `DiscoverSection`'s comparison logic if it currently assumes `savedDeckIds` lines up with `Deck.id` directly rather than `Deck.netrunnerdbId`.)

- [ ] **Step 8: `src/app/builder/batches/page.tsx`**

Calls `getCollection`/`listCollections` (Task 4) and `listArchivedBatches` (Task 7), all of which now need `userId`:

```tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { listArchivedBatches } from '@/lib/batches'
import { getCollection, listCollections } from '@/lib/collections'
import { requireCurrentUser } from '@/lib/currentUser'
import { BatchHistoryList } from './BatchHistoryList'
import { BatchHistoryFilter } from './BatchHistoryFilter'

export const dynamic = 'force-dynamic'

export default async function BatchHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ collectionId?: string }>
}) {
  const { collectionId: requestedCollectionId } = await searchParams
  const { id: userId } = await requireCurrentUser()

  let selectedCollectionId: number | null = null
  if (requestedCollectionId) {
    const parsedId = Number(requestedCollectionId)
    if (!Number.isInteger(parsedId)) notFound()
    const collection = await getCollection(prisma, userId, parsedId)
    if (!collection) notFound()
    selectedCollectionId = collection.id
  }

  const [batches, collections] = await Promise.all([
    listArchivedBatches(prisma, userId, selectedCollectionId ?? undefined),
    listCollections(prisma, userId),
  ])

  // ...rest of the file (JSX) unchanged...
}
```

- [ ] **Step 9: `src/app/settings/page.tsx`**

This is behind the auth gate (not in `proxy.ts`'s `PUBLIC_PATHS`), so `requireCurrentUser()` is correct here, same as every other page in this task:

```tsx
import { requireCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function SettingsPage() {
  const { id: userId } = await requireCurrentUser()
  const [packs, hiddenPackCodes, builderMode, navStyle] = await Promise.all([
    prisma.pack.findMany({ orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }] }),
    getHiddenBuilderPackCodes(prisma, userId),
    getBuilderMode(prisma, userId),
    getNavStyle(prisma, userId),
  ])
  // ...rest unchanged...
}
```

- [ ] **Step 10: `src/app/layout.tsx`**

Unlike every other page in this task, this one **must not** use `requireCurrentUser()` — see this task's header note on why. Use the non-throwing `getCurrentUser()` and fall back to the existing default nav style (`'topbar'`, matching `getNavStyle`'s own fallback for "no row yet") when nobody's logged in:

```tsx
import { getCurrentUser } from '@/lib/currentUser'
// ...existing imports...

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  const navStyle = user ? await getNavStyle(prisma, user.id) : 'topbar'

  return (
    // ...unchanged JSX, still branching on navStyle exactly as before...
  )
}
```

- [ ] **Step 11: Commit**

```bash
git add src/app
git commit -m "Wire requireCurrentUser into every Server Component page reading Collection/Deck data"
```

---

### Task 16: Full verification (everything except the real database)

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass. If anything still fails, it's a missed call site from Tasks 10-15 — fix it in place (not a new task) before proceeding.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: succeeds. (Per `CLAUDE.md`, this doesn't touch `data/netrunner.db` — every page here is dynamically rendered.)

- [ ] **Step 4: Commit (only if Steps 1-3 required fixes)**

```bash
git add -A
git commit -m "Fix remaining call sites after userId threading"
```

(Skip this commit if Steps 1-3 passed clean on the first try — nothing to commit.)

---

### Task 17: Author the real-database "tighten" migrations and the claim script

**Files:**
- Create: a new migration under `prisma/migrations/` (tightens `Collection`, `Deck`, `Setting`, `HiddenBuilderPack` to `NOT NULL`)
- Create: `scripts/claim-existing-data.ts`
- Create: `scripts/claim-existing-data.test.ts`

**Interfaces:**
- Produces: `claimExistingData(prisma: PrismaClient, ownerEmail: string): Promise<{ collections: number; decks: number; settings: number; hiddenBuilderPacks: number }>`.

This task authors and verifies everything needed for Tasks 18-19, but **does not touch the real `data/netrunner.db`** — only a disposable copy. `prisma/schema.prisma` already declares the final required shape (Tasks 1-3); this task's migration is what makes the *real database's* structure match it.

- [ ] **Step 1: Write the failing test for the claim script**

```ts
// scripts/claim-existing-data.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { claimExistingData } from './claim-existing-data'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.setting.deleteMany()
  await prisma.hiddenBuilderPack.deleteMany()
  await prisma.deck.deleteMany()
  await prisma.collection.deleteMany()
  await prisma.user.deleteMany()
})

describe('claimExistingData', () => {
  it('assigns every unowned row to the user with the given email', async () => {
    // Bypass Prisma's required-userId type to simulate genuinely legacy,
    // pre-claim rows — the real scenario this script exists to fix.
    await prisma.$executeRawUnsafe(
      `INSERT INTO Collection (name, isDefault, sortOrder, userId) VALUES ('My Collection', 1, 0, NULL)`
    )
    const owner = await prisma.user.create({ data: { email: 'owner@example.com', passwordHash: 'x' } })

    const result = await claimExistingData(prisma, 'owner@example.com')

    expect(result.collections).toBe(1)
    const collection = await prisma.collection.findFirstOrThrow({})
    expect(collection.userId).toBe(owner.id)
  })

  it('leaves rows that already belong to someone untouched', async () => {
    const owner = await prisma.user.create({ data: { email: 'owner@example.com', passwordHash: 'x' } })
    const someoneElse = await prisma.user.create({ data: { email: 'else@example.com', passwordHash: 'x' } })
    await prisma.collection.create({ data: { userId: someoneElse.id, name: 'Not mine', isDefault: true } })

    const result = await claimExistingData(prisma, 'owner@example.com')

    expect(result.collections).toBe(0)
    const collection = await prisma.collection.findFirstOrThrow({})
    expect(collection.userId).toBe(someoneElse.id)
  })

  it('throws when no user exists with the given email', async () => {
    await expect(claimExistingData(prisma, 'nobody@example.com')).rejects.toThrow('No user found with email')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/claim-existing-data.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the claim script**

```ts
// scripts/claim-existing-data.ts
import type { PrismaClient } from '@prisma/client'
import { normalizeEmail } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function claimExistingData(
  prisma: PrismaClient,
  ownerEmail: string
): Promise<{ collections: number; decks: number; settings: number; hiddenBuilderPacks: number }> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(ownerEmail) } })
  if (!user) {
    throw new Error(`No user found with email ${ownerEmail} — sign up first, then re-run this script`)
  }

  const [collections, decks, settings, hiddenBuilderPacks] = await prisma.$transaction([
    prisma.collection.updateMany({ where: { userId: null }, data: { userId: user.id } }),
    prisma.deck.updateMany({ where: { userId: null }, data: { userId: user.id } }),
    prisma.setting.updateMany({ where: { userId: null }, data: { userId: user.id } }),
    prisma.hiddenBuilderPack.updateMany({ where: { userId: null }, data: { userId: user.id } }),
  ])

  return {
    collections: collections.count,
    decks: decks.count,
    settings: settings.count,
    hiddenBuilderPacks: hiddenBuilderPacks.count,
  }
}

async function main() {
  const email = process.argv[2]
  if (!email) {
    console.error('Usage: npx tsx scripts/claim-existing-data.ts <your-account-email>')
    process.exit(1)
  }
  const result = await claimExistingData(prisma, email)
  console.log('Claimed:', result)
  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

(`prisma.collection.updateMany({ where: { userId: null }, ... })` type-checks fine even though `schema.prisma` currently declares `userId` as required — Prisma still generates the `null`-filter overload for `where` clauses on any nullable-at-the-database-level relation scalar's filter input; if `tsc` disagrees once this is wired up, use `prisma.$executeRaw` instead for these four updates, matching the raw-SQL style already used in this task's own test setup.)

- [ ] **Step 4: Run to verify the tests pass**

Run: `npx vitest run scripts/claim-existing-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Author the tighten migration**

Run: `npx prisma migrate dev --create-only --name require_user_id`

Prisma diffs the currently-nullable real-DB structure against `schema.prisma`'s required shape and generates four table-recreations (`Collection`, `Deck`, `Setting`, `HiddenBuilderPack`), each rebuilding with `userId` `NOT NULL` and the real FK constraint. Since this only runs correctly against a database where every row already has a real `userId` (which won't be true of `data/netrunner.db` until Task 18's claim step), there's nothing to hand-edit here — the generated SQL is exactly what Task 19 needs, verified next.

- [ ] **Step 6: Dry-run the full real sequence against a disposable copy**

This is the one place in this task that touches a copy of real data, to prove the entire Task 18→19 sequence actually works end-to-end before ever running it for real:

```bash
mkdir -p /tmp/scoping-dryrun
cp data/netrunner.db /tmp/scoping-dryrun/test.db
DATABASE_URL="file:/tmp/scoping-dryrun/test.db" npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  await prisma.user.create({ data: { email: 'dryrun-owner@example.com', passwordHash: 'not-a-real-hash' } })
  await prisma.\$disconnect()
}
main()
"
DATABASE_URL="file:/tmp/scoping-dryrun/test.db" npx tsx scripts/claim-existing-data.ts dryrun-owner@example.com
DATABASE_URL="file:/tmp/scoping-dryrun/test.db" npx prisma migrate deploy
DATABASE_URL="file:/tmp/scoping-dryrun/test.db" npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  console.log('collections:', await prisma.collection.count(), 'unclaimed:', await prisma.collection.count({ where: { userId: null as never } }).catch(() => 'n/a (column now NOT NULL, as expected)'))
  console.log('decks:', await prisma.deck.count())
  console.log('settings:', await prisma.setting.count())
  await prisma.\$disconnect()
}
main()
"
rm -rf /tmp/scoping-dryrun
```

Expected: the claim script reports the same counts as this project's real `data/netrunner.db` currently has (2 collections, 5 decks, whatever `Setting`/`HiddenBuilderPack` row counts exist today), `migrate deploy` succeeds (proving the `NOT NULL` tighten migration doesn't fail against fully-claimed data), and nothing errors. **If `migrate deploy` fails here, stop — the tighten migration needs fixing before Task 19, not after.**

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations scripts/claim-existing-data.ts scripts/claim-existing-data.test.ts
git commit -m "Author the userId-required tighten migration and one-time claim script (not yet applied to real data)"
```

---

### Task 18: Sign up for real (checkpoint — requires your action)

This step cannot be automated — it's you creating your own real account with your own password.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Sign up**

Visit `http://localhost:3000/signup` and create your account with your real email address. Verify the email if you have `RESEND_API_KEY` configured; otherwise (this project's current dev default) the verification link is logged to the server console — either way, verification isn't required to proceed, since Phase 1 explicitly doesn't block usage on it.

- [ ] **Step 3: Confirm before proceeding**

**Stop here and confirm with the user which email address they signed up with**, and get explicit confirmation to proceed to Task 19 — the next task assigns every existing row of the real collection to that account and then permanently tightens the schema around it. Do not proceed without that confirmation, per `CLAUDE.md`'s standing rule on real collection data.

---

### Task 19: Claim and tighten the real database (checkpoint — explicit confirmation required)

**Only proceed once Task 18's confirmation has been given.** Every step here acts on the real `data/netrunner.db`.

- [ ] **Step 1: Back up first**

```bash
cp data/netrunner.db "data/netrunner.db.pre-data-scoping-backup-$(date -u +%Y%m%dT%H%M%SZ)"
```

- [ ] **Step 2: Run the claim script against the real database**

```bash
npx tsx scripts/claim-existing-data.ts <the email confirmed in Task 18>
```

Expected output: `Claimed: { collections: 2, decks: 5, settings: <N>, hiddenBuilderPacks: <N> }` (exact counts will match whatever this project's real data currently holds — cross-check against Task 17 Step 6's dry-run numbers, which used a copy of the same data).

- [ ] **Step 3: Verify zero rows remain unclaimed**

```bash
npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  console.log('unclaimed collections:', await prisma.collection.count({ where: { userId: null as never } }))
  console.log('unclaimed decks:', await prisma.deck.count({ where: { userId: null as never } }))
  console.log('unclaimed settings:', await prisma.setting.count({ where: { userId: null as never } }))
  console.log('unclaimed hiddenBuilderPacks:', await prisma.hiddenBuilderPack.count({ where: { userId: null as never } }))
  await prisma.\$disconnect()
}
main()
"
```

Expected: all four are `0`. **If any is nonzero, stop — do not run Step 4.** (`as never` sidesteps the compile-time "always required" type here deliberately, to query the actual nullable-at-the-SQL-level column state directly.)

- [ ] **Step 4: Apply the tighten migration**

```bash
npx prisma migrate deploy
```

Expected: the `require_user_id` migration from Task 17 applies successfully (it will, since Step 3 just confirmed there's nothing left for its `NOT NULL` constraints to reject).

- [ ] **Step 5: Verify against the real database**

```bash
npx prisma validate
npx tsx -e "
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const collections = await prisma.collection.findMany({ select: { id: true, name: true, userId: true } })
  console.log('collections:', collections)
  const deckCount = await prisma.deck.count()
  console.log('deck count:', deckCount)
  await prisma.\$disconnect()
}
main()
"
```

Expected: `npx prisma validate` reports the schema valid, every collection has a real `userId`, and `deck count` matches the pre-migration count.

- [ ] **Step 6: Full smoke test against the real app**

With `npm run dev` running (from Task 18), log in as the claimed account and confirm: the dashboard shows the real collection totals unchanged from before this feature, `/collections` shows both existing collections, `/decks` shows all 5 decks, `/builder` still works for adding a card, and `/settings` shows your prior `builderMode`/`navStyle`/hidden-pack preferences carried over. Then, in a private/incognito window, sign up for a second, throwaway test account and confirm it sees an **empty** collection — not the real data — proving isolation actually holds.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "Multi-account data scoping: real database claimed and tightened"
```
