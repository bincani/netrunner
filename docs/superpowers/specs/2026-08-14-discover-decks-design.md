# Discover Decks (bulk tournament-deck buildability) — Design

## Overview

Adds a second, distinct way of finding decks: instead of pasting one
NetrunnerDB decklist URL/ID at a time (the existing `/decks` "My Decks"
feature), this bulk-crawls NetrunnerDB's published tournament decklists
and lets you browse which ones you can already build — or nearly build —
from your collection. A new `/discover` page shows this pool, filterable
by buildability/faction and sortable, with a one-click "Save to My Decks"
per deck. This is still read-only with respect to NetrunnerDB — nothing
is built or edited in this app, and nothing is written back to
NetrunnerDB.

## Scope

In scope:
- A checkpointed CLI backfill/sync script (`npm run sync-decks`) that
  crawls NetrunnerDB's public `decklists/by_date` endpoint day-by-day and
  persists every **tournament-flagged** (`tournament_badge: true`)
  decklist it finds, going back to NetrunnerDB's earliest decklists
  (~2012).
- A new `/discover` page listing the synced pool, with:
  - Default view: fully buildable decks only (you own every card in the
    needed quantity).
  - A "missing ≤ N cards" toggle to widen the view to near-buildable
    decks (N = total missing copies needed across the deck, not distinct
    card lines).
  - A faction filter.
  - Sort by % owned / newest / name.
  - "Load more" pagination (25 at a time).
  - A "Save to My Decks" action per deck, reusing the existing `Deck`
    persistence so it then shows up (and can be tracked/removed) exactly
    like a manually-imported deck.
- A new `Discover` link in the primary nav, alongside Dashboard / Builder
  / Decks.
- Small shared presentational components (completion progress bar,
  per-card ownership list with shortfall highlighting) factored out of
  the existing `DeckSection` so both features render decks identically
  without duplicating JSX.

Out of scope for this round:
- Non-tournament decklists. NetrunnerDB has published far more casual
  decks than tournament ones; the public API gives no way to bulk-fetch
  by anything other than calendar day, so pulling *everything* would mean
  the same ~5,000-request crawl but storing an order of magnitude more
  low-signal decks. Tournament-only is the deliberate cut for this round;
  revisit if the pool turns out too sparse to be useful.
- Deck legality / MWL checking (`mwl_code` is stored but not
  interpreted) — same deferral as the existing deck-tracking feature.
- Automatic/scheduled re-sync. `npm run sync-decks` is run manually,
  same as `npm run import-cards`.
- Editing, favoriting, or any state on `TournamentDeck` rows beyond what
  syncing itself writes — "Save to My Decks" is the only action a
  `TournamentDeck` supports; everything else (removal, notes, etc.)
  happens on the saved `Deck` copy via the existing `/decks` UI.

## NetrunnerDB integration

Confirmed live against the current public API (`api/doc`):

- `GET https://netrunnerdb.com/api/2.0/public/decklists/by_date/{YYYY-MM-DD}`
  — every decklist published on that single calendar date. This is the
  *only* bulk-listing endpoint the public API exposes: no date-range, no
  search-by-card/faction, no pagination params. Getting the full deck
  history means one request per calendar day since NetrunnerDB's
  decklists began.

  ```json
  {
    "id": 69743,
    "uuid": "4e91a0d3-0a96-476f-a190-c70b179e23c7",
    "date_creation": "2022-05-07T04:53:59+00:00",
    "date_update": "2022-05-07T04:53:59+00:00",
    "name": "virus garbo",
    "description": "\n",
    "user_id": 39520,
    "user_name": "momar",
    "tournament_badge": false,
    "cards": { "01001": 1, "01002": 2, "...": 3 },
    "mwl_code": null
  }
  ```

  Same `cards` map shape (code → quantity) as the existing single-decklist
  endpoint, plus `date_creation`/`date_update`, `user_name`, and
  `tournament_badge`.

