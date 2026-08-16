# Quick Add Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "⚡" icon per set on the dashboard that lets the user instantly mark a known-complete set as owned (Quick Add) or zero it out (Clear Set), each followed by a one-click ephemeral Undo restoring exact prior per-card quantities.

**Architecture:** A new `src/lib/quickSet.ts` computes and applies the bulk `CollectionEntry` change for a whole pack in one atomic transaction, returning a snapshot of what changed for undo. A new `QuickAddSetModal` (client component, calls the new actions directly) presents the confirmation/warning copy and the two-step Clear Set confirm. `SetProgressList` gains the icon, tracks the single most-recent action for its row-scoped Undo line, and is restructured so the icon and Undo controls sit outside the existing whole-row `<Link>` (a button nested inside an `<a>` is invalid HTML and would also trigger navigation on click).

**Tech Stack:** Next.js (App Router) + TypeScript, SQLite via Prisma, Tailwind CSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-quick-add-set-design.md`

## Global Constraints

- Every function touching `CollectionEntry` takes `collectionId` as an explicit early parameter (right after `prisma`); resolve it via `getDefaultCollectionId`/an already-resolved `collection.id` — never inline a default-collection lookup.
- No semicolons, single quotes, 2-space indent — match the existing codebase style exactly.
- Thin `'use server'` action-wrapper files are not unit-tested directly unless they contain real transformation logic of their own (corrected convention — see `docs/superpowers/plans/2026-08-14-discover-decks.md`'s Global Constraints for the full history). `quickSetActions.ts` is a pure pass-through, so it is exercised only via `QuickAddSetModal.test.tsx`'s mock of it, not its own test file.
- **`data/netrunner.db` holds the user's real physical collection.** This feature can bulk-raise or bulk-zero real owned quantities. Any manual/dev-server verification must use a specific, small, already-noted set — record its exact `ownedCount`/`totalCount` before touching anything, and end the verification by restoring that exact state (via Undo or by re-running the opposite action), never leaving the real collection altered. Never assume any existing `CollectionEntry` row is disposable.
- Never lower a card's owned quantity below what it already is when Quick Add runs (only raises up to the printed quantity if currently lower).
- `touchCollection` (`src/lib/collections.ts`) bumps a collection's `updatedAt` — include it in the same transaction as any `CollectionEntry` writes, matching `incrementOwned`/`setOwned`'s existing pattern in `src/lib/collection.ts`.

---

### Task 1: `quickSet.ts` mutations

**Files:**
- Create: `src/lib/quickSet.ts`
- Test: `src/lib/quickSet.test.ts`

**Interfaces:**
- Consumes: `touchCollection(prisma, collectionId)` (`src/lib/collections.ts`, existing).
- Produces: `export interface QuickSetChange { cardCode: string; previousQuantity: number }`, `export async function quickAddSet(prisma: PrismaClient, collectionId: number, packCode: string): Promise<QuickSetChange[]>`, `export async function clearSet(prisma: PrismaClient, collectionId: number, packCode: string): Promise<QuickSetChange[]>`, `export async function undoQuickSetChange(prisma: PrismaClient, collectionId: number, changes: QuickSetChange[]): Promise<void>` — used by Task 2's actions.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/quickSet.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard, seedCollection } from './testFixtures'
import { incrementOwned } from './collection'
import { quickAddSet, clearSet, undoQuickSetChange } from './quickSet'
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

describe('quickAddSet', () => {
  it('raises a card with no owned quantity up to its printed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([{ cardCode: '01001', previousQuantity: 0 }])
    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(3)
  })

  it('never lowers a count already above the printed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 5)

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([])
    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(5)
  })

  it('excludes a card already exactly at its printed quantity from the returned changes', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 3)

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([])
  })

  it('falls back to a printed quantity of 1 when unknown', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: null })

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([{ cardCode: '01001', previousQuantity: 0 }])
    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(1)
  })

  it('handles a mix of cards needing changes and cards that do not, in the same set', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', quantity: 2, position: 2 })
    await incrementOwned(prisma, collectionId, '01002', 2)

    const changes = await quickAddSet(prisma, collectionId, 'core')

    expect(changes).toEqual([{ cardCode: '01001', previousQuantity: 0 }])
    const entryB = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01002' } },
    })
    expect(entryB?.quantityOwned).toBe(2)
  })

  it('only affects the given collection, not others', async () => {
    const a = await seedCollection(prisma, { name: 'A' })
    const b = await seedCollection(prisma, { name: 'B', isDefault: false })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

    await quickAddSet(prisma, a.id, 'core')

    const entryB = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId: b.id, cardCode: '01001' } },
    })
    expect(entryB).toBeNull()
  })
})

describe('clearSet', () => {
  it('zeros a card with a nonzero owned quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 2)

    const changes = await clearSet(prisma, collectionId, 'core')

    expect(changes).toEqual([{ cardCode: '01001', previousQuantity: 2 }])
    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(0)
  })

  it('excludes an already-zero card from the returned changes', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

    const changes = await clearSet(prisma, collectionId, 'core')

    expect(changes).toEqual([])
  })
})

describe('undoQuickSetChange', () => {
  it('restores each card to its previous quantity, including a value above the printed quantity', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await quickAddSet(prisma, collectionId, 'core')

    await undoQuickSetChange(prisma, collectionId, [{ cardCode: '01001', previousQuantity: 5 }])

    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(5)
  })

  it('restores a card to zero', async () => {
    const { id: collectionId } = await seedCollection(prisma)
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
    await incrementOwned(prisma, collectionId, '01001', 3)

    await undoQuickSetChange(prisma, collectionId, [{ cardCode: '01001', previousQuantity: 0 }])

    const entry = await prisma.collectionEntry.findUnique({
      where: { collectionId_cardCode: { collectionId, cardCode: '01001' } },
    })
    expect(entry?.quantityOwned).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/quickSet.test.ts`
