# Multi-Collection Support, Phase 2: UI — Design

## Overview

Phase 2 of two. Builds the user-facing feature on top of Phase 1's
foundation (`Collection` entity, every `CollectionEntry`-touching
function threaded with an explicit `collectionId`, all still implicitly
resolving "the default collection" everywhere today). Phase 2 adds:

- A Collections management page (`/collections`): create, rename,
  delete, set-default, export CSV, import CSV.
- A persistent nav indicator showing which collection is currently
  default.
- CSV import implemented as a **Batch** — reusing this app's existing
  stage-then-review-then-approve/discard mechanism — rather than a
  direct destructive write. This requires `Batch` itself to become
  collection-scoped, which is this phase's one real data-layer/migration
  task (mirroring Phase 1's `CollectionEntry` migration in shape and
  care, on a smaller table).

"Switching" collections remains exactly what Phase 1's spec already
settled: setting a different collection as default. There is no separate
mechanism to *view* a non-default collection's dashboard, reports, or set
browser — those all continue to operate on "the default collection,"
full stop. This phase's UI is entirely about managing the *set* of
collections and which one is default, not about viewing multiple
collections side by side.

## Scope

In scope:
- `Batch` gains a required `collectionId Int` (FK to `Collection`,
  `onDelete: Cascade`). "Only one active batch" becomes "only one active
  batch per collection," enforced the same way as today (an application-
  level check in `startBatch`, not a DB constraint — matching
  `Collection.isDefault`'s existing precedent).
- A hand-guided migration backfilling every existing real `Batch` row to
  the current default collection's id — same shape as Phase 1's Task 1
  (backup first, dry-run against a copy, verify row counts, apply to the
  real database only after the dry-run checks pass).
- `startBatch` and `getActiveBatch` gain a `collectionId` parameter.
  `addCardToBatch`, `pauseBatch`, `continueBatch`, and `discardBatch`
  are unchanged — they operate on a known `batchId` and don't merge
  data into a collection, so cross-collection mixups aren't a concern
  for them. `approveBatch` and `removeFromBatch` are different: a known
  `batchId` alone is *not* a sufficient safety guarantee once `Batch`
  became collection-scoped, since either could otherwise be pointed at
  a `batchId` belonging to some other collection while merging into (or
  mutating on behalf of) a caller-supplied `collectionId`. Both now
  verify `batch.collectionId` matches the given `collectionId` (via
  `findFirstOrThrow({ where: { id: batchId, collectionId } })`) before
  mutating anything, and `removeFromBatch` gained a `collectionId`
  parameter to make that check possible.
- The Builder page's own behavior is **unchanged**: it always resolves
  `getDefaultCollectionId(prisma)` and passes that into `startBatch`/
  `getActiveBatch`, so with one collection nothing about today's Builder
  experience is visibly different.
- CSV import as a new Batch-backed function, `importCsvAsBatch` (see
  below), replacing Phase 1's `importCollectionCsv` entirely.
- `/collections`: create (inline name field), list (name, distinct-card
  count, % owned, default badge), and per-row expand revealing Set as
  Default, inline-editable name, Export CSV, Import CSV, Delete, and —
  if that collection currently has an unreviewed batch — a "Pending
  review" resume affordance opening the same review UI.
- A nav-bar indicator (next to the Settings gear) showing the current
  default collection's name.
- `SettingsMenu` gains a "Collections" entry alongside "Configuration"
  and "Batch History".
- The CSV export route gains an optional `collectionId` query param
  (defaults to the default collection when omitted, preserving today's
  exact behavior for any existing bookmark/link).

Out of scope for this phase:
- Viewing a non-default collection's Dashboard, reports, or set browser.
- Deck ownership against anything but the default collection.
- Any notion of multiple simultaneously "active" *views* — there is
  still exactly one collection the whole read side of the app operates
  on at a time.

## Data model: `Batch.collectionId`

