# Format & Legality — Design

## Overview

Adds format legality information — currently absent from this app entirely
— to card and deck displays: which of Null Signal Games' 7 supported
formats a card is currently allowed in (and any ban/restriction on it),
and, per deck, a simple per-format "legal / not legal" rollup. This is
read-only, informational, and computed at import time from the same
NetrunnerDB data source this app already pulls from — it does not attempt
full deck-construction validation (influence budgets, deck-size, agenda
points), which remains deliberately deferred alongside in-app deckbuilding
(see CLAUDE.md's "Out of scope" note). A later deckbuilding phase can
reuse this same legality data to flag illegal cards during construction.

## Background: how Netrunner format legality actually works

This app has never modeled this before, so the ground truth, verified
directly against Null Signal Games' live data source:

- NSG currently maintains **7 named formats**: Standard, Startup, Eternal,
  Core, System Gateway, Snapshot, and Random Access Memories (RAM).
  Standard and Startup are the two organized-play formats; Eternal allows
  every card ever printed but restricts a short list of especially strong
  cards via a points budget instead of banning them; Core, System Gateway,
  Snapshot, and RAM are niche/limited formats (single-box-only, a frozen
  historical snapshot, a rotating small pool).
- **A decklist does not declare its own format.** Confirmed directly
  against the live public API (`GET
  https://netrunnerdb.com/api/2.0/public/decklist/{id}`): a decklist has
  only `cards` and an almost-always-null legacy `mwl_code` — no `format`
  field. Format legality is a **derived** property: for each format,
  check whether every card in the deck is (a) in that format's currently
  legal card pool and (b) not currently banned there. A deck can be legal
  in several formats, one, or none.
- Each format has a history of **snapshots** — points in time where its
  legal card pool and/or its restriction list changed. Only the *current*
  snapshot (by date) matters for "is this legal right now."
- Restrictions take different shapes across the dataset (all verified live
  against real files, not assumed):
  - A flat **ban list** (`banned: [card_id, ...]`) — used by Standard,
    Startup, Snapshot.
  - An older **"restricted" bucket** (`restricted: [card_id, ...]`) — seen
    in Snapshot's ban list; a named restriction category distinct from an
    outright ban.
  - A **universal influence penalty** (`global_penalty: {"N":
    [card_id,...]}`) — an older style of Standard MWL, where a card costs
    N extra influence regardless of faction.
  - A **points budget** (`points: {"N": [card_id,...]}, point_limit: M`)
    — Eternal's system: each restricted card costs N points against a
    shared budget of M.
  - Core, System Gateway, and RAM's current snapshots have **no
    restriction at all** — pool membership is the only check.
- Restrictions reference cards by a **title-level slug** (e.g. `"rezeki"`,
  `"aaron_marron"`), not by printing code — a restriction applies to a
  card regardless of which specific printing (set) you own. This app's
  existing `Card` table is per-printing (`CLAUDE.md`'s documented
  design), so bridging to this slug is new.

## Data source

All from the same `netrunner-cards-json` source already used
(`src/lib/importData.ts`), confirmed live:

- `v2/card_cycles.json`, `v2/card_sets.json` (the latter already fetched
  today for `setType`) — each row is `{ id, legacy_code, ... }`, the
  bridge between this app's existing v1-based `Cycle.code`/`Pack.code`
  and the v2 IDs the format/pool/restriction files use.
- `v2/printings/<pack_v2_id>.json` — one file per pack (parallel to the
  existing v1 `pack/<code>.json` fetch), each entry `{ id, card_id,
  card_set_id, ... }` where `id` matches this app's existing `Card.code`
  and `card_id` is the title-slug restrictions reference.
- `v2/formats/<format>.json` — 7 files, each `{ id, name, snapshots: [{
  id, date_start, card_pool_id, restriction_id?, active? }] }`.
- `v2/card_pools/<format>.json` — 7 files, each entry `{ id, format_id,
  card_cycle_ids: [v2 cycle id], card_set_ids: [v2 pack id] }`.
- `v2/restrictions/<format>/<id>.json` — only the specific files the
  *current* snapshot of each format actually references (verified: this
  is typically 0-1 file per format, not the full historical directory of
  ~40 files per format).

**Current-snapshot resolution** (verified against real, slightly messy
data — `standard.json` has 34+ snapshots spanning 2012-2026, including
entries explicitly marked `"active": false` for periods that were reverted,
and one out-of-chronological-order special entry `sunset_01`): for each
format, pick the snapshot with the maximum `date_start` such that
`date_start <= today` and `active !== false`. This is verified to handle
every irregularity found — `active: false` entries are skipped regardless
of date, `active: true` is informational only (not required by the
algorithm), and out-of-order special entries never win because a later
regular entry always has a larger `date_start`.

## Data model

```prisma
model Format {
  code       String               @id // standard, startup, eternal, core, system_gateway, snapshot, ram
  name       String
  legalities CardFormatLegality[]
}

model CardFormatLegality {
  cardCode   String
  card       Card   @relation(fields: [cardCode], references: [code], onDelete: Cascade)
  formatCode String
  format     Format @relation(fields: [formatCode], references: [code], onDelete: Cascade)
  /// 'legal' | 'not_in_pool' | 'banned' | 'restricted' | 'universal_influence_penalty' | 'points'
  status     String
  /// Extra detail for restricted/penalty/points statuses, e.g. "+2 influence" or "2 pts (limit 7)". Null for legal/not_in_pool/banned/restricted.
  detail     String?

  @@id([cardCode, formatCode])
}
```

`Card` gains a new nullable `cardId String?` column (the v2 title-slug).
Nullable because a card the bridge can't resolve (e.g. a very recent
printing not yet reflected in `v2/card_sets.json`) must not fail the
whole import — it simply gets no `CardFormatLegality` rows, and the UI
shows "format legality unavailable" for it rather than asserting anything
false.

