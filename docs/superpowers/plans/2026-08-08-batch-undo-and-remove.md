# Batch Undo and Remove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two corrections to an in-progress batch: an "Undo" for the most recent add, and a per-card "Remove" in the Review modal.

**Architecture:** One new mutation, `removeFromBatch`, shared by both features (Undo calls it with the last-added amount; Review's remove calls it with a card's full quantity). A shared state-machine rule — removing a card that drops the count below target while `stopped` reverts status to `paused` — reuses the existing paused state and its existing Continue button rather than adding new states or UI.

**Tech Stack:** Next.js (App Router) client components, Prisma/SQLite, Tailwind CSS, Vitest + React Testing Library.

## Global Constraints

- `removeFromBatch(prisma, batchId, cardCode, amount)` is callable while `running`, `paused`, or `stopped`; rejected for `approved`/`discarded`.
- If the batch was `stopped` and the removal drops the total below `expectedCount`, status reverts to `paused`. No other status transition happens (running/paused stay as they are).
- Undo is plain client state in `BatchBuilderForm` (`{ code, title, amount } | null`) — not persisted, lost on reload. Visible regardless of `running`/`paused`/`stopped`, including `stopped`.
- Review's remove always removes a card's full current quantity (not a partial decrement), with no confirmation dialog and no per-row loading indicator. The modal stays open after a removal.
- `BatchReviewModal` stays a "dumb" presentational component — no server-action calls of its own, only a new `onRemoveCard(code)` callback prop.
- No new "Continue" button inside the Review modal — closing it (existing Close/Escape/backdrop) reveals `BatchStatusBar`'s existing Continue button once status is `paused`.
- Spec: `docs/superpowers/specs/2026-08-08-batch-undo-and-remove-design.md`.

---

### Task 1: `removeFromBatch` mutation and server action

**Files:**
- Modify: `src/actions/batchMutations.ts`
- Modify: `src/actions/batchMutations.test.ts`
- Modify: `src/actions/batchActions.ts`

**Interfaces:**
- Consumes: `Batch`/`BatchCard` (existing schema), `withActiveBatch`/`BatchActionResult` (existing, in `batchActions.ts`).
- Produces (used by Task 3): `removeFromBatch(prisma: PrismaClient, batchId: number, cardCode: string, amount: number): Promise<void>` (in `batchMutations.ts`) and the `'use server'` wrapper `removeFromBatch(batchId: number, cardCode: string, amount: number): Promise<BatchActionResult>` (in `batchActions.ts`).

- [ ] **Step 1: Write the failing tests**

In `src/actions/batchMutations.test.ts`, change the import line from:

```ts
import { startBatch, addCardToBatch, pauseBatch, continueBatch, discardBatch, approveBatch } from './batchMutations'
```

to:

```ts
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
  removeFromBatch,
} from './batchMutations'
```

Then append this new `describe` block to the end of the file:

