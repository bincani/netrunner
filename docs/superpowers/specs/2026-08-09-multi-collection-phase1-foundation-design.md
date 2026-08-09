# Multi-Collection Support, Phase 1: Foundation — Design

## Overview

Phase 1 of two. Adds a `Collection` entity and scopes the existing
(currently global) `CollectionEntry` table to it, migrates the user's
real existing collection data into an auto-created default collection,
and retrofits every existing feature to read/write through "the default
collection." **No new UI in this phase** — from the user's perspective,
the app behaves exactly as it does today, just running on a data model
that can now support more than one collection underneath.

Phase 2 (separate spec/plan, built on top of this one) adds the actual
user-facing feature: a Collections list page, rename/delete/set-default
actions, CSV export/upload per collection, and a nav entry.

**This touches real, irreplaceable user data** — see `CLAUDE.md`'s
opening warning. The migration strategy in this spec is designed
specifically to avoid data loss (SQLite's `ALTER TABLE` limitations mean
a primary-key change like this normally requires table recreation, which
Prisma's default migration generation would do in a way that drops data
unless hand-guided — see "Migration safety" below).

## Scope

In scope:
- A new `Collection` model: `id`, `name`, `isDefault` (exactly one row is
  ever `true`, enforced at the mutation layer — same pattern as Batch's
  "only one active batch," not a DB constraint), `createdAt`,
  `updatedAt @updatedAt`. Prisma's `@updatedAt` only bumps on a *direct*
  update to the `Collection` row itself — it does **not** cascade when a
  related `CollectionEntry` changes. So every function that writes a
  `CollectionEntry` (`incrementOwned`, `setOwned`, `approveBatch`'s merge,
  `importCollectionCsv`) must also issue a no-op-data update to its
  parent `Collection` row (`prisma.collection.update({ where: { id:
  collectionId }, data: {} })`) in the same operation, purely to trigger
  `@updatedAt` — needed by Phase 2's "date updated" column.
- `CollectionEntry` gains `collectionId`, and its identity becomes the
  composite `[collectionId, cardCode]` (replacing the current lone
  `cardCode @id`) — this is what allows the same card code to be owned
  independently across multiple collections.
- A data migration: create one `Collection` row (`name: "My Collection"`,
  `isDefault: true`), and every existing `CollectionEntry` row is
  backfilled with that collection's id. The user's real 209-card
  collection lands there automatically — no manual step, no data loss.
- A new `src/lib/collections.ts` with the `Collection` CRUD needed by
  both this phase (the default-lookup helper every retrofitted function
  needs) and Phase 2 (create/rename/delete/set-default, which Phase 2's
  UI will call — built now since they're pure data-layer logic with no
  UI dependency): `getDefaultCollectionId`, `listCollections`,
  `createCollection`, `renameCollection`, `deleteCollection` (rejects the
  default collection), `setDefaultCollection`.
- Every function in the 5 files that currently touch `CollectionEntry`
  (`src/lib/collection.ts`, `src/lib/cards.ts`, `src/lib/reports.ts`,
  `src/lib/decks.ts`, `src/actions/batchMutations.ts`) gets an explicit
  required `collectionId` parameter — see "Retrofit" below for the exact
  function list. Every caller of those functions (actions, API routes,
  server component pages) is updated to pass one — viewing pages/actions
  call `getDefaultCollectionId(prisma)` and pass the result through,
  preserving today's exact behavior.
- CSV import as a data-layer function, `importCollectionCsv` — no route
  or UI yet (Phase 2 adds those) — parses the same format
  `exportCollectionCsv` already produces and **replaces** a given
  collection's entries with what's in the file (matching this app's
  existing precedent: re-importing a deck replaces its card list, not
  merges into it). Unknown card codes or malformed quantities are skipped
  and reported back, not treated as a fatal error (matching `DeckCard`'s
  existing "unmatched code doesn't fail the whole operation" philosophy)
  — though unlike `DeckCard`, `CollectionEntry.cardCode` keeps its real FK
  to `Card` (a collection can only ever hold cards this app has actually
  imported), so an unknown code literally cannot be inserted and must be
  filtered out before the write, not merely flagged after.
- A real (not naive `split(',')`) CSV line parser, since exported titles
  can contain commas and quotes (e.g. `Kate "Mac" McCaffrey`) that the
  existing `csvEscape` already quotes/escapes on export — import must
  correctly reverse that.
- `exportCollectionCsv` and its route get the same `collectionId`
  parameter; the route itself keeps exporting the *default* collection
  in this phase (via `getDefaultCollectionId`) — Phase 2 parameterizes it
  further so any collection can be exported, not just the default.

