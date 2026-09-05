# Netrunner Collection Tracker

Personal, local-only web app for tracking a physical *Android: Netrunner*
card collection. See
`docs/superpowers/specs/2026-08-04-netrunner-collection-tracker-design.md`
for the full design; this file is the high-level orientation.

**`data/netrunner.db` holds the user's real physical collection — this is
not test/seed data, including while a feature is actively being built and
tested.** The user develops and tests directly against their real
collection (real `CollectionEntry` rows, real `Batch` records from
actually using Batch Builder Mode). Never assume a `Batch`, a
`CollectionEntry` row, or any other data you find is a leftover artifact
from automated/subagent testing — even if the timestamps or pattern look
that way. Always confirm with the user before deleting or modifying
collection/batch data, and never do so without explicit confirmation, even
to "fix" something. When dispatching a subagent (or acting yourself) to do
manual/dev-server verification, use clearly isolated, self-created data
that you clean up yourself — never assume the DB's existing state is
disposable.

## Phase 1 scope (current)

- Import the full card pool — every set, FFG era (2012–2018) *and* the
  Null Signal Games continuation (System Gateway onward) — from NetrunnerDB
  data.
- Collection builder: search for a card, pick a quantity (1–4), Add
  (increments owned count).
- Reports: percentage owned per set, overall collection total.
- Set browser: see every card in a set, owned vs. missing, and correct
  owned quantities directly.

**Out of scope for now:** full deckbuilding / "what can I build with this"
(in-app deck editing, flagging illegal cards while building), and any
sharing/collaboration between accounts — isolation is strict (see
"Multi-account data scoping" below), never shared/household access.

**Auth (shipped, Phase 1 of 2):** account creation and login are live —
sign up, log in, log out, email verification, password reset
(`src/lib/auth.ts`, `src/actions/authActions.ts`, pages under `/signup`,
`/login`, `/verify-email`, `/forgot-password`, `/reset-password`),
backed by `User`/`Session`/`VerificationToken` tables. `src/proxy.ts`
gates every other route behind a valid session, redirecting to
`/login?next=<path>` when one is missing. Full design:
`docs/superpowers/specs/2026-08-23-auth-foundation-design.md`. This is
**open self-registration** — anyone who reaches the deployed instance can
create their own account — not an invite-only gate, which raises the
security bar accordingly (email enumeration protection, rate limiting on
login/signup/forgot-password, and TLS being effectively required rather
than optional for any deployment reachable outside localhost).

**Multi-account data scoping (Phase 2, code shipped — see "Real-database
migration status" below for what's still pending):** every account now
gets its own private `Collection`(s), `Deck`s, and `Setting`/
`HiddenBuilderPack` preferences — `Batch`/`CollectionEntry` scope
transitively through `Collection.userId`. Full design:
`docs/superpowers/specs/2026-09-04-multi-account-data-scoping-design.md`;
implementation plan (including the real-database migration steps):
`docs/superpowers/plans/2026-09-04-multi-account-data-scoping.md`.
`requireOwnedCollection`/`requireOwnedDeck` (`src/lib/collections.ts`/
`src/lib/decks.ts`) are the shared ownership guards — every data-layer
function that resolves, lists, creates, or accepts a client-supplied
`collectionId`/`batchId`/`deckId` calls one of them internally (not just
at the Server Action boundary), specifically so a future caller can't
reintroduce a cross-account gap by forgetting a check. Every previously
open access-control gap this file used to list by name
(`importCsvToCollection`, `approveImportBatch`, `removeFromImportBatch`,
`removeFromBatch`, `approveBatch`, `quickAddSet`/`clearSet`/
`undoQuickSetChange`, the CSV export routes' `?collectionId=`/`?deckId=`
params) is now closed this way. `Deck`'s primary key was reshaped off
NetrunnerDB's own decklist id (now `Deck.netrunnerdbId`, with a fresh
internal autoincrement `Deck.id`) specifically so two different accounts
can each import the same public decklist independently — code reading a
deck's id for this app's own routing/CSV export uses `id`; code linking
out to `netrunnerdb.com` uses `netrunnerdbId`.