```ts
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
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 1)
    await addCardToBatch(prisma, batchId, '01001', 1)
    await approveBatch(prisma, batchId)

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
Expected: FAIL — `removeFromBatch` is not exported from `./batchMutations`.

- [ ] **Step 3: Write the mutation**

Append to `src/actions/batchMutations.ts`:

```ts
export async function removeFromBatch(
  prisma: PrismaClient,
  batchId: number,
  cardCode: string,
  amount: number
): Promise<void> {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'running' && batch.status !== 'paused' && batch.status !== 'stopped') {
    throw new Error(`Cannot remove a card from a batch with status "${batch.status}"`)
  }

  const batchCard = await prisma.batchCard.findUniqueOrThrow({
    where: { batchId_cardCode: { batchId, cardCode } },
  })
  if (amount > batchCard.quantity) {
    throw new Error(`Cannot remove ${amount}, only ${batchCard.quantity} in the batch`)
  }

  if (amount === batchCard.quantity) {
    await prisma.batchCard.delete({ where: { batchId_cardCode: { batchId, cardCode } } })
  } else {
    await prisma.batchCard.update({
      where: { batchId_cardCode: { batchId, cardCode } },
      data: { quantity: { decrement: amount } },
    })
  }

  if (batch.status === 'stopped') {
    const totals = await prisma.batchCard.aggregate({ where: { batchId }, _sum: { quantity: true } })
    const currentCount = totals._sum.quantity ?? 0
    if (currentCount < batch.expectedCount) {
      await prisma.batch.update({ where: { id: batchId }, data: { status: 'paused' } })
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/actions/batchMutations.test.ts`
Expected: PASS (8 new tests, all existing tests still passing).

- [ ] **Step 5: Add the server-action wrapper**

In `src/actions/batchActions.ts`, change the import block from:

```ts
import {
  startBatch as startBatchMutation,
  addCardToBatch as addCardToBatchMutation,
  pauseBatch as pauseBatchMutation,
  continueBatch as continueBatchMutation,
  discardBatch as discardBatchMutation,
  approveBatch as approveBatchMutation,
} from './batchMutations'
```

to:

```ts
import {
  startBatch as startBatchMutation,
  addCardToBatch as addCardToBatchMutation,
  pauseBatch as pauseBatchMutation,
  continueBatch as continueBatchMutation,
  discardBatch as discardBatchMutation,
  approveBatch as approveBatchMutation,
  removeFromBatch as removeFromBatchMutation,
} from './batchMutations'
```

Then append to the file:

```ts
export async function removeFromBatch(
  batchId: number,
  cardCode: string,
  amount: number
): Promise<BatchActionResult> {
  return withActiveBatch(() => removeFromBatchMutation(prisma, batchId, cardCode, amount))
}
```

No new test file for this action — matches this file's existing convention (none of `startBatch`/`addCardToBatch`/etc. have their own action-level tests either; the substantive branching logic lives in and is tested by `batchMutations.test.ts`, and `withActiveBatch`'s wrapping behavior is already exercised by the other five actions that use it).

- [ ] **Step 6: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/actions/batchMutations.ts src/actions/batchMutations.test.ts src/actions/batchActions.ts
git commit -m "Add removeFromBatch mutation and server action"
```

---

### Task 2: `BatchReviewModal` remove button

**Files:**
- Modify: `src/app/builder/BatchReviewModal.tsx`
- Modify: `src/app/builder/BatchReviewModal.test.tsx`

**Interfaces:**
- Produces (used by Task 3): `BatchReviewModal` gains a new **required** prop `onRemoveCard: (code: string) => void`.

- [ ] **Step 1: Write the failing tests**

In `src/app/builder/BatchReviewModal.test.tsx`, every one of the 8 existing `render(<BatchReviewModal .../>)` calls has an `onApprove={...}` prop immediately followed by an `onClose={...}` prop (the exact values passed to those two vary by test — sometimes `vi.fn()` inline, sometimes a named `onApprove`/`onClose` variable — only the prop list structure is uniform). In **every one of the 8 calls**, insert a new line `onRemoveCard={vi.fn()}` between the existing `onApprove={...}` line and the `onClose={...}` line that follows it. For example, the first call (currently):

```tsx
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onClose={vi.fn()}
      />
```

becomes:

```tsx
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={vi.fn()}
      />
```

Apply the same one-line insertion to all 8 render calls in the file, changing nothing else about them.

Then append these 3 new tests inside the existing `describe('BatchReviewModal', ...)` block:

```ts
  it('shows a remove button for each card', () => {
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Remove Card A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Card B' })).toBeInTheDocument()
  })

  it("clicking a card's remove button calls onRemoveCard with that card's code", async () => {
    const onRemoveCard = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={onRemoveCard}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Remove Card A' }))

    expect(onRemoveCard).toHaveBeenCalledWith('01001')
  })

  it('does not close the modal when removing a card', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onRemoveCard={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Remove Card A' }))

    expect(onClose).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/builder/BatchReviewModal.test.tsx`
Expected: FAIL — `tsc`/React would complain `onRemoveCard` is missing from `BatchReviewModal`'s props (not yet accepted), and the 3 new tests fail to find a "Remove ..." button.

- [ ] **Step 3: Write the implementation**

In `src/app/builder/BatchReviewModal.tsx`, change the props destructuring and type from:

```tsx
export function BatchReviewModal({
  batchName,
  cards,
  isSubmitting,
  onDiscard,
  onApprove,
  onClose,
}: {
  batchName: string
  cards: BatchCardEntry[]
  isSubmitting: boolean
  onDiscard: () => void
  onApprove: () => void
  onClose: () => void
}) {
```

to:

```tsx
export function BatchReviewModal({
  batchName,
  cards,
  isSubmitting,
  onDiscard,
  onApprove,
  onRemoveCard,
  onClose,
}: {
  batchName: string
  cards: BatchCardEntry[]
  isSubmitting: boolean
  onDiscard: () => void
  onApprove: () => void
  onRemoveCard: (code: string) => void
  onClose: () => void
}) {
```

Then change the card list from:

```tsx
        <ul className="space-y-1 text-sm">
          {cards.map((card) => (
            <li key={card.code} className="flex items-center justify-between gap-2">
              <span>{card.title}</span>
              <span className="shrink-0">{card.quantity}</span>
            </li>
          ))}
          {cards.length === 0 && <li className="text-faint">No cards were added to this batch.</li>}
        </ul>
```

to:

```tsx
        <ul className="space-y-1 text-sm">
          {cards.map((card) => (
            <li key={card.code} className="flex items-center justify-between gap-2">
              <span>{card.title}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span>{card.quantity}</span>
                <button
                  type="button"
                  onClick={() => onRemoveCard(card.code)}
                  aria-label={`Remove ${card.title}`}
                  className="cursor-pointer text-faint hover:text-danger"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
          {cards.length === 0 && <li className="text-faint">No cards were added to this batch.</li>}
        </ul>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/builder/BatchReviewModal.test.tsx`
Expected: PASS (11 tests — 8 existing + 3 new).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: FAIL is expected at this point only if `BatchBuilderForm.tsx` (which renders `<BatchReviewModal>` without the new required prop) hasn't been updated yet — Task 3 handles that. If `npx tsc --noEmit` reports a missing `onRemoveCard` prop at the `<BatchReviewModal>` call site in `src/app/builder/BatchBuilderForm.tsx`, that is expected at this point in the plan; do not fix it in this task. Confirm instead that `npx vitest run src/app/builder/BatchReviewModal.test.tsx` and the rest of the previously-passing suite (everything except any `BatchBuilderForm`-related type error) are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/app/builder/BatchReviewModal.tsx src/app/builder/BatchReviewModal.test.tsx
git commit -m "Add remove button to BatchReviewModal's card list"
```

---

### Task 3: `BatchBuilderForm` — Undo and wiring the Review remove button

**Files:**
- Modify: `src/app/builder/BatchBuilderForm.tsx`
- Modify: `src/app/builder/BatchBuilderForm.test.tsx`

**Interfaces:**
- Consumes: `removeFromBatch` (Task 1), `onRemoveCard` prop on `BatchReviewModal` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `src/app/builder/BatchBuilderForm.test.tsx`, add `removeFromBatch: vi.fn(),` to the existing `vi.mock('@/actions/batchActions', () => ({ ... }))` factory (alongside the existing `startBatch`/`addCardToBatch`/etc. entries), and add `removeFromBatch` to the existing import from `@/actions/batchActions`. Then append these 5 tests inside the existing `describe('BatchBuilderForm', ...)` block:

```ts
  it('shows an "Added" line with an Undo button after a successful add', async () => {
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] },
    })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))

    await waitFor(() => expect(screen.getByText(/Added 3× Corroder/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('clicking Undo calls removeFromBatch with the tracked code/amount and clears the line', async () => {
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] },
    })
    vi.mocked(removeFromBatch).mockResolvedValue({ ok: true, batch: { ...runningBatch, currentCount: 0, cards: [] } })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))
    await waitFor(() => screen.getByRole('button', { name: 'Undo' }))

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    expect(removeFromBatch).toHaveBeenCalledWith(1, '01007', 3)
    await waitFor(() => expect(screen.queryByText(/Added 3× Corroder/)).not.toBeInTheDocument())
  })

  it('keeps the Undo line visible even once the batch is stopped', async () => {
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: {
        ...runningBatch,
        status: 'stopped',
        currentCount: 60,
        cards: [{ code: '01007', title: 'Corroder', quantity: 60 }],
      },
    })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 4 Corroder' }))

    await waitFor(() => expect(screen.queryByPlaceholderText('Search for a card by title...')).not.toBeInTheDocument())
    expect(screen.getByText(/Added 4× Corroder/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('removing a card from Review calls removeFromBatch with its full quantity and keeps the modal open', async () => {
    vi.mocked(removeFromBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, status: 'stopped', currentCount: 0, cards: [] },
    })
    const stoppedBatch = {
      ...runningBatch,
      status: 'stopped' as const,
      currentCount: 3,
      cards: [{ code: '01007', title: 'Corroder', quantity: 3 }],
    }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Remove Corroder' }))

    expect(removeFromBatch).toHaveBeenCalledWith(1, '01007', 3)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Batch Test' })).toBeInTheDocument())
  })

  it('removing a card that drops a stopped batch below target reveals the Continue button after closing Review', async () => {
    vi.mocked(removeFromBatch).mockResolvedValue({
      ok: true,
      batch: {
        ...runningBatch,
        status: 'paused',
        currentCount: 2,
        cards: [{ code: '01007', title: 'Corroder', quantity: 2 }],
      },
    })
    const stoppedBatch = {
      ...runningBatch,
      status: 'stopped' as const,
      currentCount: 3,
      cards: [{ code: '01007', title: 'Corroder', quantity: 3 }, { code: '01011', title: 'Mimic', quantity: 0 }],
    }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Remove Corroder' }))
    await waitFor(() => expect(removeFromBatch).toHaveBeenCalled())

    await user.keyboard('{Escape}')

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument()
  })
