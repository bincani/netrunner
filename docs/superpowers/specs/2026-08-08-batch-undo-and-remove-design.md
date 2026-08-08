# Batch Undo and Remove — Design

## Overview

Two corrections to Batch Builder Mode's card list, both addressing "I added
the wrong thing":

- **Undo**: after adding a card, a small "Added N× Title · Undo" line lets
  you immediately reverse that specific add.
- **Remove (in Review)**: each card in the Review modal gets a "×" to
  remove it from the batch entirely, so a mistake spotted at review time
  doesn't require discarding the whole batch and starting over.

Both are corrections to an in-progress batch, not edits to a finished one
— Review's Discard/Approve are still the only ways to end a batch, and
once `approved`/`discarded` nothing here applies.

## Scope

In scope:
- One new mutation, `removeFromBatch(prisma, batchId, cardCode, amount)`,
  shared by both features — it decrements a `BatchCard`'s quantity by
  `amount`, deleting the row if that reaches 0. Callable while `running`,
  `paused`, or `stopped` (rejected for `approved`/`discarded`).
- If removing drops the batch's total below `expectedCount` while it was
  `stopped`, status reverts to `paused` — reusing the existing paused
  state and its existing Continue button rather than adding a new state
  or a second "un-stop" rule.
- **Undo**: tracked as plain client state in `BatchBuilderForm`
  (`{ code, title, amount } | null`) — set after every successful add,
  cleared after a successful Undo or replaced by the next add. Not
  persisted (lost on reload) — this is a "fix it right now" control, not
  an edit history. Visible regardless of `running`/`paused`/`stopped`,
  including `stopped`, specifically so an add that happened to trigger
  auto-stop can still be undone without opening Review first. Calls
  `removeFromBatch` with the tracked `amount`.
- **Remove (in Review)**: a "×" per card row in `BatchReviewModal`, always
  removing that card's full current quantity (not a partial decrement).
  No confirmation dialog (matches this app's existing lightweight style —
  Discard doesn't confirm either) and no per-row loading indicator
  (matches `DeckSection`'s existing Remove button). The modal stays open
  after a removal so you can keep reviewing.
- `BatchReviewModal` stays a "dumb" presentational component — a new
  `onRemoveCard(code: string)` callback prop, no server-action import of
  its own. `BatchBuilderForm` owns the actual mutation call and the
  resulting state update, same pattern already used for
  `onDiscard`/`onApprove`.

Out of scope:
- Undoing more than the single most recent add (no multi-level undo
  stack).
- Partial removal in Review (reducing a card's quantity by less than the
  full amount) — full removal only, matching the "remove X next to each
  card" request.
- A dedicated "Continue" button inside the Review modal. Removing a card
  while `stopped` flips status to `paused` per the rule above, so closing
  the modal (existing Close/Escape/backdrop) reveals `BatchStatusBar`'s
  already-existing Continue button underneath — no new button needed.
- Undo/remove surviving a page reload.

## Mutation

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

Note this does **not** touch `elapsedMs`/`lastResumedAt` — a `stopped`→
`paused` transition here is a pure status correction (the timer was
already frozen at auto-stop time by `freeze()`; reverting to `paused`
doesn't need to re-freeze anything, and the existing `continueBatch`
already knows how to resume a `paused` batch's timer correctly).

## Action

Append to `src/actions/batchActions.ts` (reuses the existing
`withActiveBatch` helper — after a removal the batch is always still
active, matching every other action that uses it):

```ts
export async function removeFromBatch(
  batchId: number,
  cardCode: string,
  amount: number
): Promise<BatchActionResult> {
  return withActiveBatch(() => removeFromBatchMutation(prisma, batchId, cardCode, amount))
}
```

(with `removeFromBatchMutation` the aliased import, matching this file's
existing `X as XMutation` convention for every other action.)

## Components

- `src/app/builder/BatchBuilderForm.tsx` (modified):
  - New state: `lastAdded: { code: string; title: string; amount: number } | null`.
  - `handleAdd` sets `lastAdded` on a successful add.
  - New `handleUndo()`: calls `removeFromBatch(batch.id, lastAdded.code, lastAdded.amount)`;
    on success, updates `batch` from the result and clears `lastAdded`.
  - New `handleRemoveCard(code: string)`: looks up that card's current
    quantity from `batch.cards`, calls
    `removeFromBatch(batch.id, code, thatQuantity)`; on success, updates
    `batch` from the result. Passed to `BatchReviewModal` as
    `onRemoveCard`.
  - JSX: a small line rendered whenever `lastAdded` is set — "Added
    {amount}× {title}" plus an Undo button — placed right after
    `BatchStatusBar`, outside the `batch.status !== 'stopped'` guard (so
    it survives into the stopped view).
- `src/app/builder/BatchReviewModal.tsx` (modified): each `<li>` gets a
  "×" button after the quantity, `aria-label={`Remove ${card.title}`}`,
  calling `onRemoveCard(card.code)`. New required prop:
  `onRemoveCard: (code: string) => void`.

## Testing

- `batchMutations.test.ts` (extended) — `removeFromBatch`: removes a
  partial quantity (row survives with reduced quantity); removes the full
  quantity (row deleted); rejects removing more than the current
  quantity; rejects on `approved`/`discarded` status; reverts `stopped`
  to `paused` when the removal drops the count below `expectedCount`;
  stays `stopped` if the count is still at/above target after removal (a
  batch with 2 different cards at target, removing part of one doesn't
  necessarily drop the total below target); works without a status change
  while `running` or already `paused`.
- `BatchBuilderForm.test.tsx` (extended) — Undo line appears after a
  successful add with the right card/amount text; clicking Undo calls
  `removeFromBatch` with the tracked code/amount and clears the line;
  Undo remains visible/usable when the batch is `stopped`; a new add
  replaces what Undo would reverse.
- `BatchReviewModal.test.tsx` (extended) — each row renders a Remove
  button; clicking it calls `onRemoveCard` with that row's code; the
  modal does not close after a removal (no `onClose` call from that
  button). `onRemoveCard` is a new **required** prop, so all 8 existing
  `render(<BatchReviewModal .../>)` calls in this file need
  `onRemoveCard={vi.fn()}` added too — `npx tsc --noEmit` will catch any
  missed call, but the implementing task should do this in one pass
  rather than discover it via the type-check (this exact gap — a new
  required prop breaking pre-existing render calls — already happened
  once in this project's Settings work; don't repeat it).
