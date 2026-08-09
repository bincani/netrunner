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
(in-app deck editing, MWL/legality checking) and multi-user accounts or
auth (single user, no login — this holds even when deployed behind nginx,
see below).

**Phase 2 (shipped):** deck tracking — import a published NetrunnerDB
decklist by URL/ID (`src/lib/netrunnerdb.ts`) and see ownership completion
per card and overall (`src/lib/decks.ts`) on `/builder`. This is distinct
from full deckbuilding above, which remains out of scope.

An nginx + systemd production deployment option was added after phase 1
shipped — see `README.md`'s "Production deployment" section and the
`deploy/` directory. This doesn't change the single-user/no-auth design;
it's still a local-database app, just reachable over the network if you
choose to expose it that way.

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
- `Setting` (`src/actions/settingsMutations.ts`) is a generic key/value
  table — it's the one place all future `/settings` additions should be
  persisted, not a new dedicated table per setting.
- Every function that touches `CollectionEntry` takes an explicit
  `collectionId` as an early parameter (immediately after `prisma`).
  Callers resolve it via `getDefaultCollectionId(prisma)`
  (`src/lib/collections.ts`) — never hardcode or inline a
  default-collection lookup elsewhere in the data layer.

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