Out of scope for this phase (all Phase 2):
- Any new page or UI — Collections list, action dropdown, delete
  confirmation, nav entry, CSV upload form/route.
- Exporting or importing a non-default collection (the route stays
  default-only until Phase 2 adds a way to pick which collection).
- Anything about *viewing* a non-default collection's dashboard/reports/
  set browser — per your clarification, "switching" is entirely "which
  collection is currently marked default," so there is no separate
  viewing-selection mechanism to build; Phase 2's "Set as Default" action
  *is* the switcher.

## Migration safety

Changing `CollectionEntry`'s primary key from a lone `cardCode @id` to a
composite `[collectionId, cardCode]` is a primary-key-affecting schema
change. SQLite doesn't support this via a simple `ALTER TABLE`; Prisma
handles it by recreating the table (create a new table with the new
shape, copy data across, drop the old one, rename). Prisma's
auto-generated migration for this kind of change has no way to know what
`collectionId` value existing rows should get — left alone, it would
either fail or silently drop the column's data.

The migration must therefore be **hand-sequenced**, not purely
auto-generated:

1. `CREATE TABLE "Collection" (...)`.
2. `INSERT INTO "Collection" (name, isDefault, ...) VALUES ('My Collection', 1, ...)`.
3. Create the new-shape `CollectionEntry` table (composite PK, FK to
   `Collection` with `ON DELETE CASCADE`, FK to `Card` unchanged).
4. Copy every existing `CollectionEntry` row into it, setting
   `collectionId` to the id of the row just inserted in step 2 (via a
   `(SELECT id FROM Collection WHERE isDefault = 1 LIMIT 1)` subquery, not
   a hardcoded id).
5. Drop the old table, rename the new one into place.

This is the same "12-step" table-recreation pattern Prisma itself
generates automatically for pure additive changes — the only difference
here is steps 1-2 (creating and seeding `Collection` first) and the
subquery in step 4 (data-preserving backfill) need to be written by hand
into the generated migration file rather than left to Prisma's default
generation, since Prisma has no way to infer "backfill from a row you
also want created in this same migration."

**Before this migration runs against the real database**, a full backup
(the same CSV-export mechanism already used ad hoc earlier this session)
must be taken as a safety net, independent of how carefully the migration
SQL itself is written.

## Retrofit — exact function list

