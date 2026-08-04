# Netrunner Collection Tracker — Phase 1 Design

## Overview

A personal, local-only web app for tracking a physical *Android: Netrunner*
card collection. Phase 1 covers importing the full card pool, recording what
you own, and reporting on set completion. A later phase will add
deckbuilding ("what decks can I build with what I own") on top of this
foundation — that is explicitly out of scope here.

## Scope (Phase 1)

In scope:
- Import the full card pool — every set from both the original FFG era
  (2012–2018) and the Null Signal Games (NSG) continuation (System Gateway
  onward) — from NetrunnerDB data.
- Collection builder: search for a card, pick a quantity (1–4), click Add.
  Add **increments** the existing owned count (e.g. own 1, add 2 more → 3
  owned) rather than overwriting it.
- Reports: percentage of each set owned, and an overall collection total,
  ordered by cycle/release date.
- Set browser: view every card in a given set, see which are owned vs.
  missing, and directly correct the owned quantity for any card (not capped
  at 4 — physical ownership can exceed a normal playset).

Out of scope (future phases):
- Deckbuilding / suggesting buildable decks from the collection.
- Multi-user accounts or authentication (single user, no login).
- Deployment beyond local dev (`npm run dev` on the user's own machine).

## Data source

**NetrunnerDB v2.0** (`https://netrunnerdb.com/api/2.0/public/...`) is the
current stable, production API. A v3 API exists at
`api-preview.netrunnerdb.com` but is explicitly labeled preview/unstable, so
this project targets v2.0 semantics.

Rather than hitting a live API repeatedly during development and on every
import, the app imports from the
[**Null-Signal-Games/netrunner-cards-json**](https://github.com/Null-Signal-Games/netrunner-cards-json)
GitHub repo — the same underlying data source that powers netrunnerdb.com
itself, and actively maintained as new sets release. Relevant files:

- `packs.json` — sets
- `cycles.json` — groupings of sets
- `v2/cards.json` — card/printing data
- `factions.json`
- `types.json`
- `sides.json` (Corp / Runner)

Card images are **hotlinked** from NetrunnerDB's CDN by card code at render
time, not downloaded or stored locally. The exact current URL pattern must
be confirmed against the live site at implementation time (it has moved
before, e.g. `card-images.netrunnerdb.com/.../<code>.jpg`-style paths
historically) rather than assumed from memory.

Cards are modeled **per-printing** (one row per unique card-in-a-set), not
deduplicated by title — this is what makes "percentage of set owned"
possible, since the same card title can be printed in multiple sets as
distinct printings with distinct set membership.

## Tech stack

- **Next.js (App Router) + TypeScript** — single local process, one
  `npm run dev` runs the whole app, no separate backend service to manage.
- **SQLite via Prisma** — file-based DB (`data/netrunner.db`), zero server
  setup, trivial to back up (copy the file), typed queries and schema
  migrations via Prisma.
- **Tailwind CSS** for styling.
- **Vitest** for unit tests.

Rationale: this is a local, single-user tool, so a full client/server split
or a networked database would be pure overhead. A single TypeScript codebase
also keeps phase 2 (deckbuilding logic) simple to add alongside the existing
collection code rather than in a separate service.

## Data model

- `Cycle` — `code` (PK), `name`, `position`
- `Pack` — `code` (PK), `name`, `cycleCode` → `Cycle`, `position`, `size`
  (declared card count in the set), `dateRelease`
- `Faction` — `code` (PK), `name`, `side`
- `CardType` — `code` (PK), `name`, `side`
- `Card` — `code` (PK, one row per printing), `title`, `typeCode` →
  `CardType`, `factionCode` → `Faction`, `packCode` → `Pack`, `sideCode`,
  `cost`, `influenceCost`, `text`, `deckLimit`, plus other NetrunnerDB
  printing fields as needed (keywords, strength, uniqueness, etc.)
- `CollectionEntry` — `cardCode` → `Card` (unique), `quantityOwned` (int).
  A row only exists for cards the user has interacted with; "owned" means
  `quantityOwned > 0`.

## Flows

1. **Import** (`npm run import-cards`): fetches the JSON data above and
   upserts `Cycle`, `Pack`, `Faction`, `CardType`, `Card` rows inside a
   single transaction — a failed import never leaves partial data. Re-runnable
   any time a new set is released; no code changes required to pick up new
   cards.
2. **Collection builder**: type-ahead search over card title (filterable by
   faction / type / set / side) → pick a card from results (shown with
   image, faction, set) → pick a quantity 1–4 → **Add**, which increments
   `CollectionEntry.quantityOwned` for that exact printing (creating the row
   if it didn't exist).
3. **Reports**: for each `Pack`, `(# distinct Cards with quantityOwned > 0
   in that pack) / Pack.size` → percentage, displayed as a progress bar per
   set, ordered by cycle/release date, plus an overall total across the
   whole card pool.
4. **Set browser**: drill into a `Pack` → list every `Card` in it, owned
   ones visually distinct from missing ones, with an inline quantity editor
   (any non-negative integer, not capped at 4) to directly correct the
   owned count for any card.

## Error handling

- Import runs inside a DB transaction; a network failure or malformed data
  mid-import rolls back rather than leaving the DB half-populated.
- Quantity inputs (both the builder's 1–4 picker and the set browser's free
  editor) are validated as non-negative integers.
- No auth/session model, so no permission-error paths to design.

## Testing

- Vitest unit tests around the two pieces of real logic: the per-set
  completion-percentage calculation, and the collection-builder's
  increment-on-add behavior (vs. the set-browser's direct-overwrite
  behavior).
- UI flows (search, add, reports, set browser) verified manually against
  the running dev server at implementation time.