```

Note: the last test seeds `stoppedBatch.cards` with an extra zero-quantity `Mimic` entry only to give the mock `removeFromBatch` call a plausible starting shape to mutate away from — the assertion itself only cares about the resulting `paused` status surfacing a Continue button, not about `Mimic` specifically.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/builder/BatchBuilderForm.test.tsx`
Expected: FAIL — `removeFromBatch` isn't called anywhere yet, no "Added" line, no Undo button, `<BatchReviewModal>` isn't passed `onRemoveCard` yet (a `tsc` error at this call site until Step 3 below).

- [ ] **Step 3: Write the implementation**

In `src/app/builder/BatchBuilderForm.tsx`, change the import from `@/actions/batchActions`:

```ts
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
} from '@/actions/batchActions'
```

to:

```ts
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
  removeFromBatch,
} from '@/actions/batchActions'
```

Add a new state declaration alongside the existing `isReviewOpen`/`isSubmittingReview`/`chromeError` block:

```ts
  const [lastAdded, setLastAdded] = useState<{ code: string; title: string; amount: number } | null>(null)
  const [isUndoing, setIsUndoing] = useState(false)
```

In `handleAdd`, change the success branch from:

```ts
      const result = await addCardToBatch(batchId, card.code, amount)
      if (result.ok) {
        setBatch(result.batch)
        setStatusByCode((prev) => ({ ...prev, [card.code]: `added ${amount}` }))
      } else {
        setErrorByCode((prev) => ({ ...prev, [card.code]: result.error }))
      }
```