**Real-database migration status:** the application code above assumes
`userId` is always present everywhere. `data/netrunner.db` itself does
**not** have this migration applied yet — check
`docs/superpowers/plans/2026-09-04-multi-account-data-scoping.md`'s
Tasks 18-19 before running this app against real data or before assuming
any account can see the real collection. Those two tasks are deliberately
human-supervised checkpoints (per this file's standing rule on real
collection data, below) — signing up for a real account, then running a
one-time claim script and a final schema-tightening migration against the
real database. Until Task 19 completes, do not assume the codebase's
"every account has a private collection" behavior is actually observable
against `data/netrunner.db` — a fresh `npm run dev` against the
unmigrated real file will fail the moment any page queries `Collection`
by `userId`.

**Phase 2 (shipped):** deck tracking — import a published NetrunnerDB
decklist by URL/ID (`src/lib/netrunnerdb.ts`) and see ownership completion
per card and overall (`src/lib/decks.ts`) on `/builder`. This is distinct
from full deckbuilding above, which remains out of scope.

**Format & legality (shipped):** per-card, per-format legal/banned/
restricted/not-in-pool status (`src/lib/importFormatLegality.ts`,
`src/lib/cardFormatStatus.ts`, shown in `CardDetailPopup`) and a per-deck
legal/not-legal/unknown rollup per format (`src/lib/deckFormatLegality.ts`,
shown on `/decks` and `/discover`), computed at `npm run import-cards`
time from Null Signal Games' data. This is pool + ban/restriction
membership only — explicitly not a full deck-construction check.