Expected: FAIL — module `./quickSet` does not exist.

- [ ] **Step 3: Implement the mutations**

Create `src/lib/quickSet.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import { touchCollection } from './collections'

export interface QuickSetChange {
  cardCode: string
  previousQuantity: number
}

async function applyChanges(
  prisma: PrismaClient,
  collectionId: number,
  updates: { cardCode: string; newQuantity: number }[]
): Promise<void> {
  if (updates.length === 0) {
    return
  }
  await prisma.$transaction([
    ...updates.map((update) =>
      prisma.collectionEntry.upsert({
        where: { collectionId_cardCode: { collectionId, cardCode: update.cardCode } },
        create: { collectionId, cardCode: update.cardCode, quantityOwned: update.newQuantity },
        update: { quantityOwned: update.newQuantity },
      })
    ),
    touchCollection(prisma, collectionId),
  ])
}

/** Raises every card in packCode to its printed quantity, never lowering an already-higher count. Returns only the cards that changed. */
export async function quickAddSet(
  prisma: PrismaClient,
  collectionId: number,
  packCode: string
): Promise<QuickSetChange[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    select: {
      code: true,
      quantity: true,
      collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
    },
  })

  const changes: QuickSetChange[] = []
  const updates: { cardCode: string; newQuantity: number }[] = []

  for (const card of cards) {
    const current = card.collectionEntries[0]?.quantityOwned ?? 0
    const target = card.quantity ?? 1
    if (current < target) {
      changes.push({ cardCode: card.code, previousQuantity: current })
      updates.push({ cardCode: card.code, newQuantity: target })
    }
  }

  await applyChanges(prisma, collectionId, updates)
  return changes
}

/** Zeros every card in packCode that currently has a nonzero owned quantity. Returns only the cards that changed. */
export async function clearSet(prisma: PrismaClient, collectionId: number, packCode: string): Promise<QuickSetChange[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    select: {
      code: true,
      collectionEntries: { where: { collectionId }, select: { quantityOwned: true } },
    },
  })

  const changes: QuickSetChange[] = []
  const updates: { cardCode: string; newQuantity: number }[] = []

  for (const card of cards) {
    const current = card.collectionEntries[0]?.quantityOwned ?? 0
    if (current > 0) {
      changes.push({ cardCode: card.code, previousQuantity: current })
      updates.push({ cardCode: card.code, newQuantity: 0 })
    }
  }

  await applyChanges(prisma, collectionId, updates)
  return changes
}

/** Restores each listed card to its previousQuantity exactly. Shared by Quick Add's and Clear Set's Undo. */
export async function undoQuickSetChange(
  prisma: PrismaClient,
  collectionId: number,
  changes: QuickSetChange[]
): Promise<void> {
  await applyChanges(
    prisma,
    collectionId,
    changes.map((change) => ({ cardCode: change.cardCode, newQuantity: change.previousQuantity }))
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/quickSet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quickSet.ts src/lib/quickSet.test.ts
git commit -m "Add quickAddSet/clearSet/undoQuickSetChange mutations"
```