to:

```ts
      const result = await addCardToBatch(batchId, card.code, amount)
      if (result.ok) {
        setBatch(result.batch)
        setStatusByCode((prev) => ({ ...prev, [card.code]: `added ${amount}` }))
        setLastAdded({ code: card.code, title: card.title, amount })
      } else {
        setErrorByCode((prev) => ({ ...prev, [card.code]: result.error }))
      }
```

Add two new handler functions, right after `handleAdd`:

```ts
  async function handleUndo() {
    if (!batch || !lastAdded) return
    setIsUndoing(true)
    try {
      const result = await removeFromBatch(batch.id, lastAdded.code, lastAdded.amount)
      if (result.ok) {
        setBatch(result.batch)
        setLastAdded(null)
      } else {
        setChromeError(result.error)
      }
    } finally {
      setIsUndoing(false)
    }
  }

  async function handleRemoveCard(code: string) {
    if (!batch) return
    const card = batch.cards.find((c) => c.code === code)
    if (!card) return
    try {
      const result = await removeFromBatch(batch.id, code, card.quantity)
      if (result.ok) {
        setBatch(result.batch)
        if (lastAdded?.code === code) {
          setLastAdded(null)
        }
      } else {
        setChromeError(result.error)
      }
    } catch {
      setChromeError('Failed to remove card — try again')
    }
  }
```

In `resetAfterReview`, add `setLastAdded(null)` alongside the other resets — change:

```ts
  function resetAfterReview() {
    setBatch(null)
    setIsReviewOpen(false)
    setResults([])
    setQuery('')
    // Per-card status/error/pending state and the chrome error banner are
    // scoped to the batch that just finished — carrying them into a fresh
    // "no active batch" screen (and the next batch after it) would show
    // stale, contradictory signals for cards that happen to share a code.
    setStatusByCode({})
    setErrorByCode({})
    setPendingCodes({})
    setChromeError(null)
  }
```

to:

