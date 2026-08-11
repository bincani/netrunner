# Collections Drag-and-Drop Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag collections into a custom order on `/collections`, persisted and reflected everywhere collections are listed (the Collections page and the dashboard's `CollectionSwitcher`).

**Architecture:** A `sortOrder` column on `Collection` drives ordering in `listCollections`, with a `createdAt` tiebreak so no backfill is needed — every existing row defaults to `sortOrder: 0` and keeps its current creation-order display until reordered. A `reorderCollections` mutation/action persists a full new id order in one transaction. `CollectionsList.tsx` implements the drag interaction with native HTML5 DnD (no new dependency) via a dedicated drag-handle icon per row, separate from the existing accordion-toggle button.

**Tech Stack:** Next.js (App Router) client components, Prisma/SQLite, Tailwind CSS, Vitest + React Testing Library.

## Global Constraints

- `Collection.sortOrder`: `Int @default(0)`. Ordering everywhere collections are listed is `orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]`.
- No backfill migration — the `createdAt` tiebreak preserves existing display order for rows still at the default `sortOrder: 0`.
- `createCollection` sets the new row's `sortOrder` to `(current max sortOrder across all collections) + 1`, so new collections always append at the end, even after existing ones have been manually reordered.
- `reorderCollections(prisma, orderedIds: number[])` sets `sortOrder` to each id's index in `orderedIds`, via a `$transaction` of per-row `update` calls (mirrors `setDefaultCollection`'s existing shape).
- The `reorderCollections` server action revalidates both `/collections` and `/` (`layout`) — the dashboard's `CollectionSwitcher` must pick up the new order too.
- The client applies a reorder to local state **immediately and optimistically** on drop, then calls the action. On `{ ok: false }`, the error is shown inline (same `text-danger` pattern as this page's other errors) and the local reorder is **not** rolled back.
- Drag-and-drop UI uses **native HTML5 DnD** (`draggable`, `onDragStart`/`onDragOver`/`onDrop`/`onDragEnd`) — this project has zero UI dependencies beyond Next/React/Tailwind and this doesn't add one.
- The drag handle is a **separate element**, a sibling of the existing accordion-toggle `<button>` — not the whole row — so dragging never conflicts with the toggle click or the buttons revealed when a row is open.
- Out of scope: keyboard-driven reordering, touch/mobile drag support, pinning the default collection to the top. The default collection can be dragged anywhere.
- Spec: `docs/superpowers/specs/2026-08-11-collections-drag-and-drop-reorder-design.md`.

---

### Task 1: `sortOrder` column and migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces (used by Task 2): a `sortOrder Int @default(0)` field on `Collection`.

- [ ] **Step 1: Confirm the baseline test suite passes**

Run: `npm test`
Expected: PASS (baseline, before any changes).

- [ ] **Step 2: Add the column to the schema**

In `prisma/schema.prisma`, change the `Collection` model from:

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

to:

```prisma
model Collection {
  id        Int               @id @default(autoincrement())
  name      String
  isDefault Boolean           @default(false)
  sortOrder Int               @default(0)
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  entries   CollectionEntry[]
  batches   Batch[]
}
```

- [ ] **Step 3: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_collection_sort_order`

This creates `prisma/migrations/<timestamp>_add_collection_sort_order/migration.sql`, applies it to `data/netrunner.db` (the user's real collection database — this is a purely additive `ALTER TABLE ... ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0`, it does not touch any existing `Collection`, `CollectionEntry`, or `Batch` row's existing data), and regenerates the Prisma client.

Expected: the command reports the migration applied successfully; `prisma/migrations/<timestamp>_add_collection_sort_order/migration.sql` exists and contains an `ALTER TABLE "Collection" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;` statement.

- [ ] **Step 4: Confirm the test suite still passes**

Run: `npm test`
Expected: PASS — `src/lib/testDb.ts` uses `prisma db push` against a fresh temp database per test run, so it picks up the schema change automatically; no test yet references `sortOrder`, so behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add sortOrder column to Collection"
```

---

### Task 2: Data layer — ordering, append-on-create, `reorderCollections`

**Files:**
- Modify: `src/lib/collections.ts`
- Modify: `src/lib/collections.test.ts`
- Modify: `src/actions/collectionActions.ts`

**Interfaces:**
- Consumes: `Collection.sortOrder` (Task 1).
- Produces (used by Task 3): `reorderCollections(orderedIds: number[]): Promise<SimpleActionResult>` exported from `@/actions/collectionActions` (`SimpleActionResult` already exists in that file).

- [ ] **Step 1: Write the failing tests**

In `src/lib/collections.test.ts`, change the import from `./collections` from:

```ts
import {
  getDefaultCollection,
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

to:

```ts
import {
  getDefaultCollection,
  getDefaultCollectionId,
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvAsBatch,
  listCollectionsWithStats,
  reorderCollections,
} from './collections'
```

Add a new test inside the existing `describe('listCollections', ...)` block (after the `'lists every collection, oldest first'` test):

```ts
  it('orders by sortOrder ascending once reordered, breaking ties by createdAt for anything not yet touched', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    const c = await seedCollection(prisma, { name: 'C', isDefault: false })

    await reorderCollections(prisma, [c.id, a.id, b.id])

    const collections = await listCollections(prisma)
    expect(collections.map((coll) => coll.name)).toEqual(['C', 'A', 'B'])
  })