- **`date_creation` is not used as a buildability signal.** It's
  displayed for reference, but whether a deck is "buildable" is computed
  exactly from its `cards` map against the local `Card`/`CollectionEntry`
  tables — the same math the existing single-deck-import feature already
  does — not inferred from when the deck was published relative to a set
  release.
- No documented rate limit; the script adds a small (~150ms) delay
  between requests as basic politeness. A full backfill is ~5,000
  requests, roughly 15 minutes.

## Data model

```prisma
model TournamentDeck {
  id           Int                  @id // NetrunnerDB's own decklist id, reused directly
  uuid         String
  name         String
  dateCreation DateTime             // NetrunnerDB's date_creation — display only
  userName     String
  factionCode  String?              // denormalized from the identity card at sync time
  cards        TournamentDeckCard[]
}

model TournamentDeckCard {
  deckId   Int
  deck     TournamentDeck @relation(fields: [deckId], references: [id], onDelete: Cascade)
  cardCode String
  quantity Int
  @@id([deckId, cardCode])
}
```

Deliberately separate from `Deck`/`DeckCard` (the existing "My Decks"
tables) — this is a bulk, disposable-and-re-syncable pool, not the
curated list a user has explicitly chosen to track. `TournamentDeckCard`
has no foreign key to `Card`, same rationale as `DeckCard`: a decklist
naming a code this app hasn't imported must not fail the sync.

The sync checkpoint (last calendar day successfully crawled) is one row
in the existing generic `Setting` table (`key:
"tournamentDecksSyncedThrough"`), not a new table for a single value —
consistent with `Setting`'s existing role as the one place small
persisted app state lives.

## Sync script

`scripts/syncDecks.ts` (invoked via `npm run sync-decks`, modeled on the
existing `import-cards` script):

