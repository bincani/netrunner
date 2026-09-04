# Multi-Account Data Scoping — Design

## Overview

Phase 2 of two (`2026-08-23-auth-foundation-design.md` was Phase 1). Phase
1 shipped accounts — sign up, log in, log out, email verification,
password reset — as a purely additive gate in front of the app. It was
explicit that it changed nothing about who owns a `Collection`, `Deck`,
`Batch`, or `Setting`: every account currently reads and writes the exact
same shared data. Combined with Phase 1's choice of **open
self-registration** (anyone who reaches the deployed instance can create
an account), this is a live gap today, not a hypothetical one: a stranger
who signs up gets full read/write access to the real physical collection
tracked in `data/netrunner.db`.

This phase closes that gap with **strict per-account isolation**: every
account gets its own private collections (plural — the existing
multi-collection feature already supports several per owner), its own
imported decks, and its own preferences. Nothing is shared or
collaborative between accounts.

## Scope

In scope:
- `userId` on `Collection`, threaded through every data-layer function
  that resolves, lists, creates, or accepts a client-supplied
  `collectionId`. `Batch`/`CollectionEntry` need no new column —
  ownership already derives transitively through `Batch.collectionId`.
- `Deck` becomes private per account. Its primary key today is literally
  NetrunnerDB's own decklist id reused directly — that can't stay a
  single global PK once two different accounts might import the same
  public decklist, so this includes a PK reshape (see "Data model").
- `Setting` and `HiddenBuilderPack` (today both instance-wide) become
  per-account preferences.
- A shared ownership-guard pattern (`requireOwnedCollection`,
  `requireOwnedDeck`) enforced in the data layer (`src/lib/*.ts`), not
  just at the Server Action/route boundary — chosen specifically so a
  future caller can't silently reintroduce the gap this phase closes by
  forgetting a check at the boundary. This closes every gap
  `CLAUDE.md` currently lists by name: `importCsvToCollection`,
  `approveImportBatch`, `removeFromImportBatch`, `removeFromBatch`,
  `approveBatch`, `quickAddSet`/`clearSet`/`undoQuickSetChange`, and the
  CSV export routes' `?collectionId=`/`?deckId=` params — plus
  `pauseBatch`/`continueBatch`/`discardBatch`, which turned out to have
  the same gap (found while writing this spec; not on `CLAUDE.md`'s
  original list) since they currently take only a bare `batchId` with no
  `collectionId` at all to check against.
- `getDefaultCollectionId` auto-provisioning an empty default collection
  the first time a given user has none — replacing today's "throw if no
  default collection exists" — so every new signup has a usable
  collection immediately with no separate onboarding step.
- A one-time, manual claim step that assigns the real, currently-unowned
  `Collection`/`Deck`/`Setting`/`HiddenBuilderPack` rows in
  `data/netrunner.db` to the project owner's account once they've signed
  up for real.
- Wiring current-user resolution (`src/lib/currentUser.ts`, built in
  Phase 1 but not yet used anywhere) into every Server Action and Route
  Handler that needs it.

Out of scope:
- Sharing or collaboration between accounts (ruled out explicitly —
  isolation is strict, not shared/household access).
- Any change to Phase 1's open self-registration model (an invite-only
  gate is a separate decision, not revisited here).
- Admin/ops tooling beyond the one-time claim script.
- Any UI redesign beyond what ownership-scoping itself requires (no new
  screens; existing pages keep their current shape).
- `Card`, `Pack`, `Cycle`, `Faction`, `Format`, `CardFormatLegality`, and
  `TournamentDeck` (the `/discover` crawl) — all shared reference/external
  data, never user content.

## Data model

