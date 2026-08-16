# Quick Add Set — Design

## Overview

Adds a fast path for a set you already know you own complete: a "⚡" icon
on each set row on the dashboard opens a small dialog offering **Quick
Add** (bring every card in the set up to a full playset) or **Clear Set**
(zero every card's owned quantity in that set), each followed by an
ephemeral, one-click **Undo** — the same "just did this, click to fix it"
shape as the existing Batch Undo feature, but standalone: this doesn't
touch Batch Builder Mode or its tables at all, since Batch's search-and-
review ceremony doesn't fit an instant, already-know-the-answer action.

## Scope

In scope:
- A "⚡" icon on each set row in the dashboard's set list
  (`SetProgressList`), opening a confirmation dialog for that set.
- **Quick Add**: raises every card in the set to its printed quantity
  (`Card.quantity ?? 1`) — never lowers a card you already own more of
  than the print run (e.g. a second box). Dialog copy adapts to the
  set's current state:
  - Untouched (`ownedCount === 0`): "Add all {totalCount} cards from
    {packName} to your collection?"
  - Partial (`0 < ownedCount < totalCount`): "You already own
    {ownedCount} of {totalCount} cards in {packName}. Quick Add will
    bring every card up to a full playset — it won't reduce anything you
    already own. Continue?"
  - Already fully owned (`ownedCount === totalCount`): Quick Add is
    disabled ("This set is already fully owned").
- **Clear Set**: zeros every card in the set that currently has any
  owned quantity. A second, danger-styled button in the same dialog,
  requiring its own two-step confirm (mirroring `DeckSection`'s existing
  Delete pattern — click once, the button becomes "Are you sure? [Yes,
  Clear] [Cancel]"). Disabled when `ownedCount === 0` (nothing to clear).
- **Undo**: after either action, the dialog closes and the affected row
  shows an inline "{Added|Cleared} {N} cards · Undo" line (same idea and
  placement as `BatchBuilderForm`'s post-add Undo line). Clicking it
  restores every changed card to its exact prior quantity — not just
  zero/full, the literal value it had before, including a value above
  the printed quantity. Ephemeral: tracked as plain client state (one
  most-recent action, replaced by the next Quick Add/Clear on any row,
  lost on reload) — not a database table, matching Batch Undo's existing
  "not persisted" precedent.
- Icon on the dashboard set list only (`SetProgressList`) — not the
  individual `/sets/[packCode]` page.

Out of scope for this round:
- The set detail page (`/sets/[packCode]`) getting its own Quick
  Add/Clear entry point.
- Any interaction with Batch Builder Mode — Quick Add/Clear write
  directly to `CollectionEntry` and never touch `Batch`/`BatchCard`;
  there's no "only one active thing" conflict to resolve because the two
  features don't share state.
- Multi-level undo (only the single most recent Quick Add/Clear action
  can be undone, same scope limit as Batch Undo).
- Undo surviving a page reload, or protecting against an unrelated edit
  to one of the same cards made through another tab/page between the
  action and clicking Undo (the snapshot restores to whatever value it
  captured, which could stomp an intervening edit) — an accepted,
  documented tradeoff of ephemeral client-tracked undo, not a gap to
  close here.
- Packs with no declared size (`Pack.size === null`, e.g. `draft`) —
  `SetProgressList` never renders these rows at all today, so Quick
  Add/Clear's row-scoped icon never has to consider them.

## Mutations

New `src/lib/quickSet.ts`:

```ts
export interface QuickSetChange {
  cardCode: string
  previousQuantity: number
}

/**
 * Raises every card in packCode to its printed quantity, never lowering
 * an already-higher count. Returns only the cards that actually
 * changed (their quantity before the change) — the undo snapshot.
 */
export async function quickAddSet(
  prisma: PrismaClient,
  collectionId: number,
  packCode: string
): Promise<QuickSetChange[]>

/**
 * Zeros every card in packCode that currently has a nonzero owned
 * quantity. Returns only the cards that actually changed.
 */
export async function clearSet(
  prisma: PrismaClient,
  collectionId: number,
  packCode: string
): Promise<QuickSetChange[]>

/** Restores each listed card to its previousQuantity exactly. Shared by both Quick Add's and Clear Set's Undo. */
export async function undoQuickSetChange(
  prisma: PrismaClient,
  collectionId: number,
  changes: QuickSetChange[]
): Promise<void>
```

All three read the pack's cards via `prisma.card.findMany({ where: {
packCode } })`, and use `prisma.$transaction` for the batch of upserts —
same shape as `incrementOwned`/`setOwned` in `src/lib/collection.ts`
(which `quickAddSet`/`clearSet`/`undoQuickSetChange` call per-card rather
than duplicating the upsert logic). No new tables — this is entirely
`CollectionEntry` writes.

## Actions

New `src/actions/quickSetActions.ts` — thin `'use server'` wrappers, not
unit-tested directly (matches `deckActions.ts`'s convention: pure pass-
throughs with no transformation logic of their own to cover, unlike
`discoverActions.ts`'s card-mapping case which needed its own test):

```ts
export type QuickSetResult = { ok: true; changes: QuickSetChange[] } | { ok: false; error: string }