---

### Task 2: Actions + `QuickAddSetModal`

**Files:**
- Create: `src/actions/quickSetActions.ts`
- Create: `src/components/QuickAddSetModal.tsx`
- Test: `src/components/QuickAddSetModal.test.tsx`

**Interfaces:**
- Consumes: `quickAddSet`/`clearSet`/`undoQuickSetChange`/`QuickSetChange` (Task 1, `src/lib/quickSet.ts`), `SetCompletion` (`src/lib/reports.ts`, existing).
- Produces: `export type QuickSetResult = { ok: true; changes: QuickSetChange[] } | { ok: false; error: string }`, `export type SimpleActionResult = { ok: true } | { ok: false; error: string }`, `export async function quickAddSet(collectionId: number, packCode: string): Promise<QuickSetResult>`, `export async function clearSet(collectionId: number, packCode: string): Promise<QuickSetResult>`, `export async function undoQuickSetChange(collectionId: number, changes: QuickSetChange[]): Promise<SimpleActionResult>` in `quickSetActions.ts`. `export function QuickAddSetModal({ set, collectionId, onClose, onDone }: { set: SetCompletion; collectionId: number; onClose: () => void; onDone: (verb: 'Added' | 'Cleared', changes: QuickSetChange[]) => void })` — used by Task 3's `SetProgressList`.

- [ ] **Step 1: Add the server actions**

Create `src/actions/quickSetActions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import {
  quickAddSet as quickAddSetMutation,
  clearSet as clearSetMutation,
  undoQuickSetChange as undoQuickSetChangeMutation,
  type QuickSetChange,
} from '@/lib/quickSet'

export type QuickSetResult = { ok: true; changes: QuickSetChange[] } | { ok: false; error: string }
export type SimpleActionResult = { ok: true } | { ok: false; error: string }

export async function quickAddSet(collectionId: number, packCode: string): Promise<QuickSetResult> {
  try {
    const changes = await quickAddSetMutation(prisma, collectionId, packCode)
    revalidatePath('/')
    return { ok: true, changes }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to quick add set' }
  }
}

export async function clearSet(collectionId: number, packCode: string): Promise<QuickSetResult> {
  try {
    const changes = await clearSetMutation(prisma, collectionId, packCode)
    revalidatePath('/')
    return { ok: true, changes }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to clear set' }
  }
}

export async function undoQuickSetChange(
  collectionId: number,
  changes: QuickSetChange[]
): Promise<SimpleActionResult> {
  try {
    await undoQuickSetChangeMutation(prisma, collectionId, changes)
    revalidatePath('/')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to undo' }
  }
}
```

- [ ] **Step 2: Write the failing `QuickAddSetModal` tests**

