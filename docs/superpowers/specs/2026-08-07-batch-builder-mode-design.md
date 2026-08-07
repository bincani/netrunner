# Batch Builder Mode — Design

## Overview

Adds a second way to add cards to the collection: **Batch mode**, alongside
today's builder (renamed **Simple mode** — unchanged behavior). Simple mode
adds a card to the collection immediately. Batch mode stages a whole sorting
session — start a batch with an expected card count, search/add cards as
normal but they accumulate in the batch instead of the collection, then
review and either merge the batch into the collection (Approve) or throw it
away (Discard). Both outcomes archive the batch for later reference.

This is aimed at sorting a physical stack of cards (e.g. a 60-card deck box)
in one sitting: a running timer and a live `X of Y` count track progress
through the stack, and nothing touches the real collection numbers until
you've confirmed the whole batch is right.

## Scope

In scope:
- A `Builder Mode` setting (`Simple` / `Batch`), added to `/settings` above
  "Hide Sets from Builder", persisted server-side. Simple is the default —
  today's behavior, unchanged.
- A generic key-value `Setting` table backing this and future `/settings`
  additions (the user's stated plan: settings accumulate here until this
  app eventually grows a login/account model).
- Starting a batch: requires an expected card count (a positive integer,
  e.g. 60). Name is auto-generated from the start timestamp
  (`Batch YYYY-MM-DD HH:MM`) — no user-entered name.
- Only one batch can be active (`running`/`paused`/`stopped`) at a time.
  Start is unavailable while one exists; the existing batch's UI is shown
  instead, regardless of what the `Builder Mode` setting currently says
  (see "Active batch overrides the mode setting" below).
- Searching and adding cards while a batch is active works like Simple
  mode's search (same API, same result list) but the 1/2/3/4 quantity
  buttons add to the **batch**, not the collection. No `0`/reset button —
  removing something from a batch isn't a supported action (Discard the
  whole batch instead).
- Each search result row shows a small "+N in this batch" indicator when
  the batch already contains that card, alongside the existing
  "owned: X of Y" (collection) line — the collection number never changes
  until Approve, so both numbers stay meaningfully different during a
  batch.
- Live count: sum of quantities added to the batch so far, out of the
  expected count (`23 of 60`). Counts total quantity, not distinct cards
  (adding 3 copies of one card counts as 3).
- Live timer: active elapsed time only — pausing freezes it, resuming
  continues it. Wall-clock time spent paused doesn't count.
- Auto-stop: the moment the live count reaches the expected count, the
  batch transitions to `stopped` automatically. `stopped` is a dead end —
  no Continue from there, same as reaching the natural end of a physical
  stack. The search/add UI itself is hidden (not just disabled) once
  `stopped`, leaving only the batch summary and the Review button — there
  is no path back to adding cards from this state.
- Manual Pause: from `running`, freezes the timer, batch becomes `paused`.
- Continue: from `paused`, either clicking Continue, or typing a
  non-empty search query (i.e. actually looking for a card, not merely
  clicking into the input), resumes the batch to `running`. An empty/
  cleared search does not resume it.
- Review: available only from `paused` or `stopped` (not from `running` —
  pause or let it auto-stop first). Opens a modal (reusing the existing
  `CardDetailPopup` overlay pattern) listing the batch's cards, read-only —
  title, quantity. Two actions:
  - **Discard**: batch → `discarded`. Collection is untouched. Archived.
  - **Approve**: every `BatchCard` quantity is applied to the collection
    via the same `incrementOwned` Simple mode already uses. Batch →
    `approved`. Archived.
- `/builder/batches`: a new page listing archived batches (`approved` and
  `discarded`), most recent first — name, final status, `X of Y`, elapsed
  time, and its (read-only) card list. Linked from the batch UI itself
  (a "Batch History" link), not from the main top nav.

Out of scope for this round:
- Editing a batch's card list from Review (removing/adjusting a card
  before Approve/Discard) — Discard and start over if something's wrong.