```prisma
model Batch {
  id            Int         @id @default(autoincrement())
  collectionId  Int
  collection    Collection  @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  name          String
  expectedCount Int
  status        String
  startedAt     DateTime    @default(now())
  elapsedMs     Int         @default(0)
  lastResumedAt DateTime?
  cards         BatchCard[]
}
```

`Collection` gains the inverse relation `batches Batch[]`.

## Migration safety

Same playbook as Phase 1's Task 1, scaled to a smaller table (batch
history, not the full card collection — still real data, still
irreplaceable, still treated with the same care):

1. Back up `data/netrunner.db` before touching anything.
2. Generate the migration skeleton, hand-edit it: create/seed nothing new
   (the default `Collection` row already exists from Phase 1) — just add
   `collectionId` to `Batch` via a table recreation, backfilling every
   existing row's `collectionId` to `(SELECT id FROM Collection WHERE
   isDefault = true LIMIT 1)`.
3. Dry-run against a copy of the real database first: verify the
   post-migration `Batch` row count matches the pre-migration count
   exactly, and every row's `collectionId` resolves to the real default
   collection's id (there is currently only one collection, so this
   should be unanimous).
4. Only apply to the real database after the dry-run checks pass.

## Data layer changes

### `src/actions/batchMutations.ts` / `src/lib/batches.ts`

```ts
export async function startBatch(prisma: PrismaClient, collectionId: number, expectedCount: number): Promise<number>
export async function getActiveBatch(prisma: PrismaClient, collectionId: number): Promise<BatchSummary | null>
```

`startBatch`'s existing "already active" check becomes
`where: { collectionId, status: { in: ['running', 'paused', 'stopped'] } }`
(currently has no `collectionId` filter at all). `getActiveBatch`'s query
gains the same filter. Every other function in these two files is
unchanged.

### `src/lib/collections.ts`

Phase 1's `importCollectionCsv` and its `ImportResult` type are
**deleted** — replaced entirely by:

```ts
export interface ImportBatchResult {
  batchId: number
  skipped: { cardCode: string; reason: string }[]
}

export async function importCsvAsBatch(
  prisma: PrismaClient,
  collectionId: number,
  csvText: string
): Promise<ImportBatchResult>
```

Reuses the existing `parseCsv` line-parser and the same per-row
validation Phase 1 already had (unknown card code → skipped + reported;
non-integer or negative quantity → skipped + reported). Writes the
result as one `$transaction`:

- One `Batch` row: `collectionId`, `name` formatted the same way
  `startBatch`'s `formatBatchName` does but with an `Import` prefix
  (e.g. `Import 2026-08-09 14:32`), `expectedCount` = sum of all valid
  rows' quantities, `status: 'stopped'` directly (the count is already
  fully known — there's nothing to auto-stop toward), `elapsedMs: 0`,
  `lastResumedAt: null`.
- One `createMany` for every valid row as a `BatchCard`.
- The same "only one active batch per collection" check `startBatch`
  uses, applied here too — importing into a collection that already has
  an active batch throws the same "already active" error rather than
  creating a second one.

Also gains a list-page aggregate:

```ts
export interface CollectionListEntry extends CollectionSummary {
  ownedCards: number
  totalCards: number
  percentOwned: number
  pendingBatch: BatchSummary | null
}