1. Read the `tournamentDecksSyncedThrough` setting. If absent, start from
   a hardcoded floor date (NetrunnerDB's decklists begin ~2012); if
   present, start from the day after it.
2. Walk forward one calendar day at a time through yesterday (inclusive).
   For each date:
   - `GET /api/2.0/public/decklists/by_date/{date}`.
   - Filter to `tournament_badge === true`.
   - For each kept decklist: look up its identity's `factionCode` from
     the local `Card` table (identity = the card whose `typeCode` is
     `identity` among the deck's `cards` keys); upsert into
     `TournamentDeck`, delete-and-replace its `TournamentDeckCard` rows
     (same pattern as `saveDeck`).
   - Persist the checkpoint as *this* date, immediately after the day's
     upserts succeed — not batched to the end of the run — so an
     interrupted run resumes at the next unsynced day rather than
     re-walking from the last full success.
   - Log a progress line: `{date}: {total} decks ({tournamentCount}
     tournament)`.
3. On a non-200 response or malformed body for a given day: log the
   failure and stop the run (the checkpoint reflects the last
   *successful* day, so re-running resumes cleanly at the failed day
   rather than silently skipping it).
4. Print a final summary: days walked, tournament decks added/updated.

## Buildability computation

`src/lib/discover.ts` (new, alongside `decks.ts` — not a modification of
it):

```ts
export interface DiscoverFilters {
  faction?: string
  maxMissingCards?: number // omitted/undefined = fully-buildable-only
  sort: 'percentOwned' | 'newest' | 'name'
  limit: number
  offset: number
}

export interface DiscoverDeck {
  id: number
  uuid: string
  name: string
  dateCreation: Date
  userName: string
  factionCode: string | null
  ownedCount: number
  totalCount: number
  percentOwned: number
  missingCopies: number // sum of max(0, needed - owned) across cards
  cards: DeckCardOwnership[] // reuses the existing shape from decks.ts
}

export async function getDiscoverDecks(
  prisma: PrismaClient,
  collectionId: number,
  filters: DiscoverFilters
): Promise<{ decks: DiscoverDeck[]; total: number }>
```

Bulk-oriented, unlike `computeDeckSummary`'s per-deck queries — the pool
here is much larger:

1. One query: all `CollectionEntry` rows for `collectionId`.
2. One query: all `TournamentDeck` + their `TournamentDeckCard` rows.
3. One query: all locally-known `Card` codes (for the `found` flag on
   each card, same meaning as in `decks.ts`).
4. Compute `ownedCount`/`totalCount`/`percentOwned`/`missingCopies` in
   memory per deck, reusing the existing `cardContribution()` helper —
   identical math to the single-deck feature, run once over the whole
   pool instead of per-deck.
5. Apply `faction`/`maxMissingCards` filtering and `sort` in memory, then
   slice `[offset, offset + limit)` for the page; return `total` (post-
   filter, pre-slice count) so the UI knows whether "Load more" applies.

Default filter (page's initial load, no query params): `maxMissingCards`
unset → fully-buildable-only, `sort: 'percentOwned'`.

**Save to My Decks:** calls the existing `saveDeck(prisma, id, uuid,
name, cards)` (`src/actions/deckMutations.ts`) directly, passing the
`TournamentDeck`'s already-loaded `cards` — no NetrunnerDB re-fetch.

## Components

- `scripts/syncDecks.ts` — the sync script, as above.
- `src/lib/discover.ts` — `getDiscoverDecks()`, as above.
- `src/actions/discoverActions.ts` — thin `'use server'` wrapper:
  `saveDiscoveredDeck(id: number)` (loads the `TournamentDeck`, calls the
  existing `saveDeck`, revalidates `/decks` and `/discover`).
- `src/components/DeckCompletionBar.tsx` (new) — extracted from
  `DeckSection`: the `{owned}/{total} owned ({percent}%)` stat + progress
  bar, taking `ownedCount`/`totalCount`/`percentOwned` as props. Used by
  both `DeckSection` and `DiscoverSection`.
- `src/components/DeckCardList.tsx` (new) — extracted from `DeckSection`:
  the per-card ownership list with shortfall highlighting, taking
  `DeckCardOwnership[]` as props. Used by both.
- `src/app/discover/page.tsx` (new) — server component, `dynamic =
  'force-dynamic'` (reflects live collection state, same rationale as
  `/decks` and the dashboard). Reads filters/sort/offset from URL search
  params, calls `getDiscoverDecks()`, renders `DiscoverSection`.
- `src/app/discover/DiscoverSection.tsx` (new) — client component: faction
  dropdown, "missing ≤ N cards" toggle + number input, sort dropdown,
  deck list (using `DeckCompletionBar`/`DeckCardList`), "Load more"
  button, "Save to My Decks" button per deck (disabled/labeled once
  saved — check against already-saved `Deck` ids passed down from the
  page).
- `src/components/PrimaryNav.tsx` (modified) — add the `Discover` link.

## Testing

- `syncDecks.test.ts` — checkpoint-absent (starts at floor date) and
  checkpoint-present (resumes after it) paths; tournament-only filtering;
  upsert-replaces (not appends) on re-sync of an already-synced day;
  checkpoint advances per-day, not just at run end; stops (without
  advancing past the failed day) on a non-200/malformed response; mocked
  `fetch`.
- `discover.test.ts` — against a seeded test DB: fully-owned deck,
  partially-owned deck's `missingCopies` count, a deck card whose code
  isn't found locally, faction filter, each sort order, `maxMissingCards`
  filtering, pagination (`total` vs. sliced `decks`).
- `discoverActions.test.ts` — `saveDiscoveredDeck` correctly persists into
  `Deck`/`DeckCard` via the existing `saveDeck` mutation.
- `DiscoverSection.test.tsx` — filter/sort interactions update the
  rendered list, Save button (mocked action) shows a saved state,
  "Load more" appends the next page.
- `DeckCompletionBar.test.tsx` / `DeckCardList.test.tsx` — the extracted
  components render correctly in isolation (covering what `DeckSection`'s
  existing tests implicitly covered before extraction).