```prisma
model Collection {
  id        Int               @id @default(autoincrement())
  userId    Int
  user      User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  isDefault Boolean           @default(false)
  sortOrder Int               @default(0)
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  entries   CollectionEntry[]
  batches   Batch[]

  @@index([userId])
}

model Deck {
  /// Internal, autoincrement — was NetrunnerDB's decklist id directly
  /// before this phase. Two different accounts can now each hold their
  /// own row for the same public decklist.
  id            Int        @id @default(autoincrement())
  /// The original NetrunnerDB decklist id — still used for the outbound
  /// netrunnerdb.com/en/decklist/<id> link and to detect a re-import by
  /// the same account.
  netrunnerdbId Int
  userId        Int
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  uuid          String
  name          String
  importedAt    DateTime   @default(now())
  dateCreation  DateTime?
  sortOrder     Int        @default(0)
  cards         DeckCard[]

  @@unique([userId, netrunnerdbId])
  @@index([userId])
}

model Setting {
  userId Int
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  key    String
  value  String

  @@id([userId, key])
}

model HiddenBuilderPack {
  userId   Int
  user     User @relation(fields: [userId], references: [id], onDelete: Cascade)
  packCode String
  pack     Pack @relation(fields: [packCode], references: [code])

  @@id([userId, packCode])
}
```

`DeckCard.deckId` keeps pointing at `Deck.id` — since that's now a plain
internal autoincrement id rather than an externally-meaningful one, no
change needed to `DeckCard` itself beyond what the PK reshape's migration
does mechanically.

`Batch`, `BatchCard`, and `CollectionEntry` are unchanged — ownership for
all three already routes through `collectionId`.

## Ownership enforcement pattern

Two guards, both in the module that already owns the relevant model:

```ts
// src/lib/collections.ts
/** Throws if collectionId doesn't exist or doesn't belong to userId. */
export async function requireOwnedCollection(
  prisma: PrismaClient,
  userId: number,
  collectionId: number
): Promise<CollectionSummary>

// src/lib/decks.ts
/** Throws if deckId doesn't exist or doesn't belong to userId. */
export async function requireOwnedDeck(prisma: PrismaClient, userId: number, deckId: number): Promise<void>
```

The thrown error is a plain `Error` (matching this codebase's existing
validation style, e.g. `startBatch` rejecting a non-positive
`expectedCount`) — Server Actions already catch and surface `err.message`
today, and it reads the same to a user probing for someone else's
`collectionId` as any other "not found" case, which is the point: no
distinct "forbidden" signal that would confirm the id exists but belongs
to someone else.

**Principle:** the guard runs once, in whichever function is the
outermost consumer of a client-supplied `collectionId`/`batchId`/`deckId`
— i.e. functions called directly from `src/actions/*.ts` or a Route
Handler with an id that hasn't already passed through the guard earlier
in that same call chain. A purely internal function only ever reached
*after* such a check (e.g. `computeCollectionTotals` in `reports.ts`,
always called with a `collection.id` already resolved via
`getCollection`/`getDefaultCollectionId`/a collection the caller just
created) does not re-check — verified against every current call site
below, not assumed.