export async function quickAddSet(collectionId: number, packCode: string): Promise<QuickSetResult>
export async function clearSet(collectionId: number, packCode: string): Promise<QuickSetResult>
export async function undoQuickSetChange(collectionId: number, changes: QuickSetChange[]): Promise<SimpleActionResult>
```

Each wraps its `quickSet.ts` call in try/catch, returning `{ ok: false,
error: err instanceof Error ? err.message : '...' }` on failure (the
`deckActions.ts` idiom), and calls `revalidatePath('/')` on success.

## Components

- `src/app/page.tsx` (modified) — passes `collectionId={collection.id}`
  to `SetProgressList` (explicit, matching this codebase's "collectionId
  as an early explicit param" convention — not re-resolved from
  "default" inside a client component).
- `src/app/SetProgressList.tsx` (modified):
  - A "⚡" button added to each set row, `aria-label="Quick add
    {packName}"`.
  - New state: `quickAddPackCode: string | null` (which row's dialog is
    open — only one at a time) and `lastAction: { packCode: string;
    verb: 'Added' | 'Cleared'; changes: QuickSetChange[] } | null`.
  - Renders `QuickAddSetModal` when `quickAddPackCode` is set, passing
    the matching `SetCompletion` row, `collectionId`, `onClose`, and
    `onDone(verb, changes)` (sets `lastAction`, closes the modal).
  - Renders the row's "{verb} {changes.length} cards · Undo" line when
    `lastAction?.packCode` matches that row, right under its progress
    bar (same placement idea as `BatchBuilderForm`'s post-add Undo line,
    under `BatchStatusBar`). Clicking Undo calls `undoQuickSetChange`
    and clears `lastAction` on success.
- `src/components/QuickAddSetModal.tsx` (new) — the confirmation dialog,
  reusing the existing `fixed inset-0 bg-black/80` portal pattern from
  `CardDetailPopup`/`BatchReviewModal`:
  - Header: `{packName} — {ownedCount}/{totalCount} owned
    ({percentOwned}%)`.
  - Body copy: the three variants described in Scope above.
  - **Quick Add All Cards** button (primary), disabled when
    `ownedCount === totalCount`.
  - **Clear Set** button (secondary, danger-styled), disabled when
    `ownedCount === 0`. Clicking it swaps the dialog to "Are you sure?
    This removes {ownedCount} cards' worth of quantity. [Yes, Clear]
    [Cancel]" — matching `DeckSection`'s existing two-step Delete
    pattern rather than inventing a new confirm style.
  - Cancel/close (backdrop click, Escape, explicit button) calls
    `onClose` without touching anything.
  - Calls `quickAddSet`/`clearSet` from `quickSetActions.ts` directly
    (a "smart" component, unlike `BatchReviewModal`'s deliberately dumb/
    callback-only design — there's no parent-owned mutation call to
    reuse here since `SetProgressList` only needs the *result* to render
    the Undo line, not to own the request itself).

## Testing

- `src/lib/quickSet.test.ts` (new) — `quickAddSet`: raises 0→printed;
  never lowers an already-higher-than-printed count; a card already
  at/above printed quantity is excluded from the returned changes
  (nothing to undo for it); falls back to 1 for a null printed quantity.
  `clearSet`: zeros only currently-nonzero cards; already-zero cards
  excluded from returned changes. `undoQuickSetChange`: restores exact
  prior values, including a value above the printed quantity. Multi-
  collection isolation throughout (same pattern as
  `decks.test.ts`/`cards.test.ts`).
- `src/components/QuickAddSetModal.test.tsx` (new) — the three body-copy
  variants; Quick Add disabled when fully owned; Clear Set disabled when
  nothing owned; Clear Set's two-step confirm; Cancel/close call neither
  action; a successful action calls `onDone` with the right verb and
  changes.
- `src/app/SetProgressList.test.tsx` (extended) — the icon opens the
  modal for the right row (and only that row); a successful Quick
  Add/Clear shows that row's "Undo" line with the right verb/count;
  clicking Undo calls `undoQuickSetChange` with the tracked changes and
  clears the line; triggering a new action on a different row replaces
  the previous row's Undo line rather than showing two at once.