```

Add a new test inside the existing `describe('createCollection', ...)` block:

```ts
  it('appends after every existing collection, even ones already reordered ahead of it', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await reorderCollections(prisma, [b.id, a.id])

    const id = await createCollection(prisma, 'C')

    const collections = await listCollections(prisma)
    expect(collections.map((coll) => coll.name)).toEqual(['B', 'A', 'C'])
    expect(collections[2].id).toBe(id)
  })
```

Add a new `describe` block at the end of the file, after `describe('listCollectionsWithStats', ...)`:

```ts
describe('reorderCollections', () => {
  it('persists the given order', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })

    await reorderCollections(prisma, [b.id, a.id])

    const collections = await listCollections(prisma)
    expect(collections.map((coll) => coll.name)).toEqual(['B', 'A'])
  })

  it('is reflected by listCollectionsWithStats too', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })

    await reorderCollections(prisma, [b.id, a.id])

    const list = await listCollectionsWithStats(prisma)
    expect(list.map((coll) => coll.name)).toEqual(['B', 'A'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: FAIL — `reorderCollections` is not exported from `./collections`.

- [ ] **Step 3: Write the implementation**

In `src/lib/collections.ts`, change `listCollections` from:

```ts
export async function listCollections(prisma: PrismaClient): Promise<CollectionSummary[]> {
  const collections = await prisma.collection.findMany({ orderBy: { createdAt: 'asc' } })
  return collections.map(toSummary)
}
```

to:

```ts
export async function listCollections(prisma: PrismaClient): Promise<CollectionSummary[]> {
  const collections = await prisma.collection.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return collections.map(toSummary)
}
```

Change `createCollection` from:

```ts
export async function createCollection(prisma: PrismaClient, name: string): Promise<number> {
  const collection = await prisma.collection.create({ data: { name: validateName(name), isDefault: false } })
  return collection.id
}
```

to:

```ts
export async function createCollection(prisma: PrismaClient, name: string): Promise<number> {
  const maxSortOrder = await prisma.collection.aggregate({ _max: { sortOrder: true } })
  const collection = await prisma.collection.create({
    data: { name: validateName(name), isDefault: false, sortOrder: (maxSortOrder._max.sortOrder ?? 0) + 1 },
  })
  return collection.id
}
```

Add a new function right after `setDefaultCollection`:

```ts
export async function reorderCollections(prisma: PrismaClient, orderedIds: number[]): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.collection.update({ where: { id }, data: { sortOrder: index } }))
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/collections.test.ts`
Expected: PASS (all existing tests plus the 4 new ones).

- [ ] **Step 5: Add the server action**

In `src/actions/collectionActions.ts`, change the import from `@/lib/collections` from:

```ts
import {
  getDefaultCollectionId,
  createCollection as createCollectionMutation,
  renameCollection as renameCollectionMutation,
  deleteCollection as deleteCollectionMutation,
  setDefaultCollection as setDefaultCollectionMutation,
  importCsvAsBatch,
  type CollectionListEntry,
} from '@/lib/collections'
```

to:

```ts
import {
  getDefaultCollectionId,
  createCollection as createCollectionMutation,
  renameCollection as renameCollectionMutation,
  deleteCollection as deleteCollectionMutation,
  setDefaultCollection as setDefaultCollectionMutation,
  reorderCollections as reorderCollectionsMutation,
  importCsvAsBatch,
  type CollectionListEntry,
} from '@/lib/collections'
```

Then append this function right after `setDefaultCollection`:

```ts
export async function reorderCollections(orderedIds: number[]): Promise<SimpleActionResult> {
  try {
    await reorderCollectionsMutation(prisma, orderedIds)
    revalidatePath('/collections')
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}
```

No new test file for this action — matches this file's existing convention (`setDefaultCollection`'s action wrapper has no dedicated test either; the substantive logic lives in and is tested by `collections.test.ts`, and `collectionActions.test.ts` is reserved for the collection-scoped batch actions that have real cross-collection scoping bugs to guard against).

- [ ] **Step 6: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/collections.ts src/lib/collections.test.ts src/actions/collectionActions.ts
git commit -m "Add reorderCollections mutation/action, order collections by sortOrder"
```

---

### Task 3: Drag-and-drop UI in `CollectionsList`

**Files:**
- Modify: `src/app/collections/CollectionsList.tsx`
- Modify: `src/app/collections/CollectionsList.test.tsx`

**Interfaces:**
- Consumes: `reorderCollections(orderedIds: number[]): Promise<SimpleActionResult>` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `src/app/collections/CollectionsList.test.tsx`, change the mock import list from:

```ts
import {
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvToCollection,
  approveImportBatch,
  removeFromImportBatch,
} from '@/actions/collectionActions'
```

to:

```ts
import {
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvToCollection,
  approveImportBatch,
  removeFromImportBatch,
  reorderCollections,
} from '@/actions/collectionActions'
```

and the `vi.mock('@/actions/collectionActions', ...)` factory from:

```ts
vi.mock('@/actions/collectionActions', () => ({
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
  setDefaultCollection: vi.fn(),
  importCsvToCollection: vi.fn(),
  approveImportBatch: vi.fn(),
  removeFromImportBatch: vi.fn(),
}))
```

to:

```ts
vi.mock('@/actions/collectionActions', () => ({
  createCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
  setDefaultCollection: vi.fn(),
  importCsvToCollection: vi.fn(),
  approveImportBatch: vi.fn(),
  removeFromImportBatch: vi.fn(),
  reorderCollections: vi.fn(),
}))
```

Also change the top import from `@testing-library/react` from:

```ts
import { render, screen, waitFor } from '@testing-library/react'
```

to:

```ts
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
```

Then append this new `describe` block at the end of the file, inside the outer `describe('CollectionsList', ...)` block (i.e. before its final closing `})`):

```ts
  describe('drag-and-drop reorder', () => {
    it('dragging a handle onto another row reorders the list and persists the new order', async () => {
      vi.mocked(reorderCollections).mockResolvedValue({ ok: true })
      const { container } = render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

      const handle = screen.getByRole('button', { name: 'Reorder My Collection' })
      const targetRow = screen.getByRole('button', { name: 'Reorder Trade Binder' }).closest('li')
      if (!targetRow) throw new Error('target row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(targetRow)
      fireEvent.drop(targetRow)

      const names = Array.from(container.querySelectorAll('li')).map(
        (li) => li.querySelector('.font-medium')?.textContent
      )
      expect(names).toEqual(['Trade Binder', 'My Collection'])
      expect(reorderCollections).toHaveBeenCalledWith([2, 1])
    })

    it('shows an error and keeps the reordered list if persisting fails', async () => {
      vi.mocked(reorderCollections).mockResolvedValue({ ok: false, error: 'Something went wrong' })
      const { container } = render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

      const handle = screen.getByRole('button', { name: 'Reorder My Collection' })
      const targetRow = screen.getByRole('button', { name: 'Reorder Trade Binder' }).closest('li')
      if (!targetRow) throw new Error('target row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(targetRow)
      fireEvent.drop(targetRow)

      expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
      const names = Array.from(container.querySelectorAll('li')).map(
        (li) => li.querySelector('.font-medium')?.textContent
      )
      expect(names).toEqual(['Trade Binder', 'My Collection'])
    })

    it('dropping a handle on its own row does not reorder or call reorderCollections', () => {
      render(<CollectionsList initialCollections={[defaultCollection, secondCollection]} />)

      const handle = screen.getByRole('button', { name: 'Reorder My Collection' })
      const ownRow = handle.closest('li')
      if (!ownRow) throw new Error('own row not found')

      fireEvent.dragStart(handle)
      fireEvent.dragOver(ownRow)
      fireEvent.drop(ownRow)

      expect(reorderCollections).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/collections/CollectionsList.test.tsx`
Expected: FAIL — there is no element with accessible name `'Reorder My Collection'` yet.

- [ ] **Step 3: Write the implementation**

In `src/app/collections/CollectionsList.tsx`, change the actions import from:

```ts
import {
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvToCollection,
  approveImportBatch,
  removeFromImportBatch,
} from '@/actions/collectionActions'
```

to:

```ts
import {
  createCollection,
  renameCollection,
  deleteCollection,
  setDefaultCollection,
  importCsvToCollection,
  approveImportBatch,
  removeFromImportBatch,
  reorderCollections,
} from '@/actions/collectionActions'
```

Change the `CollectionsList` function from:

```tsx
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
```

to:

```tsx
export function CollectionsList({ initialCollections }: { initialCollections: CollectionListEntry[] }) {
  const [collections, setCollections] = useState<CollectionListEntry[]>(initialCollections)
  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [draggedId, setDraggedId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [reorderError, setReorderError] = useState<string | null>(null)

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

  function handleDrop(targetId: number) {
    const sourceId = draggedId
    setDraggedId(null)
    setDropTargetId(null)
    if (sourceId === null || sourceId === targetId) return

    const fromIndex = collections.findIndex((c) => c.id === sourceId)
    const toIndex = collections.findIndex((c) => c.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return

    const reordered = [...collections]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    setCollections(reordered)
    setReorderError(null)

    reorderCollections(reordered.map((c) => c.id)).then((result) => {
      if (!result.ok) setReorderError(result.error)
    })
  }

  return (
    <div className="space-y-6">
```

Change the `createError` block and the `<ul>` that follows it from:

```tsx
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
```

to:

```tsx
      {createError && (
        <p className="text-sm text-danger" role="alert">
          {createError}
        </p>
      )}
      {reorderError && (
        <p className="text-sm text-danger" role="alert">
          {reorderError}
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
            isDragging={draggedId === collection.id}
            isDropTarget={dropTargetId === collection.id}
            onDragStart={() => setDraggedId(collection.id)}
            onDragOver={() => setDropTargetId(collection.id)}
            onDrop={() => handleDrop(collection.id)}
            onDragEnd={() => {
              setDraggedId(null)
              setDropTargetId(null)
            }}
          />
        ))}
      </ul>
    </div>
  )
}
```

Change the `CollectionRow` signature from:

```tsx
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
```

to:

```tsx
function CollectionRow({
  collection,
  isOpen,
  onToggle,
  onUpdate,
  onSetDefault,
  onRemove,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  collection: CollectionListEntry
  isOpen: boolean
  onToggle: () => void
  onUpdate: (patch: Partial<CollectionListEntry>) => void
  onSetDefault: () => void
  onRemove: () => void
  isDragging: boolean
  isDropTarget: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}) {
```

Change the start of `CollectionRow`'s returned JSX from:

```tsx
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
```

to:

```tsx
  return (
    <li
      className={`rounded border border-default ${isDropTarget ? 'border-t-2 border-t-accent' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
    >
      <div className={`flex items-center gap-1 ${isDragging ? 'opacity-50' : ''}`}>
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          role="button"
          aria-label={`Reorder ${collection.name}`}
          className="shrink-0 cursor-grab px-2 text-faint select-none hover:text-primary"
        >
          ⠿
        </span>
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
      </div>

      {isOpen && (
```

The rest of `CollectionRow` (the `isOpen` block, the `reviewBatch` block, and the closing `</li>`) is unchanged — the new drag-handle `<span>` and toggle `<button>` are now siblings inside a wrapping `<div>`, and that `<div>` is itself a sibling of the `{isOpen && (...)}` block within the same `<li>`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/collections/CollectionsList.test.tsx`
Expected: PASS (all existing tests plus the 3 new ones).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/collections/CollectionsList.tsx src/app/collections/CollectionsList.test.tsx
git commit -m "Add drag-and-drop reordering to the Collections list"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check against real local data**

Native HTML5 drag-and-drop cannot be reliably driven by synthetic/scripted mouse events — this step needs an actual mouse-drag in a real browser (by the user, or by a subagent that has a browser automation tool capable of native OS-level drag, not just click simulation). If neither is available in this environment, hand this step back to the user with the same instructions rather than skipping or faking verification.

Run `npm run dev`, wait for it to serve, then:
- Open `/collections`. If there is only one collection today, create one or two extra collections first (e.g. "Test Order A", "Test Order B") so there's something to reorder — you can delete them again afterward, they're new/empty and safe to remove.
- Drag a collection's grip handle (to the left of its name) and drop it onto a different row. Confirm the list re-renders in the new order immediately.
- Reload the page. Confirm the new order persisted (this proves the server round-trip, not just client state).
- Go to `/` (the dashboard) and open the `CollectionSwitcher` (the icon near the collection name). Confirm the dropdown's collection order matches the new order from `/collections`.
- If you created any test-only collections for this check, delete them from `/collections` now (Delete requires the two-step confirm already in place) so the real collection list is left as it was, other than any order changes you intend to keep.

- [ ] **Step 4: Commit (only if manual checks required a fix)**

If Step 3 surfaced no issues, there is nothing to commit for this task — Task 3's commit already covers the working feature.
