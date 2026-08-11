# Collections Drag-and-Drop Reorder — Design

## Overview

The Collections page (`/collections`) lists every `Collection` in a fixed
`createdAt` order today. This adds manual reordering: drag a collection to
a new position in the list, and that order persists and is used everywhere
collections are listed — the `/collections` page itself and the
`CollectionSwitcher` dropdown on the dashboard.

## Scope

In scope:
- A `sortOrder` column on `Collection`, driving ordering in `listCollections`
  (and therefore `listCollectionsWithStats`, which calls it).
- A `reorderCollections` mutation/action, called when a drag-and-drop
  reorder completes.
- Drag-and-drop UI in `CollectionsList.tsx`'s `CollectionRow`, using native
  HTML5 DnD (no new dependency — this project currently has zero UI
  dependencies beyond Next/React/Tailwind, and native DnD covers the
  desktop-mouse use case this app is built for).
- New collections append at the end of the current order, not the front.

Out of scope:
- Keyboard-driven reordering. Native HTML5 DnD has no keyboard path, and
  this is a personal single-user tool — not pursuing a
  library swap or a parallel keyboard implementation just for this.
- Touch/mobile drag support. Native HTML5 DnD's touch behavior is weak;
  acceptable here since this app targets desktop use.
- Pinning the default collection to the top of the list — reordering is
  independent of `isDefault`; the default collection can be dragged
  anywhere.
- Reverting the local reorder if the persist call fails (see Action
  section) — matches this app's existing lightweight-error-handling style
  elsewhere in `CollectionsList`.

## Data model

Add to the `Collection` model in `prisma/schema.prisma`:

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

`listCollections` (`src/lib/collections.ts`) changes its `orderBy` from
`{ createdAt: 'asc' }` to `[{ sortOrder: 'asc' }, { createdAt: 'asc' }]`.
Every existing row defaults to `sortOrder: 0`, so the `createdAt` tiebreak
means **no backfill migration is needed** — display order is unchanged
until a user actually drags something.

`createCollection` sets the new row's `sortOrder` explicitly to
`(current max sortOrder across all collections) + 1` (query
`prisma.collection.aggregate({ _max: { sortOrder: true } })` before the
`create`), so a new collection always appends after every existing one —
including ones a user has already manually reordered — rather than
defaulting to `0` and jumping to the front.

## Mutation

Append to `src/lib/collections.ts`:

```ts
export async function reorderCollections(prisma: PrismaClient, orderedIds: number[]): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.collection.update({ where: { id }, data: { sortOrder: index } }))
  )
}
```

Mirrors `setDefaultCollection`'s existing `$transaction`-of-updates shape.
`orderedIds` is the full list of collection ids in their new display
order — the caller (the action below) always passes every id, since the
UI reorders the complete list it already has in memory.

## Action

Append to `src/actions/collectionActions.ts`:

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

(`reorderCollectionsMutation` the aliased import, matching this file's
existing `X as XMutation` convention.) `revalidatePath('/', 'layout')` is
what propagates the new order to the dashboard's `CollectionSwitcher`,
same as `setDefaultCollection` already does for its own change.

`CollectionsList` applies the reorder to its local `collections` state
immediately on drop (optimistic), then calls this action. On
`{ ok: false }`, the error is surfaced the same way name/delete errors
already are on this page (a `text-danger` message) — the local reorder is
**not** rolled back; a mismatch self-corrects on next page load.

## Components

`src/app/collections/CollectionsList.tsx` (modified):

- New state in `CollectionsList`: `draggedId: number | null` and
  `dropTargetId: number | null`.
- New handler `handleReorder(fromId: number, toId: number)`: computes the
  reordered `collections` array (move `fromId` to `toId`'s position),
  calls `setCollections` with it, and fires `reorderCollections(newOrder.map(c => c.id))`,
  setting a `reorderError` string state on `{ ok: false }`.
- `CollectionRow` gains a drag-handle icon (small grip/dots SVG) placed to
  the *left* of the existing toggle button — a sibling, not nested inside
  it, so dragging never fights with the accordion-toggle click or the
  buttons rendered when the row is open. Only this handle element carries
  `draggable={true}`.
- Handle's `onDragStart`: `setDraggedId(collection.id)`.
- The `<li>` itself gets `onDragOver` (calls `preventDefault()`, sets
  `dropTargetId` to this row's id) and `onDrop` (calls
  `handleReorder(draggedId, collection.id)`, then clears both ids).
- Handle's `onDragEnd`: clears `draggedId`/`dropTargetId` unconditionally
  (covers a drag cancelled outside any valid drop target).
- Visual feedback: the dragged row renders at reduced opacity
  (`opacity-50`) while `draggedId === collection.id`; the current
  drop-target row gets a top border highlight
  (`border-t-2 border-accent`) while `dropTargetId === collection.id`.

## Testing

- `src/lib/collections.test.ts` (extended):
  - `reorderCollections` persists the given order; `listCollections` and
    `listCollectionsWithStats` reflect it afterward.
  - `createCollection` after a manual reorder appends the new collection
    at the end rather than sorting first.
  - Existing (never-reordered) collections keep their original
    `createdAt` order from `listCollections` (tiebreak works).
- `src/app/collections/CollectionsList.test.tsx` (extended): simulate
  `dragStart` on one row's handle, `dragOver` + `drop` on another row, and
  assert (a) the rendered row order updates and (b) `reorderCollections`
  is called with the resulting id sequence in order.