export async function listCollectionsWithStats(prisma: PrismaClient): Promise<CollectionListEntry[]>
```

Composes `listCollections` with a per-collection `computeCollectionTotals`
and `getActiveBatch` call. This is an N+1 pattern (one extra pair of
queries per collection) — acceptable at this app's personal-collection
scale, consistent with the same accepted pattern already in
`computeAllSetsCompletion`.

### `src/app/api/collection/export/route.ts`

```ts
export async function GET(request: NextRequest) {
  const collectionIdParam = request.nextUrl.searchParams.get('collectionId')
  const collectionId = collectionIdParam ? Number(collectionIdParam) : await getDefaultCollectionId(prisma)
  const csv = await exportCollectionCsv(prisma, collectionId)
  // ... unchanged below
}
```

Omitting the param preserves today's exact behavior (exports the
default collection) — no existing link or bookmark breaks.

### `src/actions/collectionActions.ts`

New actions, alongside Phase 1's existing `addToCollection`/
`updateCollectionQuantity`:

```ts
export async function createCollection(name: string): Promise<{ ok: true; id: number } | { ok: false; error: string }>
export async function renameCollection(collectionId: number, name: string): Promise<SimpleActionResult>
export async function deleteCollection(collectionId: number): Promise<SimpleActionResult>
export async function setDefaultCollection(collectionId: number): Promise<SimpleActionResult>
export async function importCsvToCollection(
  collectionId: number,
  csvText: string
): Promise<{ ok: true; batch: BatchSummary; skipped: { cardCode: string; reason: string }[] } | { ok: false; error: string }>
export async function approveImportBatch(collectionId: number, batchId: number): Promise<SimpleActionResult>
```

`approveImportBatch` calls the same `approveBatchMutation` (from
`./batchMutations`, already `collectionId`-aware since Phase 1) that
`batchActions.ts`'s existing `approveBatch` action calls — only the
action-layer wrapper is new, not the underlying mutation. It's kept
distinct from the existing Builder-only `batchActions.ts`'s `approveBatch`
(which stays untouched, still resolving `getDefaultCollectionId`
internally, still only ever called from `BatchBuilderForm`) — the two
flows are kept genuinely independent rather than threading an extra
parameter through the Builder's existing path to serve a second caller,
matching this codebase's established precedent of Simple/Batch builder
forms as two independent components rather than one with branching.
`discardBatch` needs no new variant — the existing `batchActions.ts`
version is already purely `batchId`-scoped and is reused as-is for
discarding an import batch.

Every action here follows the existing `try/catch → { ok, error }`
convention already established in `batchActions.ts`/`collectionActions.ts`.

## Navigation and the active-collection indicator

- `SettingsMenu.tsx` gains a third `Link` to `/collections`, labeled
  "Collections", between "Configuration" and "Batch History".
- `RootLayout` (`src/app/layout.tsx`) resolves the default collection's
  name server-side (via `getDefaultCollectionId` + a name lookup) and
  renders it as a small text label next to `SettingsMenu`. Server
  component, so it's always current on navigation — no client-side
  polling needed, since a collection switch only happens via a full
  Server Action round-trip (`setDefaultCollection`) that revalidates the
  layout.

## `/collections` page

- **Create:** an inline name text input + "Create" button above the
  list, calling `createCollection`. Matches this app's existing
  lightweight inline-input style (e.g. Settings' set-name filter).
- **List:** one row per collection from `listCollectionsWithStats`,
  showing name, `${ownedCards} / ${totalCards} owned (${percentOwned}%)`,
  and a "Default" badge on whichever one `isDefault`. Click a row to
  expand — same accordion pattern as Batch History
  (`BatchHistoryList.tsx`).
- **Expanded row:**
  - **Set as Default** button — disabled/hidden if this row is already
    default.
  - Name shown as an inline-editable text field with a "Save" button
    (calls `renameCollection`).
  - **Export CSV** — a link to `/api/collection/export?collectionId=<id>`.
  - **Import CSV** — a file picker + "Import" button. On success (calls
    `importCsvToCollection`), opens `BatchReviewModal` pre-loaded with
    the returned batch's cards, with a "N rows skipped" list rendered
    above the modal when `skipped.length > 0` (each entry: card code +
    reason, reusing the exact shape Phase 1's skipped-row reporting
    already used).
  - **Delete** — inline two-step confirm ("Are you sure? Yes / Cancel"),
    disabled/hidden if this row is the default collection (matches
    `deleteCollection`'s existing guard).
  - **Pending review** — if `pendingBatch` is non-null (an import
    created a batch that was never approved/discarded, e.g. the modal
    was closed), a "Pending review — Resume" affordance reopens
    `BatchReviewModal` for that batch. This is what keeps a
    non-default collection's in-progress batch from being stranded: the
    existing rule ("an active batch can never be stranded — always
    reachable") already holds for the default collection via `/builder`
    itself; `/collections` becomes the equivalent home for every other
    collection's in-progress batch.

## CSV import review flow

`BatchReviewModal` (`src/app/builder/BatchReviewModal.tsx`) is already a
fully decoupled, presentational component (`batchName`, `cards`,
`isSubmitting`, `onDiscard`, `onApprove`, `onRemoveCard`, `onClose` — no
internal data fetching or Builder-specific coupling), so it's reused
as-is from the Collections page's client component, wired to
`approveImportBatch`/`discardBatch`/`removeFromBatch` instead of the
Builder's own action set. No changes to `BatchReviewModal` itself are
needed.

Because a CSV-import batch is created directly in `'stopped'` status,
and `'stopped'` is already one of `getActiveBatch`'s active statuses,
importing into the **default** collection surfaces the exact same
"batch complete, review it" experience on `/builder` that finishing a
manual batch already produces — no special-casing required, it falls
out of reusing the existing mechanism.

## Interfaces summary

```ts
// src/lib/collections.ts
export interface ImportBatchResult {
  batchId: number
  skipped: { cardCode: string; reason: string }[]
}
export async function importCsvAsBatch(prisma: PrismaClient, collectionId: number, csvText: string): Promise<ImportBatchResult>