**Functions gaining `userId` (placed as the parameter immediately after
`prisma`, matching this codebase's existing "explicit id, early
parameter" convention) and an internal guard call:**

- `src/lib/collections.ts`: `getDefaultCollection`, `getDefaultCollectionId`
  (now creates-if-missing rather than throwing), `getCollection`,
  `listCollections`, `listCollectionsWithStats`, `createCollection`,
  `renameCollection`, `deleteCollection`, `setDefaultCollection` (its
  "unset all defaults" step must scope to `where: { userId, isDefault:
  true }` — today it's a blanket `updateMany`, which would be a
  cross-account bug the moment a second account exists),
  `reorderCollections`, `importCsvAsBatch`.
- `src/lib/collection.ts`: `incrementOwned`, `setOwned`,
  `getOwnedQuantity`, `exportCollectionCsv`.
- `src/lib/quickSet.ts`: `quickAddSet`, `clearSet`, `undoQuickSetChange`.
- `src/lib/batches.ts`: `getActiveBatch`, `listArchivedBatches`.
- `src/actions/batchMutations.ts`: `startBatch`, `addCardToBatch`,
  `approveBatch`, `revertApprovedBatch`, `removeFromBatch`, and —
  the newly-found gap — `pauseBatch`, `continueBatch`, `discardBatch`
  (these three currently take only `batchId`; they gain a `collectionId`
  parameter too, so there's something to check ownership against).
- `src/lib/decks.ts`: `getDecksWithOwnership`, `getDeckWithOwnership`,
  `exportDeckCsv` (userId, via `requireOwnedDeck`), plus `saveDeck` and
  `removeDeck` (`src/actions/deckMutations.ts`) and `reorderDecks`.

**Functions left unchanged** (always reached only after the id has
already been validated earlier in the same call, confirmed by checking
every current caller): `src/lib/reports.ts`'s
`computeSetCompletion`/`computeAllSetsCompletion`/`computeCollectionTotals`/
`listCardsUnderExpectedQuantity` (`listUnsizedPacks` has no `collectionId`
at all — untouched), and any pure formatting/computation helper with no
id parameter at all.

## Wiring current-user resolution

Server Components and Server Actions call the existing
`requireCurrentUser()` (`src/lib/currentUser.ts`, built in Phase 1,
unused until now) to get `userId`. Route Handlers
(`/api/cards/search`, `/api/cards/printings`, `/api/cards/detail`,
`/api/collection/export`, `/api/deck/export`) can't use `redirect()`
cleanly, so they call the non-throwing `getCurrentUser()` and return a
401 JSON body if it's null — mirroring `proxy.ts`'s own existing
`/api/*` branch. This is defense-in-depth layered on top of `proxy.ts`
already gating the request, the same "checked at the gate and
independently inside every handler" shape Phase 1 already established for
auth generally.

## New-account bootstrapping

`getDefaultCollectionId(prisma, userId)` auto-creates a `Collection`
named `"My Collection"` with `isDefault: true` the first time it's called
for a user with none — so a brand-new signup can reach `/`, `/builder`,
etc. immediately with zero extra onboarding steps. No change needed in
`signUp()` itself.

## Migrating the real, currently-unowned data

`data/netrunner.db` has zero `User` rows today — nobody has signed up for
real yet — which simplifies this considerably: there's exactly one
existing owner to assign everything to, decided by you signing up for
real first, not hardcoded into a migration ahead of time.

This ships as three steps, run in order directly against the real
database, mirroring the hand-sequenced migration the multi-collection
Phase 1 work already used in this repo's history for a comparable
primary-key change:

1. **Add nullable `userId`** on `Collection` and (as part of the same
   migration as its PK reshape) `Deck`, plus a plain nullable `userId`
   column on `Setting`/`HiddenBuilderPack` (their composite-PK tightening
   is deferred to step 3, since Prisma composite `@@id` fields can't be
   nullable).
2. **Sign up for real**, through `/signup`, with your real account.
3. **Run a one-time claim script** (`prisma/scripts/claim-existing-data.ts`
   or similar, invoked once by hand — not a Server Action, not
   reachable from the UI): looks up your `User` by the email you give it,
   then sets `userId` on every row currently `NULL` across all four
   tables. Your existing `builderMode`/`navStyle`/hidden-pack preferences
   carry over to your account this way too, not just the collection data.
4. **Tighten**: a follow-up migration making `userId` `NOT NULL` on all
   four tables, adding the FKs/indexes/unique constraints shown in "Data
   model" above, run only once step 3 confirms zero `NULL` rows remain.

Every step here touches the real physical-collection data covered by
`CLAUDE.md`'s standing caution. Step 3 and 4 run only with your explicit
go-ahead at the time, not automatically as part of shipping the code.

## Testing

- New tests for `requireOwnedCollection`/`requireOwnedDeck`: owned id
  passes through; another account's id throws; a nonexistent id throws
  the same way (no distinguishable error).
- Every existing test for a function in the "gaining `userId`" list above
  gets a `userId`/second-account variant asserting cross-account access
  is rejected, alongside updating its existing fixtures to include the
  new parameter.
- `setDefaultCollection`: a regression test asserting that setting one
  account's default collection does not touch another account's
  `isDefault` flag (the bug the current blanket `updateMany` would have
  once a second account exists).
- `getDefaultCollectionId`: a test for the new auto-create-if-missing
  path.
- Route Handler tests confirming a 401 with no session cookie, alongside
  their existing behavior tests.
- The claim script gets its own test: rows with `userId: null` get
  claimed, rows already owned by someone else are left untouched.

## Open items carried forward

None — this phase closes every item Phase 1's design doc listed as
deferred to Phase 2 (`userId` on the four tables, ownership checks on
every function that took a bare `collectionId`/`batchId`, existing-data
assignment, and settling what "per-user default collection" means).