Create `src/components/QuickAddSetModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuickAddSetModal } from './QuickAddSetModal'
import { quickAddSet, clearSet } from '@/actions/quickSetActions'
import type { SetCompletion } from '@/lib/reports'

vi.mock('@/actions/quickSetActions', () => ({
  quickAddSet: vi.fn(),
  clearSet: vi.fn(),
}))

const partialSet: SetCompletion = {
  packCode: 'core',
  packName: 'Core Set',
  cycleCode: 'core',
  cycleName: 'Core Set',
  dateRelease: '2012-09-06',
  setType: 'core',
  ownedCount: 5,
  totalCount: 10,
  percentOwned: 50,
}

describe('QuickAddSetModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows the partial-ownership warning when some cards are already owned', () => {
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByText(/You already own 5 of 10 cards in Core Set/)).toBeInTheDocument()
  })

  it('shows a plain add-all prompt when nothing is owned yet', () => {
    const emptySet: SetCompletion = { ...partialSet, ownedCount: 0, percentOwned: 0 }
    render(<QuickAddSetModal set={emptySet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByText('Add all 10 cards from Core Set to your collection?')).toBeInTheDocument()
  })

  it('disables Quick Add and shows an already-owned message when the set is fully owned', () => {
    const fullSet: SetCompletion = { ...partialSet, ownedCount: 10, percentOwned: 100 }
    render(<QuickAddSetModal set={fullSet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByText('This set is already fully owned.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quick Add All Cards' })).toBeDisabled()
  })

  it('disables Clear Set when nothing is owned', () => {
    const emptySet: SetCompletion = { ...partialSet, ownedCount: 0, percentOwned: 0 }
    render(<QuickAddSetModal set={emptySet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Clear Set' })).toBeDisabled()
  })

  it('calls quickAddSet and onDone("Added", changes) on success', async () => {
    const changes = [{ cardCode: '01001', previousQuantity: 0 }]
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes })
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    expect(quickAddSet).toHaveBeenCalledWith(1, 'core')
    expect(onDone).toHaveBeenCalledWith('Added', changes)
  })

  it('shows an error and does not call onDone when Quick Add fails', async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: false, error: 'Something went wrong' })
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('requires a two-step confirm before clearing, and cancel returns to the first step', async () => {
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Clear Set' }))

    expect(screen.getByText(/Are you sure\?/)).toBeInTheDocument()
    expect(clearSet).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Clear Set' })).toBeInTheDocument()
  })

  it('calls clearSet and onDone("Cleared", changes) after confirming', async () => {
    const changes = [{ cardCode: '01001', previousQuantity: 3 }]
    vi.mocked(clearSet).mockResolvedValue({ ok: true, changes })
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={vi.fn()} onDone={onDone} />)

    await user.click(screen.getByRole('button', { name: 'Clear Set' }))
    await user.click(screen.getByRole('button', { name: 'Yes, Clear' }))

    expect(clearSet).toHaveBeenCalledWith(1, 'core')
    expect(onDone).toHaveBeenCalledWith('Cleared', changes)
  })

  it('calls onClose without calling any action when Cancel is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={onClose} onDone={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(quickAddSet).not.toHaveBeenCalled()
    expect(clearSet).not.toHaveBeenCalled()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<QuickAddSetModal set={partialSet} collectionId={1} onClose={onClose} onDone={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/QuickAddSetModal.test.tsx`
Expected: FAIL — module `./QuickAddSetModal` does not exist.

- [ ] **Step 4: Implement `QuickAddSetModal`**

