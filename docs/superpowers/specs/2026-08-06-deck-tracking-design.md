# Deck Tracking — Design

## Overview

Adds the first piece of Phase 2 (deckbuilding) to the tracker: importing
published NetrunnerDB decklists and showing how much of each one you
already own. This is read-only import — decks aren't built or edited in
this app, they're pulled in from NetrunnerDB and checked against your
existing collection.

## Scope

In scope:
- Import a published NetrunnerDB decklist by pasting its URL or numeric
  ID (`GET https://netrunnerdb.com/api/2.0/public/decklist/{id}` —
  verified live, public, no auth required).
- Persist imported decks locally (two new tables), so they survive
  reloads like everything else in this app.
- Re-importing an already-saved deck's ID updates it in place (acts as a
  manual refresh) rather than erroring or creating a duplicate.
- A new section on `/builder`, to the right of the existing search form,
  listing imported decks with:
  - An aggregate completion stat + progress bar (`{owned}/{total} owned
    ({percent}%)`, matching the dashboard's existing set-completion
    style).
  - A per-card list showing each card's needed vs. owned quantity, with
    a shortfall highlighted the same way the set page already highlights
    an under-owned card.
  - A Remove button.
- Graceful handling of a deck card whose code isn't in our local card
  database (flagged, not a failed import) and of an invalid/unfetchable
  ID (a visible error, not a crash).

Out of scope for this round:
- Private (unpublished) NetrunnerDB decks — those require an OAuth2 app
  registration (email Null Signal Games, wait for approval), which blocks
  the whole feature on an external party. Only the public, published-
  decklist endpoint is used.
- Editing a deck's card list inside this app — decks are a read-only
  mirror of what NetrunnerDB has published; changing them means editing
  on NetrunnerDB and re-importing.
- Deck legality / MWL (banned-card list) checking. The API response
  includes an `mwl_code` field, but validating a deck against it is a
  distinct concern from "what do I own" and isn't built now.
- Automatic/periodic re-sync — a deck only updates when its ID is pasted
  in again.
- Any UI for browsing/searching NetrunnerDB's decklists — you provide a
  specific decklist's URL or ID; there's no in-app decklist search.

## NetrunnerDB integration

`GET https://netrunnerdb.com/api/2.0/public/decklist/{id}` returns:

```json
{
  "data": [{ "id": 1, "uuid": "...", "name": "...", "cards": { "01093": 1, "06030": 1 } }],
  "success": true
}
```

`cards` maps card code → quantity needed. A small module
(`src/lib/netrunnerdb.ts`) is responsible for:
- Parsing user input (a raw numeric ID, or a full URL like
  `https://netrunnerdb.com/en/decklist/12345-deck-name`) into the numeric
  decklist ID.
- Fetching that ID and normalizing the response into `{ id, uuid, name,
  cards: Record<string, number> }`, throwing a clear error for a
  non-numeric/unparseable input, a non-200 response, or `success: false`.

The fetch happens server-side (a server action), not client-side —
consistent with how every other external/DB read in this app already
works, and keeps the app, not the browser, responsible for the request.

## Data model

```prisma
model Deck {
  id         Int        @id // NetrunnerDB's own decklist id — reused directly, not a local autoincrement
  uuid       String
  name       String
  importedAt DateTime   @default(now())
  cards      DeckCard[]
}

model DeckCard {
  deckId   Int
  deck     Deck   @relation(fields: [deckId], references: [id])
  cardCode String
  quantity Int
  @@id([deckId, cardCode])
}
```

`DeckCard.cardCode` deliberately has **no** foreign-key relation to
`Card` — a decklist naming a card code this app hasn't imported (a very
new set, a typo'd/rare code) must not fail the whole import. Ownership
computation instead treats an unmatched code as "unknown," not an error.

## Ownership computation

`getDecksWithOwnership()` (`src/lib/decks.ts`) joins each deck's
`DeckCard` rows against `Card` and `CollectionEntry`, reusing the
existing `cardContribution()` helper (already in `src/lib/reports.ts`,
caps owned at needed) — the same math as set completion, just "needed by
the deck" standing in for "printed in the set." Produces, per deck:

```ts
interface DeckCardOwnership {
  code: string
  title: string | null // null when the code isn't in our local card database
  factionName: string | null
  neededQuantity: number
  ownedQuantity: number
  found: boolean
}

interface DeckSummary {
  id: number
  uuid: string
  name: string
  importedAt: Date
  ownedCount: number
  totalCount: number
  percentOwned: number
  cards: DeckCardOwnership[]
}
```

## Components

- `src/lib/netrunnerdb.ts` — decklist-ID parsing and NetrunnerDB fetch/normalize, as above.
- `src/lib/decks.ts` — `getDecksWithOwnership()`, as above.
- `src/actions/deckMutations.ts` — testable (`prisma`-first-param, matching this codebase's existing mutation-file convention) `saveDeck(prisma, id, uuid, name, cards)` (upserts the `Deck` row, replaces its `DeckCard` rows — delete-all-then-insert, same pattern as the hidden-Builder-pack list) and `removeDeck(prisma, id)`.
- `src/actions/deckActions.ts` — thin `'use server'` wrapper: `importDeck(input: string)` (parse → fetch → save → revalidate `/builder`) and `deleteDeck(id: number)`.
- `src/app/builder/page.tsx` (modified) — fetches `getDecksWithOwnership()` alongside its existing render, passes it to the new section, widens to a two-column layout (matching the `flex flex-col gap-6 lg:flex-row` pattern already used on the set page: stacked on narrow screens, side-by-side at `lg:` and up).
- `src/app/builder/DeckSection.tsx` (new) — client component: the add-deck form (input + button, loading/error states) and the deck list (completion stat, progress bar, per-card ownership list with the existing under-owned red-highlight styling, Remove button), calling `importDeck`/`deleteDeck`.

## Testing

- `netrunnerdb.test.ts` — ID parsing (raw ID, full URL, invalid input) and fetch/normalize behavior (mocking `fetch`: success, non-200, `success: false`, malformed body).
- `decks.test.ts` — `getDecksWithOwnership()` against a real seeded test DB: correct aggregate math, an under-owned card, a fully-owned card, and a deck card whose code doesn't exist locally (`found: false`, doesn't crash).
- `deckMutations.test.ts` — `saveDeck` upserts and replaces (not appends) on re-import; `removeDeck` deletes a deck and its cards.
- `DeckSection.test.tsx` — add-deck form success/error paths (mocking the server actions), deck list rendering (completion stat, per-card shortfall highlight), Remove button.