**Deck detail view (shipped):** `/decks/[id]` (linked from a "View" link
on each `/decks` row, mirroring the Collection detail view's pattern) shows
a single deck's identity, decklist grouped by card type — ICE further
split into Barrier/Code Gate/Sentry/Other by its keywords' first subtype,
`src/components/DeckCardListByType.tsx` — with ownership highlighting and
per-card influence pips, packs used (with a "Cards up to `<latest pack>`"
line derived from it), format legality, and read-only deck-construction
stats — influence spent vs. the identity's influence limit
(`Card.influenceLimit`), agenda points in the deck vs. the required range
(`src/lib/agendaPoints.ts`, standard NSG rule: 20 at the 45-card minimum,
+2 per full 5-card bracket above it), and card count vs. the identity's
minimum deck size (`Card.minimumDeckSize`). `influenceLimit` and
`minimumDeckSize` are populated on identity `Card` rows at
`npm run import-cards` time (`src/lib/importFormatLegality.ts`, from Null
Signal Games' v2 per-card data); `Card.agendaPoints` is populated from the
v1 pack data (`src/lib/importData.ts`). These are computed, read-only
stats for a deck you already imported — not enforcement while building one
(no blocking, no editing, no legality gate on import). Full interactive
deckbuilding remains out of scope alongside full deckbuilding above.

`FormatLegalityBadges` (shared by `/decks`, `/discover`, and `/decks/[id]`)
has an expandable "Show restriction & rotation details" section per format:
the active restriction/ban list's name (`Format.activeRestrictionName`)
and whether the deck predates that format's current card-pool snapshot
(`Format.currentSnapshotDate`, `Deck.dateCreation`/`TournamentDeck.
dateCreation` — the decklist's own NetrunnerDB creation date, not
`importedAt`). Both `Format` columns are populated at `npm run
import-cards` time in `src/lib/importFormatLegality.ts`. `Deck.dateCreation`
is only populated on import/re-import (`src/lib/netrunnerdb.ts`'s
`date_creation` field) — decks imported before this field existed show
rotation status as unknown until re-imported (re-pasting the same
URL/ID).

An nginx + systemd production deployment option was added after phase 1
shipped — see `README.md`'s "Production deployment" section and the
`deploy/` directory. It's still a local-database app — every account's
data lives in the same `data/netrunner.db` file, just private to that
account (see "Multi-account data scoping" above) — just reachable over
the network if you choose to expose it that way. Given open
self-registration, TLS (nginx + Certbot) should be treated as required,
not optional, for any such deployment — passwords otherwise cross the
network in the clear on every login.

## Data source

- **NetrunnerDB v2.0** (`netrunnerdb.com/api/2.0/public/...`) is the
  current stable/production API. Its v3 successor is preview-only — don't
  build against it yet.
- Bulk import from
  [`Null-Signal-Games/netrunner-cards-json`](https://github.com/Null-Signal-Games/netrunner-cards-json)
  (`packs.json`, `cycles.json`, `factions.json`, `types.json`, and one
  `pack/<code>.json` per set — see `src/lib/importData.ts`) rather than the
  live API — it's the same data netrunnerdb.com itself runs on, and it's
  kept current with new releases.
- Card images are hotlinked from NetrunnerDB's CDN by card code, never
  downloaded/stored locally. Confirm the current CDN URL pattern against
  the live site before wiring it up — it has changed before.
- Cards are stored **per-printing** (one row per card-in-a-set), not
  deduplicated by title, since set-completion tracking depends on knowing
  which specific printing you own.

## Tech stack

- Next.js (App Router) + TypeScript
- SQLite via Prisma (`data/netrunner.db`)
- Tailwind CSS
- Vitest for unit tests

Single local process (`npm run dev`), file-based DB, one language
end-to-end — chosen because this is a local single-user tool with no
concurrent-write or deployment concerns, and phase 2 (deckbuilding) should
be able to build directly on this codebase.

## Key behavior to preserve

- Collection builder's **Add** button *increments* the owned count for a
  card printing. It does not overwrite it.
- The set browser's quantity editor *does* overwrite/set the count
  directly, and is not capped at 4 (physical ownership can exceed a normal
  playset).
- Simple mode (`CardBuilderForm`) stays unmodified by Batch mode
  (`BatchBuilderForm`) — they're two independent forms on `/builder`, not
  a shared component with branching.
- An active batch always overrides the `Builder Mode` setting on
  `/builder` — `BuilderPage` shows `BatchBuilderForm` whenever
  `getActiveBatch` returns non-null, regardless of the stored setting, so
  a batch can never be stranded by flipping the setting mid-batch.
- `Setting` (`src/actions/settingsMutations.ts`) is a generic per-user
  key/value table — it's the one place all future `/settings` additions
  should be persisted, not a new dedicated table per setting.
  `SyncCheckpoint` is the one exception: genuinely global (not per-user)
  process state for the `npm run sync-decks` background job — never route
  a new per-account preference through it, and never route new global
  process state through `Setting`.
- Every function that touches `CollectionEntry`/`Collection`/`Batch`/
  `Deck` takes explicit `userId` and `collectionId` (or `deckId`) as early
  parameters, in that order, immediately after `prisma`. Callers resolve
  `userId` via `requireCurrentUser()`/`getCurrentUser()`
  (`src/lib/currentUser.ts`) and `collectionId` via
  `getDefaultCollectionId(prisma, userId)` (`src/lib/collections.ts`) —
  never hardcode or inline a default-collection lookup, or skip the
  `requireOwnedCollection`/`requireOwnedDeck` ownership check, elsewhere
  in the data layer.

## Commands

First-time setup on a fresh clone (in order):

```bash
npm install           # installs deps; @prisma/client's postinstall generates the Prisma client
npm run setup          # prisma migrate deploy — creates/migrates data/netrunner.db's schema
npm run import-cards   # populates the (now schema-having) database from NetrunnerDB data
npm run dev            # starts the app at http://localhost:3000
```

`npm run setup` must run before `npm run import-cards` or `npm run dev` —
neither creates the SQLite schema itself, and both will fail against an
empty/missing `data/netrunner.db`.

Other commands:

- `npm test` — run the Vitest suite.
- `npm run build` — production build (`npm start` to serve it). Every page
  that reads from the database is rendered dynamically (not prerendered),
  so `next build` itself doesn't touch `data/netrunner.db` and will
  succeed even without `npm run setup`/`npm run import-cards` having run —
  but the app won't be useful at runtime until they have.
- `npm run sync-decks` — crawls NetrunnerDB for tournament decklists into
  the pool `/discover` reads from. Run after `npm run import-cards`
  (resolves each deck's faction from the local card pool). First full run
  is ~5,000 requests (~15 min); safe to interrupt/re-run, resumes from
  its checkpoint.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