- Multiple concurrent batches.
- Renaming a batch, or any manual name entry.
- Undoing an Approve (once merged into the collection, it's merged — same
  as any other collection edit today).
- A generic `/settings`-wide framework beyond the one new `Setting` table —
  this round only adds the one Builder Mode row; no admin UI for arbitrary
  settings.

## Active batch overrides the mode setting

If an active batch exists (`running`/`paused`/`stopped`), `/builder`
renders the batch UI regardless of the current `Builder Mode` setting.
This prevents an in-progress batch from becoming invisible/orphaned if the
setting is changed mid-batch — a real edge case (settings and active-batch
state are independent) that would otherwise strand a batch with no way to
reach it from the UI.

## Data model

```prisma
model Setting {
  key   String @id
  value String
}

model Batch {
  id            Int         @id @default(autoincrement())
  name          String
  expectedCount Int
  /// 'running' | 'paused' | 'stopped' | 'approved' | 'discarded'
  status        String
  startedAt     DateTime    @default(now())
  /// Accumulated active (non-paused) time in milliseconds.
  elapsedMs     Int         @default(0)
  /// Set when status is 'running'; null otherwise. Live elapsed while
  /// running = elapsedMs + (now - lastResumedAt).
  lastResumedAt DateTime?
  cards         BatchCard[]
}

model BatchCard {
  batchId  Int
  batch    Batch  @relation(fields: [batchId], references: [id], onDelete: Cascade)
  cardCode String
  card     Card   @relation(fields: [cardCode], references: [code])
  quantity Int

  @@id([batchId, cardCode])
}
```

`Card` gains a reverse relation field (`batchCards BatchCard[]`) for the
new FK. Unlike `DeckCard`, `BatchCard.cardCode` **does** get a real FK —
batch cards only ever come from this app's own search results (always a
real local `Card`), unlike `DeckCard`'s codes (which come from an external
NetrunnerDB decklist and might not be locally imported).

`status` is a plain `String` with documented allowed values, matching this
schema's existing convention for closed-but-not-Prisma-`enum` fields (see
`Pack.setType`) — not a new pattern.