Every function below gets a new required `collectionId: number` parameter
(exact insertion point — right after `prisma` — is an implementation
detail, but should be consistent across all of them to match this
codebase's existing `prisma`-first-param convention):

| File | Function | Touches `CollectionEntry`? |
|---|---|---|
| `src/lib/collection.ts` | `incrementOwned`, `setOwned`, `getOwnedQuantity`, `exportCollectionCsv` | Yes, all 4 |
| `src/lib/cards.ts` | `searchCards`, `listCardsInPack` | Yes, both |
| `src/lib/cards.ts` | `getOtherPrintings` | **No — unchanged**, confirmed no `collectionEntry` reference |
| `src/lib/reports.ts` | `computeSetCompletion`, `computeAllSetsCompletion`, `computeCollectionTotals`, `listCardsUnderExpectedQuantity` | Yes, all 4 |
| `src/lib/reports.ts` | `listUnsizedPacks`, `listPacksMissingImage` | **No — unchanged**, confirmed pure `Pack`/`Cycle` queries |
| `src/lib/decks.ts` | `computeDeckSummary` (internal), `getDecksWithOwnership`, `getDeckWithOwnership` | Yes, all 3 (only `computeDeckSummary` has the direct Prisma call; the other two just need to thread the parameter through) |
| `src/actions/batchMutations.ts` | `approveBatch` | Yes — the only one of this file's 7 exports that touches it |

And every caller of those functions, up to and including the point a
`collectionId` needs to be sourced from `getDefaultCollectionId(prisma)`:

- `src/actions/collectionMutations.ts` (`addToCollectionMutation`,
  `updateCollectionQuantityMutation`) and `src/actions/collectionActions.ts`
  (`addToCollection`, `updateCollectionQuantity`) — called from
  `CardBuilderForm.tsx` (Add / "0" reset) and `SetCardGrid.tsx` (quantity
  editor). The action layer resolves `getDefaultCollectionId(prisma)`.
- `src/actions/batchActions.ts`'s `approveBatch` wrapper — same pattern.
- `src/app/api/cards/search/route.ts` (`searchCards`) — resolves the
  default id per-request.
- `src/app/api/collection/export/route.ts` (`exportCollectionCsv`) —
  resolves the default id per-request (see Scope: stays default-only this
  phase).
- `src/app/page.tsx` (Dashboard: `computeAllSetsCompletion`,
  `computeCollectionTotals` — NOT `listUnsizedPacks`, which is unaffected).
- `src/app/sets/[packCode]/page.tsx` (Set browser: `computeSetCompletion`,
  `listCardsInPack`).
- `src/app/reports/under-owned-cards/page.tsx`
  (`listCardsUnderExpectedQuantity`).
- `src/app/decks/page.tsx` (`getDecksWithOwnership`) and
  `src/actions/deckActions.ts`'s `importDeck` (`getDeckWithOwnership`).

`src/app/api/cards/printings/route.ts` and
`src/app/reports/sets-missing-image/page.tsx` are **unaffected** —
confirmed neither of their underlying functions touches `CollectionEntry`.

## Test fixtures

11 existing test files reference `collectionEntry` (either testing one of
the retrofitted functions directly, or clearing the table in `beforeEach`
for FK-safe `Card` cleanup). Every one of them needs updating: any call
to `incrementOwned`/`setOwned`/`searchCards`/etc. needs a `collectionId`
argument added, and every `beforeEach` that does
`prisma.collectionEntry.deleteMany()` needs `prisma.collection.deleteMany()`
added too (in FK-safe order — `collectionEntry` before `collection`,
matching the existing `card`-before-`pack` ordering convention already in
these files).

A new test fixture helper, `seedCollection(prisma, options?)` in
`src/lib/testFixtures.ts`, creates a `Collection` row (defaulting to
`name: 'Test Collection'`, `isDefault: true`) and returns it — mirroring
`seedCard`'s existing shape and letting every test that currently seeds a
card and increments its ownership do the same one extra step to get a
`collectionId` to pass through.

## Interfaces

```ts
// src/lib/collections.ts
export interface CollectionSummary {
  id: number
  name: string
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

export async function getDefaultCollectionId(prisma: PrismaClient): Promise<number>
export async function listCollections(prisma: PrismaClient): Promise<CollectionSummary[]>
export async function createCollection(prisma: PrismaClient, name: string): Promise<number>
export async function renameCollection(prisma: PrismaClient, collectionId: number, name: string): Promise<void>
export async function deleteCollection(prisma: PrismaClient, collectionId: number): Promise<void>
export async function setDefaultCollection(prisma: PrismaClient, collectionId: number): Promise<void>

export interface ImportResult {
  imported: number
  skipped: { cardCode: string; reason: string }[]
}

export async function importCollectionCsv(
  prisma: PrismaClient,
  collectionId: number,
  csvText: string
): Promise<ImportResult>
```

`createCollection`/`renameCollection` reject an empty or whitespace-only
name (thrown error, matching this app's existing validation style, e.g.
`startBatch` rejecting a non-positive `expectedCount`). Names are **not**
required to be unique — two collections can share a name; nothing in this
app keys off name uniqueness.

`getDefaultCollectionId` throws a clear error if no default collection
exists — this should be unreachable in practice (the migration guarantees
exactly one at all times, and `deleteCollection` refuses to remove it),
so a thrown error here indicates a real invariant violation, not an
expected-and-handled case.

`deleteCollection` throws if the target is the current default (message
should be clear enough for Phase 2's UI to surface directly, e.g. "Cannot
delete the default collection"). `Collection` → `CollectionEntry` gets
`onDelete: Cascade` (matching `Batch` → `BatchCard`'s existing pattern),
so deleting a non-default collection cleanly removes its entries via the
DB — the mutation itself is just the guard check plus
`prisma.collection.delete(...)`.

`setDefaultCollection` is a single atomic `$transaction`: unset the
current default, set the new one — mirroring how this codebase already
handles "exactly one X" invariants (Batch's "only one active batch,"
enforced in application code, not a DB constraint).

## Testing

- `src/lib/collections.test.ts` (new) — full coverage of all 6 CRUD
  functions against a real seeded test DB: default-lookup, listing,
  create/rename/delete, delete-rejects-default, set-default correctly
  atomically swaps which row is `true`, and `importCollectionCsv`'s
  replace semantics (existing entries gone, new ones present), unknown
  card code skipped and reported, malformed quantity skipped and
  reported, and a round-trip test (`exportCollectionCsv` output fed
  straight into `importCollectionCsv` reproduces the same collection).
- Every one of the 11 existing test files gets its `collectionId`
  plumbing updated as described above — this is mechanical but touches
  every test in each of those files, not just a handful.
- No new component/page tests in this phase (no new UI).