Create `src/components/QuickAddSetModal.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { quickAddSet, clearSet } from '@/actions/quickSetActions'
import type { QuickSetChange } from '@/lib/quickSet'
import type { SetCompletion } from '@/lib/reports'

export function QuickAddSetModal({
  set,
  collectionId,
  onClose,
  onDone,
}: {
  set: SetCompletion
  collectionId: number
  onClose: () => void
  onDone: (verb: 'Added' | 'Cleared', changes: QuickSetChange[]) => void
}) {
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isFullyOwned = set.ownedCount === set.totalCount
  const hasNothingOwned = set.ownedCount === 0

  async function handleQuickAdd() {
    setIsSubmitting(true)
    setError(null)
    const result = await quickAddSet(collectionId, set.packCode)
    if (result.ok) {
      onDone('Added', result.changes)
    } else {
      setError(result.error)
      setIsSubmitting(false)
    }
  }

  async function handleClear() {
    setIsSubmitting(true)
    setError(null)
    const result = await clearSet(collectionId, set.packCode)
    if (result.ok) {
      onDone('Cleared', result.changes)
    } else {
      setError(result.error)
      setIsSubmitting(false)
    }
  }

  let bodyText: string
  if (isFullyOwned) {
    bodyText = 'This set is already fully owned.'
  } else if (hasNothingOwned) {
    bodyText = `Add all ${set.totalCount} cards from ${set.packName} to your collection?`
  } else {
    bodyText = `You already own ${set.ownedCount} of ${set.totalCount} cards in ${set.packName}. Quick Add will bring every card up to a full playset — it won't reduce anything you already own. Continue?`
  }

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div onClick={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-lg bg-surface p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold">
            {set.packName} — {set.ownedCount}/{set.totalCount} owned ({set.percentOwned}%)
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 cursor-pointer rounded bg-surface-hover px-2 py-1 text-sm hover:bg-default"
          >
            ✕
          </button>
        </div>

        <p className="text-sm text-muted">{bodyText}</p>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {!confirmingClear ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={isFullyOwned || isSubmitting}
              className="cursor-pointer rounded border border-accent bg-accent/20 px-3 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Adding…' : 'Quick Add All Cards'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              disabled={hasNothingOwned || isSubmitting}
              className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear Set
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <span>Are you sure? This removes {set.ownedCount} cards&apos; worth of quantity.</span>
            <button
              type="button"
              onClick={handleClear}
              disabled={isSubmitting}
              className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-3 py-1 text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Clearing…' : 'Yes, Clear'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClear(false)}
              disabled={isSubmitting}
              className="cursor-pointer rounded border border-default px-3 py-1 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/QuickAddSetModal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/actions/quickSetActions.ts src/components/QuickAddSetModal.tsx src/components/QuickAddSetModal.test.tsx
git commit -m "Add quickSetActions and QuickAddSetModal"
```

---

### Task 3: Wire the icon into `SetProgressList`

**Files:**
- Modify: `src/app/SetProgressList.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/SetProgressList.test.tsx` (full-file rewrite — a new required `collectionId` prop touches every existing render call, matching the exact pitfall the Batch Undo spec already flagged: do this in one pass, not discovered piecemeal via `tsc`)

**Interfaces:**
- Consumes: `QuickAddSetModal` (Task 2, `src/components/QuickAddSetModal.tsx`), `undoQuickSetChange` (Task 2, `src/actions/quickSetActions.ts`), `QuickSetChange` (Task 1, `src/lib/quickSet.ts`).
- Produces: `SetProgressList` now requires a `collectionId: number` prop — this is the end of the plan's interface chain (nothing later depends on `SetProgressList`'s own exports).

- [ ] **Step 1: Restructure and extend `SetProgressList.tsx`**

Replace the full contents of `src/app/SetProgressList.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { groupSetsByCycle, releaseYear, type SetCompletion } from '@/lib/reports'
import { SetThumbnail } from '@/components/SetThumbnail'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SET_TYPES } from '@/lib/setTypes'
import { OWNERSHIP_FILTER_OPTIONS, matchesOwnershipFilter, type OwnershipFilter } from '@/lib/ownershipFilter'
import { QuickAddSetModal } from '@/components/QuickAddSetModal'
import { undoQuickSetChange } from '@/actions/quickSetActions'
import type { QuickSetChange } from '@/lib/quickSet'

export function SetProgressList({ sets, collectionId }: { sets: SetCompletion[]; collectionId: number }) {
  const [filter, setFilter] = useState<OwnershipFilter>('all')
  const [typeFilter, setTypeFilter] = useState<string | 'all'>('all')
  const [nameQuery, setNameQuery] = useState('')

  const [quickAddPackCode, setQuickAddPackCode] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<{
    packCode: string
    verb: 'Added' | 'Cleared'
    changes: QuickSetChange[]
  } | null>(null)
  const [isUndoing, setIsUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)

  // Only offer a button for a type that's actually present in this data,
  // in the same order SET_TYPES declares them (not the order sets happen
  // to appear in).
  const presentTypes = Object.keys(SET_TYPES).filter((type) => sets.some((set) => set.setType === type))

  const trimmedQuery = nameQuery.trim().toLowerCase()

  const visibleSets = sets.filter((set) => {
    if (!matchesOwnershipFilter(set.ownedCount, set.totalCount, filter)) return false
    if (typeFilter !== 'all' && set.setType !== typeFilter) return false
    if (trimmedQuery !== '' && !set.packName.toLowerCase().includes(trimmedQuery)) return false
    return true
  })

  const setsByCycle = groupSetsByCycle(visibleSets)
  const cycles = [...setsByCycle.entries()]

  const quickAddTarget = sets.find((set) => set.packCode === quickAddPackCode) ?? null

  async function handleUndo() {
    if (!lastAction) return
    setIsUndoing(true)
    setUndoError(null)
    try {
      const result = await undoQuickSetChange(collectionId, lastAction.changes)
      if (result.ok) {
        setLastAction(null)
      } else {
        setUndoError(result.error)
      }
    } finally {
      setIsUndoing(false)
    }
  }

  return (
    <div className="flex gap-8">
      <nav aria-label="Jump to cycle" className="hidden w-56 shrink-0 self-start sm:block sm:sticky sm:top-8">
        <ul className="space-y-1">
          {cycles.map(([cycleCode, cycleSets]) => (
            <li key={cycleCode}>
              <a
                href={`#cycle-${cycleCode}`}
                className="block rounded px-2 py-1 text-sm text-muted hover:bg-surface-hover hover:text-primary"
              >
                {cycleSets[0].cycleName} ({cycleSets.length})
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="Filter sets by name"
            placeholder="Filter sets by name…"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            className="w-full max-w-xs rounded border border-default bg-surface px-3 py-1 text-sm placeholder:text-faint"
          />
          {nameQuery !== '' && (
            <button
              type="button"
              onClick={() => setNameQuery('')}
              className="cursor-pointer rounded border border-default px-3 py-1 text-sm hover:bg-surface-hover"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {OWNERSHIP_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setFilter(option.value)}
              className={`cursor-pointer rounded border px-3 py-1 text-sm ${
                filter === option.value
                  ? 'border-accent bg-accent/20 text-accent'
                  : 'border-default hover:bg-surface-hover'
              }`}
            >
              {option.label}
            </button>
          ))}

          <span className="mx-1 h-5 w-px bg-subtle" aria-hidden="true" />

          <label className="flex items-center gap-1.5 text-sm">
            {typeFilter !== 'all' && <SetTypeBadge setType={typeFilter} />}
            <span className="sr-only">Filter by set type</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="cursor-pointer rounded border border-default bg-surface px-3 py-1 text-sm hover:bg-surface-hover"
            >
              <option value="all">All types</option>
              {presentTypes.map((type) => (
                <option key={type} value={type}>
                  {SET_TYPES[type].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {cycles.map(([cycleCode, cycleSets]) => (
          <div key={cycleCode} id={`cycle-${cycleCode}`} className="scroll-mt-8">
            <h2 className="mb-2 text-lg font-semibold">{cycleSets[0].cycleName}</h2>
            <ul className="space-y-2">
              {cycleSets.map((set) => {
                const year = releaseYear(set.dateRelease)
                return (
                  <li key={set.packCode} className="space-y-1">
                    <div className="flex items-center gap-2 rounded border border-subtle p-3 hover:border-default">
                      <Link href={`/sets/${set.packCode}`} className="flex min-w-0 flex-1 items-center gap-3">
                        <SetThumbnail packCode={set.packCode} packName={set.packName} />
                        <div className="min-w-0 flex-1">
                          <div className="flex justify-between">
                            <span className="flex items-center gap-2">
                              <SetTypeBadge setType={set.setType} />
                              {set.packName}
                              {year && <span className="text-faint"> ({year})</span>}
                            </span>
                            <span>
                              {set.ownedCount}/{set.totalCount} ({set.percentOwned}%)
                            </span>
                          </div>
                          <div className="mt-2 h-2 rounded bg-subtle">
                            <div className="h-2 rounded bg-blue-600" style={{ width: `${set.percentOwned}%` }} />
                          </div>
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => setQuickAddPackCode(set.packCode)}
                        aria-label={`Quick add ${set.packName}`}
                        className="shrink-0 cursor-pointer rounded p-1.5 text-faint hover:bg-surface-hover hover:text-primary"
                      >
                        ⚡
                      </button>
                    </div>
                    {lastAction?.packCode === set.packCode && (
                      <div className="px-3">
                        <p className="text-sm text-muted">
                          {lastAction.verb} {lastAction.changes.length} card
                          {lastAction.changes.length === 1 ? '' : 's'}{' '}
                          <button
                            type="button"
                            onClick={handleUndo}
                            disabled={isUndoing}
                            className="cursor-pointer text-accent underline hover:text-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isUndoing ? 'Undoing…' : 'Undo'}
                          </button>
                        </p>
                        {undoError && (
                          <p className="text-sm text-danger" role="alert">
                            {undoError}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}

        {visibleSets.length === 0 && <p className="text-sm text-faint">No sets match this filter.</p>}
      </div>

      {quickAddTarget && (
        <QuickAddSetModal
          set={quickAddTarget}
          collectionId={collectionId}
          onClose={() => setQuickAddPackCode(null)}
          onDone={(verb, changes) => {
            setLastAction({ packCode: quickAddTarget.packCode, verb, changes })
            setUndoError(null)
            setQuickAddPackCode(null)
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Pass `collectionId` from the dashboard page**

In `src/app/page.tsx`, change:

```tsx
      <SetProgressList sets={sets} />
```

to:

```tsx
      <SetProgressList sets={sets} collectionId={collection.id} />
```

- [ ] **Step 3: Rewrite the test file**

Replace the full contents of `src/app/SetProgressList.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetProgressList } from './SetProgressList'
import { quickAddSet, undoQuickSetChange } from '@/actions/quickSetActions'
import type { SetCompletion } from '@/lib/reports'

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

vi.mock('@/actions/quickSetActions', () => ({
  quickAddSet: vi.fn(),
  clearSet: vi.fn(),
  undoQuickSetChange: vi.fn(),
}))

const sets: SetCompletion[] = [
  {
    packCode: 'core',
    packName: 'Core Set',
    cycleCode: 'core',
    cycleName: 'Core Set',
    dateRelease: '2012-09-06',
    setType: 'core',
    ownedCount: 5,
    totalCount: 10,
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
]

describe('SetProgressList', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('defaults to showing all sets', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('shows each set\'s release year next to its name', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.getByText('(2012)')).toBeInTheDocument()
    expect(screen.getByText('(2013)')).toBeInTheDocument()
  })

  it("shows each set's type badge next to its name", () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.getByRole('img', { name: 'Core' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Data Pack' })).toBeInTheDocument()
  })

  it('omits the year when a set has no release date', () => {
    const noDate: SetCompletion = { ...sets[0], packCode: 'draftish', dateRelease: null }
    render(<SetProgressList sets={[noDate]} collectionId={1} />)

    expect(screen.queryByText(/\(\d{4}\)/)).not.toBeInTheDocument()
  })

  it('lists each cycle as a jump link in the sidebar nav, with its set count', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    const nav = screen.getByRole('navigation', { name: 'Jump to cycle' })
    expect(within(nav).getByRole('link', { name: 'Core Set (1)' })).toHaveAttribute('href', '#cycle-core')
    expect(within(nav).getByRole('link', { name: 'Genesis (1)' })).toHaveAttribute('href', '#cycle-genesis')
  })

  it('gives each cycle section a matching anchor id for the sidebar links to jump to', () => {
    const { container } = render(<SetProgressList sets={sets} collectionId={1} />)

    expect(container.querySelector('#cycle-core')).not.toBeNull()
    expect(container.querySelector('#cycle-genesis')).not.toBeNull()
  })

  it('the "Owned" filter shows only fully-owned sets, excluding partial and missing', async () => {
    const user = userEvent.setup()
    const mixedSets: SetCompletion[] = [
      { ...sets[0], packCode: 'full', packName: 'Full Set', ownedCount: 10, totalCount: 10, percentOwned: 100 },
      sets[0],
      sets[1],
    ]
    render(<SetProgressList sets={mixedSets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('Full Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('Core Set', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
  })

  it('the "Partial" filter shows only sets owned but short of the full total', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Partial' }))

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
  })

  it('the "Missing" filter hides sets with at least one owned card', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Missing' }))

    expect(screen.queryByText('Core Set', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('"All" restores every set after filtering', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))
    await user.click(screen.getByRole('button', { name: 'All' }))

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('a cycle heading (and its sidebar link) disappears once every set in it is filtered out', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.queryByText('Genesis')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Genesis (1)' })).not.toBeInTheDocument()
  })

  it('shows a message when no sets match the filter', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={[sets[1]]} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Owned' }))

    expect(screen.getByText('No sets match this filter.')).toBeInTheDocument()
  })

  it('filters sets by name as text is typed, case-insensitively', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.type(screen.getByRole('textbox', { name: 'Filter sets by name' }), 'core')

    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
  })

  it('combines the name filter with the Owned/Missing filter using AND', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Missing' }))
    await user.type(screen.getByRole('textbox', { name: 'Filter sets by name' }), 'core')

    expect(screen.queryByText('Core Set', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()
    expect(screen.getByText('No sets match this filter.')).toBeInTheDocument()
  })

  it('does not show a Clear button while the name filter is empty', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('the Clear button resets the name filter and restores the full list', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    const input = screen.getByRole('textbox', { name: 'Filter sets by name' })
    await user.type(input, 'core')
    expect(screen.queryByText('A Study in Static')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(input).toHaveValue('')
    expect(screen.getByText('Core Set', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('A Study in Static')).toBeInTheDocument()
  })

  it('shows a Quick add button for each set', () => {
    render(<SetProgressList sets={sets} collectionId={1} />)

    expect(screen.getByRole('button', { name: 'Quick add Core Set' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quick add A Study in Static' })).toBeInTheDocument()
  })

  it('clicking Quick add opens the modal for that set only', async () => {
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))

    expect(screen.getByText('A Study in Static — 0/20 owned (0%)')).toBeInTheDocument()
  })

  it('shows an Undo line on the right row after a successful Quick Add, and Undo clears it', async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes: [{ cardCode: '01001', previousQuantity: 0 }] })
    vi.mocked(undoQuickSetChange).mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    expect(await screen.findByText(/Added 1 card/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(undoQuickSetChange).toHaveBeenCalledWith(1, [{ cardCode: '01001', previousQuantity: 0 }])
    await waitFor(() => expect(screen.queryByText(/Added 1 card/)).not.toBeInTheDocument())
  })

  it('shows an error and keeps the Undo line if the undo itself fails', async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes: [{ cardCode: '01001', previousQuantity: 0 }] })
    vi.mocked(undoQuickSetChange).mockResolvedValue({ ok: false, error: 'Something went wrong' })
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/Added 1 card/)).toBeInTheDocument()
  })

  it("a new action on a different row replaces the previous row's Undo line", async () => {
    vi.mocked(quickAddSet).mockResolvedValue({ ok: true, changes: [{ cardCode: '01001', previousQuantity: 0 }] })
    const user = userEvent.setup()
    render(<SetProgressList sets={sets} collectionId={1} />)

    await user.click(screen.getByRole('button', { name: 'Quick add A Study in Static' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))
    expect(await screen.findByText(/Added 1 card/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Quick add Core Set' }))
    await user.click(screen.getByRole('button', { name: 'Quick Add All Cards' }))

    const undoLines = await screen.findAllByText(/Added 1 card/)
    expect(undoLines).toHaveLength(1)
  })
})
```

- [ ] **Step 4: Run the test file and the full suite**

Run: `npx vitest run src/app/SetProgressList.test.tsx`
Expected: PASS (all cases, including the pre-existing filter/name-search tests, still hold against the restructured markup).

Run: `npm test`
Expected: PASS — full suite green.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Manual verification**

**This step touches the real collection database (`data/netrunner.db`) — read the Global Constraints section above before starting.**

Run: `npm run dev`, then in a browser:
1. On the dashboard, pick one small, specific set you can identify again (note its exact current `{ownedCount}/{totalCount}` as shown in its row — write it down).
2. Click its "⚡" icon. Confirm the dialog's body text matches its current state (the "already own N of M" wording if partial, or "Add all N cards" if untouched).
3. Click **Quick Add All Cards**. Confirm the row's numbers update and a "Added N cards · Undo" line appears under that row.
4. Click **Undo**. Confirm the row's numbers return to exactly the values you noted in step 1, and the Undo line disappears.
5. Click the icon again, click **Clear Set** (should be enabled only if the set has any owned cards — if the set from step 1 is now back to its original partial/full state, this should be enabled), confirm the "Are you sure?" step appears, click **Yes, Clear**, confirm all quantities in that row go to 0.
6. Click **Undo** again to restore the exact original values from step 1 — **do not leave the dashboard until this row matches what you wrote down in step 1.**
7. Confirm a fully-owned set's icon opens a dialog with Quick Add disabled and the "already fully owned" message, and a set with 0 owned cards opens a dialog with Clear Set disabled.

- [ ] **Step 6: Commit**

```bash
git add src/app/SetProgressList.tsx src/app/page.tsx src/app/SetProgressList.test.tsx
git commit -m "Add Quick Add/Clear Set icon and Undo to the dashboard set list"
```