export interface CollectionListEntry extends CollectionSummary {
  ownedCards: number
  totalCards: number
  percentOwned: number
  pendingBatch: BatchSummary | null
}
export async function listCollectionsWithStats(prisma: PrismaClient): Promise<CollectionListEntry[]>

// src/lib/batches.ts
export async function getActiveBatch(prisma: PrismaClient, collectionId: number): Promise<BatchSummary | null>

// src/actions/batchMutations.ts
export async function startBatch(prisma: PrismaClient, collectionId: number, expectedCount: number): Promise<number>

// src/actions/collectionActions.ts (new)
export async function createCollection(name: string): Promise<{ ok: true; id: number } | { ok: false; error: string }>
export async function renameCollection(collectionId: number, name: string): Promise<SimpleActionResult>
export async function deleteCollection(collectionId: number): Promise<SimpleActionResult>
export async function setDefaultCollection(collectionId: number): Promise<SimpleActionResult>
export async function importCsvToCollection(collectionId: number, csvText: string): Promise<{ ok: true; batch: BatchSummary; skipped: { cardCode: string; reason: string }[] } | { ok: false; error: string }>
export async function approveImportBatch(collectionId: number, batchId: number): Promise<SimpleActionResult>
```

`createCollection`/`renameCollection` reject an empty or whitespace-only
name (already implemented in Phase 1's `collections.ts`, unchanged
here). `deleteCollection` throws if the target is the current default
(already implemented). Names are still not required to be unique.

## Testing

- `src/lib/collections.test.ts`: drop `importCollectionCsv`'s tests, add
  `importCsvAsBatch` coverage (valid rows batched correctly, unknown
  codes/malformed quantities skipped and reported, `status: 'stopped'`
  and correct `expectedCount` on the created batch, rejects when the
  target collection already has an active batch, round-trip via
  `exportCollectionCsv` → `importCsvAsBatch` → `approveImportBatch` →
  totals match). Add `listCollectionsWithStats` coverage (stats correct
  per collection, `pendingBatch` reflects an unreviewed import,
  `pendingBatch` is null after approve/discard).
- `src/actions/batchMutations.test.ts` and `src/lib/batches.test.ts`
  (and their fixtures): thread `collectionId` through every call the
  same mechanical way every Phase 1 test file already was. Add coverage
  for "one active batch per collection" (two different collections can
  each have their own active batch simultaneously; starting a second
  batch in the *same* collection while one's active still rejects).
- New component tests: `/collections` page (create, expand/collapse,
  set-default, inline rename, delete confirm two-step, import →
  BatchReviewModal → approve/discard, pending-review resume), the nav
  indicator (shows the current default's name, updates after
  `setDefaultCollection`).
- The `Batch.collectionId` migration gets the same data-correctness
  verification Phase 1's Task 1 used (row counts match, not `npm test`)
  in its own isolated, first-reviewed task.