"Only one active batch" is enforced at the mutation layer (reject `Start`
if a `running`/`paused`/`stopped` batch already exists), not a DB
constraint — matching how this app already keeps this kind of invariant
in code (e.g. `Deck`'s re-import-replaces logic) rather than the schema.

## Timer & auto-stop mechanics

- `startBatch` sets `status: 'running'`, `lastResumedAt: now`.
- `pauseBatch` computes `elapsedMs += (now - lastResumedAt)`, sets
  `status: 'paused'`, `lastResumedAt: null`.
- `continueBatch` sets `status: 'running'`, `lastResumedAt: now` (leaves
  the accumulated `elapsedMs` alone).
- Resume-on-search is client-triggered, not add-triggered: `BatchBuilderForm`
  calls `continueBatch()` once, the moment its search input transitions
  from empty to a non-empty query while the batch is `paused` (not on
  every keystroke — a client-side "was paused, now searching" edge, then
  the batch is `running` for the rest of that search session). This
  matches "looking for a new card" resuming the batch even before
  anything is actually added.
- `addCardToBatch`: upserts the `BatchCard` row (increment quantity, same
  shape as `incrementOwned`); if the new total quantity across all
  `BatchCard`s ≥ `expectedCount` and the batch is currently `running`,
  folds elapsed time the same way `pauseBatch` does and sets
  `status: 'stopped'`. (By this point the batch is always `running` —
  either it already was, or the client's resume-on-search call already
  transitioned it before the add.)
- The client renders a ticking display via a local `setInterval` computed
  from `elapsedMs`/`lastResumedAt`/`status` (fetched at load and after
  every mutation) — no server polling needed between actions.

## Components

- `src/actions/settingsMutations.ts` (extended) — `getSetting(prisma, key): Promise<string | null>`, `setSetting(prisma, key, value): Promise<void>` (upsert), built on the new `Setting` table; `getBuilderMode`/`setBuilderMode` as thin wrappers with `'simple'` as the fallback when unset.
- `src/actions/settingsActions.ts` (extended) — `updateBuilderMode(mode: 'simple' | 'batch'): Promise<void>` `'use server'` wrapper, revalidates `/builder`.
- `src/app/settings/SettingsForm.tsx` (modified) — new "Builder Mode" section above "Hide Sets from Builder", a two-button toggle in `ThemeToggle`'s visual style.
- `src/lib/batches.ts` (new) — read-side: `getActiveBatch(prisma): Promise<BatchSummary | null>`, `listArchivedBatches(prisma): Promise<BatchSummary[]>`, computing live `elapsedMs`/count/percent from the raw rows.
- `src/actions/batchMutations.ts` (new) — testable (`prisma`-first-param): `startBatch`, `addCardToBatch`, `pauseBatch`, `continueBatch`, `discardBatch`, `approveBatch` (the last iterates the batch's cards through `incrementOwned`).
- `src/actions/batchActions.ts` (new) — `'use server'` wrappers around the above, revalidating `/builder` and `/builder/batches` as appropriate.
- `src/app/builder/page.tsx` (modified) — server component: reads the Builder Mode setting and `getActiveBatch()`; renders `CardBuilderForm` (simple, unchanged) unless an active batch exists or the mode is `batch`, in which case it renders the new `BatchBuilderForm`.
- `src/app/builder/BatchBuilderForm.tsx` (new) — client component. Two states: no active batch (expected-count input + Start button), or an active batch (search input + results with add-to-batch buttons and the "+N in this batch" indicator, plus batch chrome: name, live timer, `X of Y`, Pause/Continue as appropriate, Review when paused/stopped, and a link to Batch History). Duplicates `CardBuilderForm`'s small search-fetch logic rather than adding a mode branch to `CardBuilderForm` itself, keeping Simple mode completely unmodified and isolated from batch-mode risk.
- `src/components/BatchReviewModal.tsx` (new) — the Review overlay, reusing `CardDetailPopup`'s `fixed inset-0 bg-black/80` modal pattern: card list (title, quantity), Discard and Approve buttons.
- `src/app/builder/batches/page.tsx` (new) — archived batches list: name, status, `X of Y`, elapsed time, per-batch card list.

## Testing

- `settingsMutations.test.ts` (extended) — `getSetting`/`setSetting` round-trip against a real seeded test DB; `getBuilderMode` falls back to `'simple'` when unset.
- `batches.test.ts` (new) — `getActiveBatch` returns the one running/paused/stopped batch or null; `listArchivedBatches` returns approved/discarded batches, most recent first; live elapsed/count computed correctly from raw rows.
- `batchMutations.test.ts` (new) — `startBatch` rejects when an active batch already exists; `addCardToBatch` accumulates quantity and auto-stops a `running` batch at the expected count; `pauseBatch`/`continueBatch` correctly freeze/resume `elapsedMs`; `approveBatch` applies every card to `CollectionEntry` via the same math as `incrementOwned` and archives the batch; `discardBatch` archives without touching `CollectionEntry`.
- `BatchBuilderForm.test.tsx` (new) — start form (validates a positive integer count), add-to-batch flow (mocking the server actions), Pause/Continue, resume-on-search from paused (typing a query calls `continueBatch` once, not on every keystroke), auto-stop transition, Review button visibility (only paused/stopped), "+N in this batch" indicator.
- `BatchReviewModal.test.tsx` (new) — renders the card list; Discard/Approve call the right actions.
- No new test file for `/builder/batches/page.tsx` or the modified `/builder/page.tsx` — both are thin server-rendered data-fetching wrappers, matching this codebase's existing convention (`builder/page.tsx`, `reports/sets-missing-image/page.tsx` have none either); verified instead by a manual check during implementation.