```ts
  function resetAfterReview() {
    setBatch(null)
    setIsReviewOpen(false)
    setResults([])
    setQuery('')
    // Per-card status/error/pending state, the chrome error banner, and
    // the last-added/undo tracker are all scoped to the batch that just
    // finished — carrying them into a fresh "no active batch" screen (and
    // the next batch after it) would show stale, contradictory signals.
    setStatusByCode({})
    setErrorByCode({})
    setPendingCodes({})
    setChromeError(null)
    setLastAdded(null)
  }
```

In the JSX, change:

```tsx
      <BatchStatusBar
        batch={batch}
        onPause={handlePause}
        onContinue={handleContinue}
        onReview={() => setIsReviewOpen(true)}
      />

      {chromeError && (
```

to:

```tsx
      <BatchStatusBar
        batch={batch}
        onPause={handlePause}
        onContinue={handleContinue}
        onReview={() => setIsReviewOpen(true)}
      />

      {lastAdded && (
        <p className="text-sm text-muted">
          Added {lastAdded.amount}× {lastAdded.title}{' '}
          <button
            type="button"
            onClick={handleUndo}
            disabled={isUndoing}
            className="cursor-pointer text-accent underline hover:text-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUndoing ? 'Undoing…' : 'Undo'}
          </button>
        </p>
      )}

      {chromeError && (
```

Finally, pass the new callback to `BatchReviewModal` — change:

```tsx
      {isReviewOpen && (
        <BatchReviewModal
          batchName={batch.name}
          cards={batch.cards}
          isSubmitting={isSubmittingReview}
          onDiscard={handleDiscard}
          onApprove={handleApprove}
          onClose={() => setIsReviewOpen(false)}
        />
      )}
```

to:

```tsx
      {isReviewOpen && (
        <BatchReviewModal
          batchName={batch.name}
          cards={batch.cards}
          isSubmitting={isSubmittingReview}
          onDiscard={handleDiscard}
          onApprove={handleApprove}
          onRemoveCard={handleRemoveCard}
          onClose={() => setIsReviewOpen(false)}
        />
      )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/builder/BatchBuilderForm.test.tsx`
Expected: PASS (18 tests — 13 existing + 5 new).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors (this also resolves the expected `tsc` gap noted at the end of Task 2).

- [ ] **Step 6: Commit**

```bash
git add src/app/builder/BatchBuilderForm.tsx src/app/builder/BatchBuilderForm.test.tsx
git commit -m "Add Undo for the last batch add, wire Review's remove button"
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

Run `npm run dev`, wait for it to serve, then on `/settings` switch Builder Mode to Batch (if not already), then on `/builder`:
- Start a batch with expected count 5. Add 2 of a real card. Confirm an "Added 2× <title> · Undo" line appears below the batch chrome.
- Click Undo. Confirm the card disappears from the batch (count back to `0 of 5`), the "Added" line disappears, and "+N in this batch" is gone from that card's search row.
- Add 2 of a card again, then add 3 more of a *different* card (bringing the total to 5, auto-stopping the batch). Confirm the search box disappears (stopped) but the "Added 3× <title> · Undo" line (for the second, most recent add) is still visible and usable.
- Click Undo from this `stopped` state. `handleUndo` calls the same shared `removeFromBatch` action Review's remove uses, so this should deterministically drop the total back to 2 (under the target of 5) and revert status to `paused` — confirm the search box reappears (no longer `stopped`) and `BatchStatusBar` now shows Continue. If it does not — if the search box stays hidden — that is a real implementation bug (Task 1's `removeFromBatch` mutation not correctly reverting status) to fix and re-verify, not an open question.
- Open Review (from whatever paused/stopped state you're in). Confirm each card row shows a "×"/Remove button. Click it on one card. Confirm the row disappears, the modal stays open, and the batch's total count updates.
- If removing a card dropped the batch below its expected count while it had been `stopped`, close the modal (Escape or the backdrop) and confirm `BatchStatusBar` now shows a **Continue** button (status reverted to `paused`). Click Continue, confirm the search box reappears, search for and add a replacement card, then Review → Approve.
- Confirm the collection's real owned quantities only reflect what was ultimately approved (matching whatever cards remained in the batch at Approve time, not anything that was added-then-undone or added-then-removed).

- [ ] **Step 4: Commit (only if manual checks required a fix)**

If Step 3 surfaced no issues, there is nothing to commit for this task — Task 3's commit already covers the working feature.