## Import pipeline

New module `src/lib/importFormatLegality.ts`, called from
`importAllCardData` (`src/lib/importData.ts`) as an additional phase after
cards are imported — same `npm run import-cards` command, no new command
to remember:

1. Fetch `card_cycles.json`/`card_sets.json`, build `legacyCodeByV2CycleId`
   and `legacyCodeByV2PackId` maps.
2. Fetch each pack's `v2/printings/<v2_id>.json` (using the v2 pack ID
   from step 1), update each already-imported `Card` row's new `cardId`
   column by matching on `id` (= `Card.code`).
3. For each of the 7 formats: fetch `formats/<code>.json`, resolve the
   current snapshot per the algorithm above, fetch that snapshot's
   `card_pools/<format>.json` entry (by `card_pool_id`) and — if present —
   its `restrictions/<format>/<restriction_id>.json`.
4. Compute legal pack/cycle legacy-code sets for the format from the pool
   entry's `card_cycle_ids`/`card_set_ids` (via the step-1 bridge).
5. For every `Card` with a non-null `cardId`: determine status —
   `not_in_pool` if its pack's legacy code isn't in the format's legal
   cycle/pack sets; else `banned`/`restricted`/`universal_influence_penalty`/`points`
   per which restriction bucket (if any) contains its `cardId`; else
   `legal`. Upsert the `CardFormatLegality` row (delete-and-replace per
   format on re-import, matching this app's existing re-import
   conventions elsewhere).

## Card display

`CardDetailPopup` (already shown for every card, everywhere — search,
sets, decks, discover) is the only UI surface this needs:

- `src/lib/cards.ts`'s `PackCardEntry` (and every function that builds
  one — `searchCards`, `listCardsInPack`, `getCardDetail`) gains
  `formatLegalities: { formatCode: string; formatName: string; status:
  string; detail: string | null }[]`, joined from `CardFormatLegality`.
- `/api/cards/detail` (the `MinimalCard` lazy-fetch path used by batch/deck
  card lists) returns the same shape, so every `CardDetailPopup` caller
  sees identical data regardless of how it reached the popup.
- New section in the popup body, one line per format: `Standard: banned`,
  `Startup: legal`, `Eternal: legal (2 pts, limit 7)`, `Core: not in
  pool`. A card with no `formatLegalities` entries at all (unresolved
  `cardId`) shows "Format legality unavailable" instead of 7 blank/wrong
  lines.

## Deck display

Per-format badges, computed from card-pool + ban/restriction status only
— explicitly **not** a full construction-legality check (no influence
budget, no deck-size, no agenda-point verification), and labeled as such
in the UI so it isn't mistaken for one.

- Both `src/lib/decks.ts` (My Decks) and `src/lib/discover.ts` (Discover)
  already hydrate full per-card detail (title, faction, ownership) for
  exactly the decks currently being rendered — My Decks' whole list,
  Discover's current page of ~25. Extend that same existing query to also
  select each card's `CardFormatLegality` rows, and compute the rollup in
  the same place `DeckCardOwnership[]` is already assembled — no new bulk
  SQL query, so this doesn't reintroduce the whole-pool performance
  problem `getDiscoverDecks` already had to solve once.
- A deck is legal in a format only if every one of its cards has status
  `legal`, `restricted`, `universal_influence_penalty`, or `points` for
  that format (i.e., not `banned` and not `not_in_pool`) — a card with no
  legality data at all for that format counts as unknown, not legal
  (deck-level badge shows as unresolved for that format rather than a
  false ✓).
- Rendered as small badges in the **expanded** deck view (where the card
  list already shows), not the collapsed row — 7 badges is too much for a
  compact list row repeated across potentially thousands of Discover
  results.

## Testing

- `importFormatLegality.test.ts` (new) — v1↔v2 bridge resolution;
  current-snapshot picking (including the `active: false` and
  out-of-order-entry cases found in real data); each restriction shape
  (ban list, restricted bucket, universal penalty, points) correctly
  produces the right `status`/`detail`; a card with no resolvable
  `cardId` gets no rows instead of failing the import; re-import
  replaces rather than duplicates rows.
- `cards.test.ts` (extended) — `getCardDetail`/`searchCards`/
  `listCardsInPack` include `formatLegalities` correctly, including the
  empty-array case for a card with no legality data.
- `decks.test.ts`/`discover.test.ts` (extended) — a deck with one banned
  card is illegal in that format regardless of its other cards; a deck
  with a `not_in_pool` card likewise; a deck where every card is clean in
  a format is legal in it; a card with no legality data makes that
  format's badge unresolved, not falsely legal.
- `CardDetailPopup.test.tsx` (extended) — renders all 7 format rows for
  each status/detail shape; shows the "unavailable" message when
  `formatLegalities` is empty.
