# Batch Builder Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Batch" builder mode alongside today's builder (renamed "Simple") — start a batch with an expected card count, search/add cards that accumulate in the batch instead of the collection, then Approve (merge into the collection) or Discard (throw away) after reviewing.

**Architecture:** Three new tables (`Setting` — generic key-value, backing this and future `/settings` additions; `Batch`/`BatchCard` — a staged card list with a state machine and a pause-aware timer). A settings toggle picks the default mode; an active batch always overrides it so an in-progress batch can never become unreachable. `BatchBuilderForm` duplicates `CardBuilderForm`'s small search-fetch logic (its add-handler and surrounding chrome differ enough that a shared `mode` prop would make `CardBuilderForm` itself more complex and risk regressing Simple mode) and composes two new page-local components: `BatchStatusBar` (name/timer/count/pause/continue/review) and `BatchReviewModal` (reusing `CardDetailPopup`'s existing overlay pattern).

**Tech Stack:** Next.js (App Router) server/client components, Prisma/SQLite, Tailwind CSS, Vitest + React Testing Library.

## Global Constraints

- Simple mode (today's `CardBuilderForm`) is completely unmodified — Batch mode is new, additive functionality living in new files.
- `Builder Mode` (`simple`/`batch`) is a new section on `/settings`, positioned above the existing "Hide Sets from Builder" section, persisted via a new generic key-value `Setting` table (the user's stated plan: settings accumulate here until this app eventually grows a login/account model — future settings reuse this same table, not a new one each time).
- Only one batch can be active (`running`/`paused`/`stopped`) at a time — starting a new one is rejected while one exists.
- If an active batch exists, `/builder` shows the batch UI regardless of the current `Builder Mode` setting — this prevents an in-progress batch from becoming unreachable if the setting changes mid-batch.
- The live "current count" is total quantity added to the batch (not distinct cards) — adding 3 copies of one card counts as 3 toward the expected count.
- The timer counts active (non-paused) time only. `Batch.elapsedMs` is the accumulated total; `Batch.lastResumedAt` (set only while `running`) plus the current time derives the live value: `elapsedMs + (now - lastResumedAt)`.
- `stopped` (reached via auto-stop when the count hits the expected total) is a dead end — no Continue from there, and the search/add UI is hidden (not just disabled) once `stopped`. `Review` is available from both `paused` and `stopped`, never from `running`.
- Typing a non-empty search query while `paused` resumes the batch to `running` (matches "looking for a new card" resuming it, distinct from — and prior to — actually adding anything). An empty/cleared search does not resume it.
- `Review` is read-only for this round: no editing/removing individual cards. Only `Discard` (archives as `discarded`, collection untouched) and `Approve` (applies every card via the same upsert shape `incrementOwned` uses, archives as `approved`) are available.
- Expected-error paths in every new Server Action return a discriminated `{ ok: true; ... } | { ok: false; error: string }` result rather than throwing — thrown Server Action errors are stripped to a generic minified message in production builds (React Flight), a real bug already found and fixed once in this codebase's Deck Tracking feature (see `src/actions/deckActions.ts`'s `importDeck` for the established pattern). Every new action in this plan follows that pattern from the start.
- Spec: `docs/superpowers/specs/2026-08-07-batch-builder-mode-design.md`.

---

### Task 1: Data model — `Setting`, `Batch`, `BatchCard`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces (used by Tasks 2, 4, 5): `Setting` (`key String @id`, `value String`), queryable via `prisma.setting.findUnique/upsert`.
- Produces (used by Tasks 4, 5): `Batch` (`id Int @id @default(autoincrement())`, `name String`, `expectedCount Int`, `status String`, `startedAt DateTime @default(now())`, `elapsedMs Int @default(0)`, `lastResumedAt DateTime?`, relation `cards BatchCard[]`) and `BatchCard` (`batchId Int`, `cardCode String`, `quantity Int`, composite `@@id([batchId, cardCode])`), queryable via `prisma.batch.findFirst/findMany/findUniqueOrThrow/create/update` and `prisma.batchCard.upsert/findMany/aggregate`.

- [ ] **Step 1: Add the new models, and the new reverse relation on `Card`**

In `prisma/schema.prisma`, find the `Card` model:

```prisma
model Card {
  code            String           @id
  title           String
  typeCode        String
  type            CardType         @relation(fields: [typeCode], references: [code])
  factionCode     String
  faction         Faction          @relation(fields: [factionCode], references: [code])
  packCode        String
  pack            Pack             @relation(fields: [packCode], references: [code])
  sideCode        String
  cost            Int?
  factionCost     Int?
  text            String?
  deckLimit       Int?
  keywords        String?
  strength        Int?
  uniqueness      Boolean          @default(false)
  quantity        Int?
  position        Int
  collectionEntry CollectionEntry?
}
```

Replace it with (adds the `batchCards` reverse relation as the last field):

```prisma
model Card {
  code            String           @id
  title           String
  typeCode        String
  type            CardType         @relation(fields: [typeCode], references: [code])
  factionCode     String
  faction         Faction          @relation(fields: [factionCode], references: [code])
  packCode        String
  pack            Pack             @relation(fields: [packCode], references: [code])
  sideCode        String
  cost            Int?
  factionCost     Int?
  text            String?
  deckLimit       Int?
  keywords        String?
  strength        Int?
  uniqueness      Boolean          @default(false)
  quantity        Int?
  position        Int
  collectionEntry CollectionEntry?
  batchCards      BatchCard[]
}
```

Then append to the end of the file (after the existing `DeckCard` model):

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

Unlike `DeckCard`, `BatchCard.cardCode` gets a real FK to `Card` — batch cards only ever come from this app's own search results (always a real local `Card`), unlike `DeckCard`'s codes (which come from an external NetrunnerDB decklist and might not be locally imported).

- [ ] **Step 2: Generate and apply the migration**

Run: `cd /var/www/netrunner && npx prisma migrate dev --name add_batch_builder_mode`
Expected: a new folder under `prisma/migrations/` (timestamp-prefixed, ending `_add_batch_builder_mode`) with `migration.sql` containing `CREATE TABLE "Setting"`, `CREATE TABLE "Batch"`, `CREATE TABLE "BatchCard"` statements, applied to `data/netrunner.db`, Prisma client regenerated with no errors.

- [ ] **Step 3: Verify**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "Add Setting, Batch, and BatchCard tables for batch builder mode"
```

---

### Task 2: Settings persistence layer — `Setting` table + Builder Mode

**Files:**
- Modify: `src/actions/settingsMutations.ts`
- Modify: `src/actions/settingsMutations.test.ts`
- Modify: `src/actions/settingsActions.ts`

**Interfaces:**
- Consumes: `Setting` (Task 1).
- Produces (used by Tasks 3, 9): `export type BuilderMode = 'simple' | 'batch'`, `getSetting(prisma, key: string): Promise<string | null>`, `setSetting(prisma, key: string, value: string): Promise<void>`, `getBuilderMode(prisma): Promise<BuilderMode>` (defaults to `'simple'` when unset), `setBuilderMode(prisma, mode: BuilderMode): Promise<void>`, and the `'use server'` wrapper `updateBuilderMode(mode: BuilderMode): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/actions/settingsMutations.test.ts` (add `getSetting, setSetting, getBuilderMode, setBuilderMode` to the existing import from `./settingsMutations`, and add `await prisma.setting.deleteMany()` to the existing `beforeEach`'s clearing block):

```ts
describe('getSetting / setSetting', () => {
  it('returns null when a key has never been set', async () => {
    expect(await getSetting(prisma, 'someKey')).toBeNull()
  })

  it('persists a value and returns it back', async () => {
    await setSetting(prisma, 'someKey', 'someValue')

    expect(await getSetting(prisma, 'someKey')).toBe('someValue')
  })

  it('overwrites rather than erroring on an existing key', async () => {
    await setSetting(prisma, 'someKey', 'first')

    await setSetting(prisma, 'someKey', 'second')

    expect(await getSetting(prisma, 'someKey')).toBe('second')
  })
})

describe('getBuilderMode / setBuilderMode', () => {
  it('defaults to simple when unset', async () => {
    expect(await getBuilderMode(prisma)).toBe('simple')
  })

  it('persists and returns batch mode', async () => {
    await setBuilderMode(prisma, 'batch')

    expect(await getBuilderMode(prisma)).toBe('batch')
  })

  it('can switch back to simple', async () => {
    await setBuilderMode(prisma, 'batch')

    await setBuilderMode(prisma, 'simple')

    expect(await getBuilderMode(prisma)).toBe('simple')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/actions/settingsMutations.test.ts`
Expected: FAIL — `getSetting`/`setSetting`/`getBuilderMode`/`setBuilderMode` are not exported from `./settingsMutations`.

- [ ] **Step 3: Write the implementation**

Append to `src/actions/settingsMutations.ts`:

```ts
export async function getSetting(prisma: PrismaClient, key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(prisma: PrismaClient, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

export type BuilderMode = 'simple' | 'batch'

const BUILDER_MODE_KEY = 'builderMode'

export async function getBuilderMode(prisma: PrismaClient): Promise<BuilderMode> {
  const value = await getSetting(prisma, BUILDER_MODE_KEY)
  return value === 'batch' ? 'batch' : 'simple'
}

export async function setBuilderMode(prisma: PrismaClient, mode: BuilderMode): Promise<void> {
  await setSetting(prisma, BUILDER_MODE_KEY, mode)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/actions/settingsMutations.test.ts`
Expected: PASS (all tests, including the 6 new ones).

- [ ] **Step 5: Add the `updateBuilderMode` server action**

In `src/actions/settingsActions.ts`, change the import line from:

```ts
import { setHiddenBuilderPacks } from './settingsMutations'
```

to:

```ts
import { setHiddenBuilderPacks, setBuilderMode, type BuilderMode } from './settingsMutations'
```

Then append to the file:

```ts
export async function updateBuilderMode(mode: BuilderMode): Promise<void> {
  await setBuilderMode(prisma, mode)
  revalidatePath('/settings')
  revalidatePath('/builder')
}
```

- [ ] **Step 6: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/actions/settingsMutations.ts src/actions/settingsMutations.test.ts src/actions/settingsActions.ts
git commit -m "Add generic Setting persistence and Builder Mode get/set"
```

---

### Task 3: Settings UI — Builder Mode toggle

**Files:**
- Modify: `src/app/settings/page.tsx`
- Modify: `src/app/settings/SettingsForm.tsx`
- Modify: `src/app/settings/SettingsForm.test.tsx`

**Interfaces:**
- Consumes: `getBuilderMode`, `BuilderMode` (Task 2), `updateBuilderMode` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `src/app/settings/SettingsForm.test.tsx`, change the imports:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsForm } from './SettingsForm'
import { updateHiddenBuilderPacks, updateBuilderMode } from '@/actions/settingsActions'

vi.mock('@/actions/settingsActions', () => ({
  updateHiddenBuilderPacks: vi.fn(),
  updateBuilderMode: vi.fn(),
}))
```

Then add these tests (anywhere inside the existing `describe('SettingsForm', ...)` block):

```ts
  it('renders the builder mode toggle, defaulting to Simple', () => {
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    expect(screen.getByRole('button', { name: 'Simple' })).toHaveClass('border-accent')
    expect(screen.getByRole('button', { name: 'Batch' })).toBeInTheDocument()
  })

  it('renders Batch as selected when that is the initial mode', () => {
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="batch" />)

    expect(screen.getByRole('button', { name: 'Batch' })).toHaveClass('border-accent')
  })

  it('clicking Batch calls updateBuilderMode and highlights it as selected', async () => {
    vi.mocked(updateBuilderMode).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    await user.click(screen.getByRole('button', { name: 'Batch' }))

    await waitFor(() => expect(updateBuilderMode).toHaveBeenCalledWith('batch'))
    expect(screen.getByRole('button', { name: 'Batch' })).toHaveClass('border-accent')
  })

  it('reverts the selection if updateBuilderMode fails', async () => {
    vi.mocked(updateBuilderMode).mockRejectedValue(new Error('db exploded'))
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} initialBuilderMode="simple" />)

    await user.click(screen.getByRole('button', { name: 'Batch' }))

    await waitFor(() => expect(updateBuilderMode).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Simple' })).toHaveClass('border-accent'))
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/settings/SettingsForm.test.tsx`
Expected: FAIL — `SettingsForm` doesn't accept an `initialBuilderMode` prop yet, and there's no "Batch"/"Simple" mode-toggle button (distinct from the "Simple"/"Batch" text not existing at all).

- [ ] **Step 3: Write the implementation**

Replace the full contents of `src/app/settings/SettingsForm.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { updateHiddenBuilderPacks, updateBuilderMode } from '@/actions/settingsActions'
import { ThemeToggle } from '@/components/ThemeToggle'
import type { BuilderMode } from '@/actions/settingsMutations'

interface PackOption {
  code: string
  name: string
}

const BUILDER_MODE_OPTIONS: { value: BuilderMode; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'batch', label: 'Batch' },
]

export function SettingsForm({
  packs,
  initialHiddenPackCodes,
  initialBuilderMode,
}: {
  packs: PackOption[]
  initialHiddenPackCodes: string[]
  initialBuilderMode: BuilderMode
}) {
  const [hiddenCodes, setHiddenCodes] = useState<Set<string>>(new Set(initialHiddenPackCodes))
  const [nameQuery, setNameQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [builderMode, setBuilderModeState] = useState<BuilderMode>(initialBuilderMode)
  const [isSavingBuilderMode, setIsSavingBuilderMode] = useState(false)

  const trimmedQuery = nameQuery.trim().toLowerCase()
  const visiblePacks = packs.filter((pack) => trimmedQuery === '' || pack.name.toLowerCase().includes(trimmedQuery))

  function toggle(code: string) {
    setHiddenCodes((prev) => {
      const next = new Set(prev)
      if (next.has(code)) {
        next.delete(code)
      } else {
        next.add(code)
      }
      return next
    })
  }

  async function selectBuilderMode(mode: BuilderMode) {
    const previous = builderMode
    setBuilderModeState(mode)
    setIsSavingBuilderMode(true)
    try {
      await updateBuilderMode(mode)
    } catch {
      setBuilderModeState(previous)
    } finally {
      setIsSavingBuilderMode(false)
    }
  }

  async function handleSave() {
    setIsSaving(true)
    setStatus(null)
    try {
      await updateHiddenBuilderPacks([...hiddenCodes])
      setStatus('Saved')
    } catch {
      setStatus('Failed to save — try again')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Theme</h2>
        <ThemeToggle />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Builder Mode</h2>
        <p className="text-sm text-muted">
          Simple adds cards to your collection immediately. Batch stages a sorting session for review before
          anything is added.
        </p>
        <div className="flex gap-2">
          {BUILDER_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => selectBuilderMode(option.value)}
              disabled={isSavingBuilderMode}
              className={`cursor-pointer rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                builderMode === option.value
                  ? 'border-accent bg-accent/20 text-accent'
                  : 'border-default hover:bg-surface-hover'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Hide Sets from Builder</h2>
        <p className="text-sm text-muted">
          Cards from selected sets won&apos;t appear in the Collection Builder&apos;s search results.
        </p>

        <input
          type="text"
          aria-label="Filter sets by name"
          placeholder="Filter sets by name…"
          value={nameQuery}
          onChange={(event) => setNameQuery(event.target.value)}
          className="w-full max-w-xs rounded border border-default bg-surface px-3 py-1 text-sm placeholder:text-faint"
        />

        <ul className="max-h-96 space-y-1 overflow-y-auto rounded border border-subtle p-2">
          {visiblePacks.map((pack) => (
            <li key={pack.code}>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={hiddenCodes.has(pack.code)} onChange={() => toggle(pack.code)} />
                <span>{pack.name}</span>
              </label>
            </li>
          ))}
          {visiblePacks.length === 0 && <li className="text-sm text-faint">No sets match this filter.</li>}
        </ul>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="cursor-pointer rounded border border-accent bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          {status && <span className="text-sm text-muted">{status}</span>}
        </div>
      </section>
    </div>
  )
}
```

Note: the local state setter was renamed `setBuilderModeState` (not `setBuilderMode`) to avoid shadowing the imported `setBuilderMode` mutation name — this component never calls the mutation directly (it calls the `updateBuilderMode` action), but the naming clash would still be confusing to a reader.

- [ ] **Step 4: Update the page to fetch and pass the setting**

Replace the full contents of `src/app/settings/page.tsx` with:

```tsx
import { prisma } from '@/lib/db'
import { getHiddenBuilderPackCodes, getBuilderMode } from '@/actions/settingsMutations'
import { SettingsForm } from './SettingsForm'

// Reflects live DB state (every pack, which ones are hidden, and the
// current Builder Mode) — not something to freeze into a build-time
// snapshot. See the dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const [packs, hiddenPackCodes, builderMode] = await Promise.all([
    prisma.pack.findMany({ orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }] }),
    getHiddenBuilderPackCodes(prisma),
    getBuilderMode(prisma),
  ])

  return (
    <main className="p-8 max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsForm
        packs={packs.map((pack) => ({ code: pack.code, name: pack.name }))}
        initialHiddenPackCodes={hiddenPackCodes}
        initialBuilderMode={builderMode}
      />
    </main>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/settings/SettingsForm.test.tsx`
Expected: PASS (all tests, including the 4 new ones).

- [ ] **Step 6: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/settings/page.tsx src/app/settings/SettingsForm.tsx src/app/settings/SettingsForm.test.tsx
git commit -m "Add Builder Mode toggle to Settings"
```

---

### Task 4: Batch read layer — `getActiveBatch` / `listArchivedBatches`

**Files:**
- Create: `src/lib/batches.ts`
- Create: `src/lib/batches.test.ts`

**Interfaces:**
- Consumes: `Batch`/`BatchCard` (Task 1).
- Produces (used by Tasks 5, 6, 8, 9):

```ts
export type BatchStatus = 'running' | 'paused' | 'stopped' | 'approved' | 'discarded'

export interface BatchCardEntry {
  code: string
  title: string
  quantity: number
}

export interface BatchSummary {
  id: number
  name: string
  expectedCount: number
  status: BatchStatus
  currentCount: number
  elapsedMs: number
  cards: BatchCardEntry[]
}

function formatElapsedMs(ms: number): string
async function getActiveBatch(prisma: PrismaClient): Promise<BatchSummary | null>
async function listArchivedBatches(prisma: PrismaClient): Promise<BatchSummary[]>
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/batches.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { getActiveBatch, listArchivedBatches, formatElapsedMs } from './batches'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.batchCard.deleteMany()
  await prisma.batch.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.card.deleteMany()
})

describe('getActiveBatch', () => {
  it('returns null when there is no active batch', async () => {
    expect(await getActiveBatch(prisma)).toBeNull()
  })

  it('returns a running batch with its live count and card list', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batch = await prisma.batch.create({
      data: { name: 'Batch Test', expectedCount: 10, status: 'running', elapsedMs: 0, lastResumedAt: new Date() },
    })
    await prisma.batchCard.create({ data: { batchId: batch.id, cardCode: '01001', quantity: 3 } })

    const active = await getActiveBatch(prisma)

    expect(active?.status).toBe('running')
    expect(active?.currentCount).toBe(3)
    expect(active?.cards).toEqual([{ code: '01001', title: 'Card A', quantity: 3 }])
  })

  it('does not return an approved or discarded batch', async () => {
    await prisma.batch.create({
      data: { name: 'Done', expectedCount: 10, status: 'approved', elapsedMs: 1000, lastResumedAt: null },
    })

    expect(await getActiveBatch(prisma)).toBeNull()
  })

  it('computes live elapsed time for a running batch from lastResumedAt', async () => {
    vi.useFakeTimers()
    const start = new Date('2026-01-01T00:00:00Z')
    vi.setSystemTime(start)
    await prisma.batch.create({
      data: { name: 'Batch Test', expectedCount: 10, status: 'running', elapsedMs: 5000, lastResumedAt: start },
    })

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    const active = await getActiveBatch(prisma)

    expect(active?.elapsedMs).toBe(15000)
    vi.useRealTimers()
  })

  it('returns the persisted elapsed time as-is for a paused batch', async () => {
    await prisma.batch.create({
      data: { name: 'Batch Test', expectedCount: 10, status: 'paused', elapsedMs: 7000, lastResumedAt: null },
    })

    const active = await getActiveBatch(prisma)

    expect(active?.elapsedMs).toBe(7000)
  })
})

describe('listArchivedBatches', () => {
  it('returns an empty list when nothing is archived', async () => {
    expect(await listArchivedBatches(prisma)).toEqual([])
  })

  it('returns approved and discarded batches, most recent first', async () => {
    await prisma.batch.create({
      data: {
        name: 'Older',
        expectedCount: 10,
        status: 'approved',
        elapsedMs: 0,
        startedAt: new Date('2026-01-01'),
      },
    })
    await prisma.batch.create({
      data: {
        name: 'Newer',
        expectedCount: 10,
        status: 'discarded',
        elapsedMs: 0,
        startedAt: new Date('2026-02-01'),
      },
    })

    const archived = await listArchivedBatches(prisma)

    expect(archived.map((b) => b.name)).toEqual(['Newer', 'Older'])
  })

  it('excludes an active batch', async () => {
    await prisma.batch.create({
      data: { name: 'Active', expectedCount: 10, status: 'running', elapsedMs: 0 },
    })

    expect(await listArchivedBatches(prisma)).toEqual([])
  })
})

describe('formatElapsedMs', () => {
  it('formats minutes and seconds, zero-padding seconds', () => {
    expect(formatElapsedMs(65000)).toBe('1:05')
  })

  it('formats zero as 0:00', () => {
    expect(formatElapsedMs(0)).toBe('0:00')
  })

  it('formats over an hour as accumulated minutes, not hours', () => {
    expect(formatElapsedMs(3665000)).toBe('61:05')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/batches.test.ts`
Expected: FAIL — `batches.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/batches.ts`:

```ts
import type { PrismaClient } from '@prisma/client'

export type BatchStatus = 'running' | 'paused' | 'stopped' | 'approved' | 'discarded'

export interface BatchCardEntry {
  code: string
  title: string
  quantity: number
}

export interface BatchSummary {
  id: number
  name: string
  expectedCount: number
  status: BatchStatus
  currentCount: number
  elapsedMs: number
  cards: BatchCardEntry[]
}

export function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function liveElapsedMs(elapsedMs: number, lastResumedAt: Date | null): number {
  if (!lastResumedAt) return elapsedMs
  return elapsedMs + (Date.now() - lastResumedAt.getTime())
}

interface BatchWithCards {
  id: number
  name: string
  expectedCount: number
  status: string
  elapsedMs: number
  lastResumedAt: Date | null
  cards: { cardCode: string; quantity: number; card: { title: string } }[]
}

function toSummary(batch: BatchWithCards): BatchSummary {
  return {
    id: batch.id,
    name: batch.name,
    expectedCount: batch.expectedCount,
    status: batch.status as BatchStatus,
    currentCount: batch.cards.reduce((sum, card) => sum + card.quantity, 0),
    elapsedMs: liveElapsedMs(batch.elapsedMs, batch.lastResumedAt),
    cards: batch.cards.map((card) => ({ code: card.cardCode, title: card.card.title, quantity: card.quantity })),
  }
}

const BATCH_CARDS_INCLUDE = {
  cards: { include: { card: { select: { title: true } } }, orderBy: { cardCode: 'asc' as const } },
}

export async function getActiveBatch(prisma: PrismaClient): Promise<BatchSummary | null> {
  const batch = await prisma.batch.findFirst({
    where: { status: { in: ['running', 'paused', 'stopped'] } },
    include: BATCH_CARDS_INCLUDE,
  })
  return batch ? toSummary(batch) : null
}

export async function listArchivedBatches(prisma: PrismaClient): Promise<BatchSummary[]> {
  const batches = await prisma.batch.findMany({
    where: { status: { in: ['approved', 'discarded'] } },
    include: BATCH_CARDS_INCLUDE,
    orderBy: { startedAt: 'desc' },
  })
  return batches.map(toSummary)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/batches.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/batches.ts src/lib/batches.test.ts
git commit -m "Add batch read layer (getActiveBatch / listArchivedBatches)"
```

---

### Task 5: Batch mutations and server actions

**Files:**
- Create: `src/actions/batchMutations.ts`
- Create: `src/actions/batchMutations.test.ts`
- Create: `src/actions/batchActions.ts`

**Interfaces:**
- Consumes: `Batch`/`BatchCard` (Task 1), `getActiveBatch`/`BatchSummary` (Task 4).
- Produces (used by Task 8):
  - `batchMutations.ts`: `startBatch(prisma, expectedCount: number): Promise<number>` (returns the new batch's id), `addCardToBatch(prisma, batchId: number, cardCode: string, amount: number): Promise<void>`, `pauseBatch(prisma, batchId: number): Promise<void>`, `continueBatch(prisma, batchId: number): Promise<void>`, `discardBatch(prisma, batchId: number): Promise<void>`, `approveBatch(prisma, batchId: number): Promise<void>`.
  - `batchActions.ts` (all `'use server'`, all returning discriminated results per this plan's Global Constraints): `startBatch(expectedCount: number): Promise<BatchActionResult>`, `addCardToBatch(batchId: number, cardCode: string, amount: number): Promise<BatchActionResult>`, `pauseBatch(batchId: number): Promise<BatchActionResult>`, `continueBatch(batchId: number): Promise<BatchActionResult>`, `discardBatch(batchId: number): Promise<SimpleActionResult>`, `approveBatch(batchId: number): Promise<SimpleActionResult>`, where `type BatchActionResult = { ok: true; batch: BatchSummary } | { ok: false; error: string }` and `type SimpleActionResult = { ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing tests for the mutations**

Create `src/actions/batchMutations.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedCard } from '@/lib/testFixtures'
import { getOwnedQuantity } from '@/lib/collection'
import { startBatch, addCardToBatch, pauseBatch, continueBatch, discardBatch, approveBatch } from './batchMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.batchCard.deleteMany()
  await prisma.batch.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.card.deleteMany()
})

describe('startBatch', () => {
  it('creates a running batch with a timestamp-based name', async () => {
    const batchId = await startBatch(prisma, 60)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.expectedCount).toBe(60)
    expect(batch.name).toMatch(/^Batch \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(batch.lastResumedAt).not.toBeNull()
  })

  it('rejects a non-positive expected count', async () => {
    await expect(startBatch(prisma, 0)).rejects.toThrow('expectedCount must be a positive integer')
  })

  it('rejects starting a second batch while one is already active', async () => {
    await startBatch(prisma, 60)

    await expect(startBatch(prisma, 40)).rejects.toThrow('already active')
  })
})

describe('addCardToBatch', () => {
  it('adds a new card to the batch', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const cards = await prisma.batchCard.findMany({ where: { batchId } })
    expect(cards).toEqual([{ batchId, cardCode: '01001', quantity: 3 }])
  })

  it('accumulates quantity across repeated adds of the same card', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)

    await addCardToBatch(prisma, batchId, '01001', 2)
    await addCardToBatch(prisma, batchId, '01001', 1)

    const card = await prisma.batchCard.findUniqueOrThrow({
      where: { batchId_cardCode: { batchId, cardCode: '01001' } },
    })
    expect(card.quantity).toBe(3)
  })

  it('does not touch the real collection', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)

    await addCardToBatch(prisma, batchId, '01001', 3)

    expect(await getOwnedQuantity(prisma, '01001')).toBe(0)
  })

  it('auto-stops the batch once the expected count is reached', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)

    await addCardToBatch(prisma, batchId, '01001', 3)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('stopped')
    expect(batch.lastResumedAt).toBeNull()
  })

  it('does not auto-stop before the expected count is reached', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)

    await addCardToBatch(prisma, batchId, '01001', 2)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
  })

  it('rejects adding to a batch that is not running', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await pauseBatch(prisma, batchId)

    await expect(addCardToBatch(prisma, batchId, '01001', 1)).rejects.toThrow('status "paused"')
  })
})

describe('pauseBatch / continueBatch', () => {
  it('pausing freezes the elapsed time and clears lastResumedAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, 60)

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('paused')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toBeNull()
    vi.useRealTimers()
  })

  it('continuing resumes from paused without losing the accumulated elapsed time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const batchId = await startBatch(prisma, 60)
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    await pauseBatch(prisma, batchId)

    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'))
    await continueBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('running')
    expect(batch.elapsedMs).toBe(10000)
    expect(batch.lastResumedAt).toEqual(new Date('2026-01-01T00:05:00Z'))
    vi.useRealTimers()
  })

  it('rejects pausing a batch that is not running', async () => {
    const batchId = await startBatch(prisma, 60)
    await pauseBatch(prisma, batchId)

    await expect(pauseBatch(prisma, batchId)).rejects.toThrow('status "paused"')
  })

  it('rejects continuing a batch that is not paused', async () => {
    const batchId = await startBatch(prisma, 60)

    await expect(continueBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })
})

describe('discardBatch', () => {
  it('archives a paused batch as discarded without touching the collection', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
    expect(await getOwnedQuantity(prisma, '01001')).toBe(0)
  })

  it('archives a stopped batch as discarded', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    const batchId = await startBatch(prisma, 3)
    await addCardToBatch(prisma, batchId, '01001', 3)

    await discardBatch(prisma, batchId)

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('discarded')
  })

  it('rejects discarding a running batch', async () => {
    const batchId = await startBatch(prisma, 60)

    await expect(discardBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })
})

describe('approveBatch', () => {
  it('merges every batch card into the collection and archives the batch as approved', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core' })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await addCardToBatch(prisma, batchId, '01002', 2)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, batchId)

    expect(await getOwnedQuantity(prisma, '01001')).toBe(3)
    expect(await getOwnedQuantity(prisma, '01002')).toBe(2)
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
    expect(batch.status).toBe('approved')
  })

  it('adds to an existing owned quantity rather than overwriting it', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await prisma.collectionEntry.create({ data: { cardCode: '01001', quantityOwned: 2 } })
    const batchId = await startBatch(prisma, 60)
    await addCardToBatch(prisma, batchId, '01001', 3)
    await pauseBatch(prisma, batchId)

    await approveBatch(prisma, batchId)

    expect(await getOwnedQuantity(prisma, '01001')).toBe(5)
  })

  it('rejects approving a running batch', async () => {
    const batchId = await startBatch(prisma, 60)

    await expect(approveBatch(prisma, batchId)).rejects.toThrow('status "running"')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/actions/batchMutations.test.ts`
Expected: FAIL — `batchMutations.ts` does not exist yet.

- [ ] **Step 3: Write the mutations**

Create `src/actions/batchMutations.ts`:

```ts
import type { PrismaClient } from '@prisma/client'

function formatBatchName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Batch ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function freeze(
  prisma: PrismaClient,
  batchId: number,
  lastResumedAt: Date,
  status: 'paused' | 'stopped'
): Promise<void> {
  const elapsedDelta = Date.now() - lastResumedAt.getTime()
  await prisma.batch.update({
    where: { id: batchId },
    data: { status, elapsedMs: { increment: elapsedDelta }, lastResumedAt: null },
  })
}

export async function startBatch(prisma: PrismaClient, expectedCount: number): Promise<number> {
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new Error(`expectedCount must be a positive integer, got ${expectedCount}`)
  }

  const existing = await prisma.batch.findFirst({
    where: { status: { in: ['running', 'paused', 'stopped'] } },
  })
  if (existing) {
    throw new Error('A batch is already active — review or finish it before starting a new one')
  }

  const now = new Date()
  const batch = await prisma.batch.create({
    data: {
      name: formatBatchName(now),
      expectedCount,
      status: 'running',
      startedAt: now,
      elapsedMs: 0,
      lastResumedAt: now,
    },
  })
  return batch.id
}

export async function addCardToBatch(
  prisma: PrismaClient,
  batchId: number,
  cardCode: string,
  amount: number
): Promise<void> {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'running') {
    throw new Error(`Cannot add a card to a batch with status "${batch.status}"`)
  }

  await prisma.batchCard.upsert({
    where: { batchId_cardCode: { batchId, cardCode } },
    create: { batchId, cardCode, quantity: amount },
    update: { quantity: { increment: amount } },
  })

  const totals = await prisma.batchCard.aggregate({ where: { batchId }, _sum: { quantity: true } })
  const currentCount = totals._sum.quantity ?? 0

  if (currentCount >= batch.expectedCount) {
    await freeze(prisma, batchId, batch.lastResumedAt!, 'stopped')
  }
}

export async function pauseBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'running') {
    throw new Error(`Cannot pause a batch with status "${batch.status}"`)
  }
  await freeze(prisma, batchId, batch.lastResumedAt!, 'paused')
}

export async function continueBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'paused') {
    throw new Error(`Cannot continue a batch with status "${batch.status}"`)
  }
  await prisma.batch.update({ where: { id: batchId }, data: { status: 'running', lastResumedAt: new Date() } })
}

export async function discardBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })
  if (batch.status !== 'paused' && batch.status !== 'stopped') {
    throw new Error(`Cannot discard a batch with status "${batch.status}"`)
  }
  await prisma.batch.update({ where: { id: batchId }, data: { status: 'discarded' } })
}

export async function approveBatch(prisma: PrismaClient, batchId: number): Promise<void> {
  const batch = await prisma.batch.findUniqueOrThrow({
    where: { id: batchId },
    include: { cards: true },
  })
  if (batch.status !== 'paused' && batch.status !== 'stopped') {
    throw new Error(`Cannot approve a batch with status "${batch.status}"`)
  }

  // Same upsert shape as incrementOwned (src/lib/collection.ts) — inlined
  // so the whole merge is one atomic transaction alongside archiving the
  // batch, rather than N separate increments that could partially apply.
  await prisma.$transaction([
    ...batch.cards.map((batchCard) =>
      prisma.collectionEntry.upsert({
        where: { cardCode: batchCard.cardCode },
        create: { cardCode: batchCard.cardCode, quantityOwned: batchCard.quantity },
        update: { quantityOwned: { increment: batchCard.quantity } },
      })
    ),
    prisma.batch.update({ where: { id: batchId }, data: { status: 'approved' } }),
  ])
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/actions/batchMutations.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Add the server-action wrappers**

Create `src/actions/batchActions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getActiveBatch, type BatchSummary } from '@/lib/batches'
import {
  startBatch as startBatchMutation,
  addCardToBatch as addCardToBatchMutation,
  pauseBatch as pauseBatchMutation,
  continueBatch as continueBatchMutation,
  discardBatch as discardBatchMutation,
  approveBatch as approveBatchMutation,
} from './batchMutations'

export type BatchActionResult = { ok: true; batch: BatchSummary } | { ok: false; error: string }
export type SimpleActionResult = { ok: true } | { ok: false; error: string }

async function withActiveBatch(mutate: () => Promise<void>): Promise<BatchActionResult> {
  try {
    await mutate()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
  const batch = await getActiveBatch(prisma)
  if (!batch) {
    return { ok: false, error: 'No active batch' }
  }
  return { ok: true, batch }
}

export async function startBatch(expectedCount: number): Promise<BatchActionResult> {
  const result = await withActiveBatch(() => startBatchMutation(prisma, expectedCount))
  if (result.ok) revalidatePath('/builder')
  return result
}

export async function addCardToBatch(batchId: number, cardCode: string, amount: number): Promise<BatchActionResult> {
  const result = await withActiveBatch(() => addCardToBatchMutation(prisma, batchId, cardCode, amount))
  if (result.ok) revalidatePath('/builder')
  return result
}

export async function pauseBatch(batchId: number): Promise<BatchActionResult> {
  const result = await withActiveBatch(() => pauseBatchMutation(prisma, batchId))
  if (result.ok) revalidatePath('/builder')
  return result
}

export async function continueBatch(batchId: number): Promise<BatchActionResult> {
  const result = await withActiveBatch(() => continueBatchMutation(prisma, batchId))
  if (result.ok) revalidatePath('/builder')
  return result
}

export async function discardBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    await discardBatchMutation(prisma, batchId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
  revalidatePath('/builder')
  revalidatePath('/builder/batches')
  return { ok: true }
}

export async function approveBatch(batchId: number): Promise<SimpleActionResult> {
  try {
    await approveBatchMutation(prisma, batchId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  revalidatePath('/builder')
  revalidatePath('/builder/batches')
  return { ok: true }
}
```

No dedicated test file for `batchActions.ts` — it's a thin wrapper (try/catch → discriminated result, `revalidatePath`) over already-tested mutations, matching this codebase's existing convention of not unit-testing `*Actions.ts` files (`collectionActions.ts`, `settingsActions.ts`, `deckActions.ts` have none either); the substantive branching logic it wraps is fully covered by `batchMutations.test.ts`.

- [ ] **Step 6: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/actions/batchMutations.ts src/actions/batchMutations.test.ts src/actions/batchActions.ts
git commit -m "Add batch mutations and server actions"
```

---

### Task 6: `BatchStatusBar` component

**Files:**
- Create: `src/app/builder/BatchStatusBar.tsx`
- Create: `src/app/builder/BatchStatusBar.test.tsx`

**Interfaces:**
- Consumes: `BatchSummary`, `formatElapsedMs` (Task 4).
- Produces (used by Task 8): `BatchStatusBar({ batch: BatchSummary, onPause: () => void, onContinue: () => void, onReview: () => void }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/builder/BatchStatusBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchStatusBar } from './BatchStatusBar'
import type { BatchSummary } from '@/lib/batches'

const runningBatch: BatchSummary = {
  id: 1,
  name: 'Batch Test',
  expectedCount: 60,
  status: 'running',
  currentCount: 23,
  elapsedMs: 65000,
  cards: [],
}

describe('BatchStatusBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the batch name, formatted elapsed time, and count', () => {
    render(<BatchStatusBar batch={runningBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.getByText('Batch Test')).toBeInTheDocument()
    expect(screen.getByText('1:05 · 23 of 60')).toBeInTheDocument()
  })

  it('ticks the elapsed time forward every second while running', () => {
    render(<BatchStatusBar batch={runningBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    vi.advanceTimersByTime(3000)

    expect(screen.getByText('1:08 · 23 of 60')).toBeInTheDocument()
  })

  it('does not tick while paused', () => {
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    render(<BatchStatusBar batch={pausedBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    vi.advanceTimersByTime(5000)

    expect(screen.getByText('1:05 · 23 of 60')).toBeInTheDocument()
  })

  it('shows only Pause while running', () => {
    render(<BatchStatusBar batch={runningBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review' })).not.toBeInTheDocument()
  })

  it('shows Continue and Review while paused', () => {
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    render(<BatchStatusBar batch={pausedBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })

  it('shows only Review while stopped', () => {
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    render(<BatchStatusBar batch={stoppedBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })

  it('clicking Pause calls onPause', async () => {
    vi.useRealTimers()
    const onPause = vi.fn()
    const user = userEvent.setup()
    render(<BatchStatusBar batch={runningBatch} onPause={onPause} onContinue={vi.fn()} onReview={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Pause' }))

    expect(onPause).toHaveBeenCalledTimes(1)
  })

  it('clicking Continue calls onContinue', async () => {
    vi.useRealTimers()
    const onContinue = vi.fn()
    const user = userEvent.setup()
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    render(<BatchStatusBar batch={pausedBatch} onPause={vi.fn()} onContinue={onContinue} onReview={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('clicking Review calls onReview', async () => {
    vi.useRealTimers()
    const onReview = vi.fn()
    const user = userEvent.setup()
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    render(<BatchStatusBar batch={stoppedBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={onReview} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))

    expect(onReview).toHaveBeenCalledTimes(1)
  })

  it('links to the batch history page', () => {
    render(<BatchStatusBar batch={runningBatch} onPause={vi.fn()} onContinue={vi.fn()} onReview={vi.fn()} />)

    expect(screen.getByRole('link', { name: 'Batch History' })).toHaveAttribute('href', '/builder/batches')
  })
})
```

Note: tests that click a button use `vi.useRealTimers()` before rendering — `userEvent` relies on real timers internally, and leaving fake timers active makes its interactions hang.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/builder/BatchStatusBar.test.tsx`
Expected: FAIL — `BatchStatusBar.tsx` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/app/builder/BatchStatusBar.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { formatElapsedMs, type BatchSummary } from '@/lib/batches'

export function BatchStatusBar({
  batch,
  onPause,
  onContinue,
  onReview,
}: {
  batch: BatchSummary
  onPause: () => void
  onContinue: () => void
  onReview: () => void
}) {
  const [displayElapsedMs, setDisplayElapsedMs] = useState(batch.elapsedMs)
  const baselineRef = useRef({ elapsedMs: batch.elapsedMs, since: Date.now() })

  useEffect(() => {
    baselineRef.current = { elapsedMs: batch.elapsedMs, since: Date.now() }
    setDisplayElapsedMs(batch.elapsedMs)

    if (batch.status !== 'running') {
      return
    }

    const interval = setInterval(() => {
      setDisplayElapsedMs(baselineRef.current.elapsedMs + (Date.now() - baselineRef.current.since))
    }, 1000)
    return () => clearInterval(interval)
  }, [batch.elapsedMs, batch.status])

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-default p-3">
      <div>
        <div className="font-medium">{batch.name}</div>
        <div className="text-sm text-muted">
          {formatElapsedMs(displayElapsedMs)} · {batch.currentCount} of {batch.expectedCount}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {batch.status === 'running' && (
          <button
            type="button"
            onClick={onPause}
            className="cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Pause
          </button>
        )}
        {batch.status === 'paused' && (
          <button
            type="button"
            onClick={onContinue}
            className="cursor-pointer rounded border border-accent bg-accent/20 px-3 py-1.5 text-sm text-accent hover:bg-accent/30"
          >
            Continue
          </button>
        )}
        {(batch.status === 'paused' || batch.status === 'stopped') && (
          <button
            type="button"
            onClick={onReview}
            className="cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Review
          </button>
        )}
        <Link href="/builder/batches" className="text-sm text-faint underline hover:text-primary">
          Batch History
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/builder/BatchStatusBar.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/builder/BatchStatusBar.tsx src/app/builder/BatchStatusBar.test.tsx
git commit -m "Add BatchStatusBar component (name, live timer, count, pause/continue/review)"
```

---

### Task 7: `BatchReviewModal` component

**Files:**
- Create: `src/app/builder/BatchReviewModal.tsx`
- Create: `src/app/builder/BatchReviewModal.test.tsx`

**Interfaces:**
- Consumes: `BatchCardEntry` (Task 4).
- Produces (used by Task 8): `BatchReviewModal({ batchName: string, cards: BatchCardEntry[], isSubmitting: boolean, onDiscard: () => void, onApprove: () => void, onClose: () => void }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/builder/BatchReviewModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchReviewModal } from './BatchReviewModal'

const cards = [
  { code: '01001', title: 'Card A', quantity: 3 },
  { code: '01002', title: 'Card B', quantity: 1 },
]

describe('BatchReviewModal', () => {
  it('renders the batch name and its card list', () => {
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'Batch Test' })).toBeInTheDocument()
    expect(screen.getByText('Card A')).toBeInTheDocument()
    expect(screen.getByText('Card B')).toBeInTheDocument()
  })

  it('shows a message when the batch has no cards', () => {
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={[]}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('No cards were added to this batch.')).toBeInTheDocument()
  })

  it('clicking Discard calls onDiscard', async () => {
    const onDiscard = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={onDiscard}
        onApprove={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('clicking Approve calls onApprove', async () => {
    const onApprove = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={onApprove}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('disables Discard and Approve while submitting', () => {
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={true}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  it('clicking the backdrop calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('presentation'))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pressing Escape calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onClose={onClose}
      />
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the close button calls onClose', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(
      <BatchReviewModal
        batchName="Batch Test"
        cards={cards}
        isSubmitting={false}
        onDiscard={vi.fn()}
        onApprove={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/builder/BatchReviewModal.test.tsx`
Expected: FAIL — `BatchReviewModal.tsx` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/app/builder/BatchReviewModal.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import type { BatchCardEntry } from '@/lib/batches'

export function BatchReviewModal({
  batchName,
  cards,
  isSubmitting,
  onDiscard,
  onApprove,
  onClose,
}: {
  batchName: string
  cards: BatchCardEntry[]
  isSubmitting: boolean
  onDiscard: () => void
  onApprove: () => void
  onClose: () => void
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-lg bg-surface p-4"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold">{batchName}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 cursor-pointer rounded bg-surface-hover px-2 py-1 text-sm hover:bg-default"
          >
            ✕
          </button>
        </div>

        <ul className="space-y-1 text-sm">
          {cards.map((card) => (
            <li key={card.code} className="flex items-center justify-between gap-2">
              <span>{card.title}</span>
              <span className="shrink-0">{card.quantity}</span>
            </li>
          ))}
          {cards.length === 0 && <li className="text-faint">No cards were added to this batch.</li>}
        </ul>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onDiscard}
            disabled={isSubmitting}
            className="cursor-pointer rounded border border-red-800 bg-red-950/40 px-4 py-1.5 text-sm text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={isSubmitting}
            className="cursor-pointer rounded border border-accent bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/builder/BatchReviewModal.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/builder/BatchReviewModal.tsx src/app/builder/BatchReviewModal.test.tsx
git commit -m "Add BatchReviewModal component (read-only card list, discard/approve)"
```

---

### Task 8: `BatchBuilderForm` component

**Files:**
- Create: `src/app/builder/BatchBuilderForm.tsx`
- Create: `src/app/builder/BatchBuilderForm.test.tsx`

**Interfaces:**
- Consumes: `startBatch`/`addCardToBatch`/`pauseBatch`/`continueBatch`/`discardBatch`/`approveBatch`/`BatchActionResult`/`SimpleActionResult` (Task 5), `BatchSummary` (Task 4), `BatchStatusBar` (Task 6), `BatchReviewModal` (Task 7), `CardDetailPopup` (existing), `CardSearchResult` (existing, `src/lib/cards.ts`).
- Produces (used by Task 9): `BatchBuilderForm({ activeBatch: BatchSummary | null }): JSX.Element`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/builder/BatchBuilderForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BatchBuilderForm } from './BatchBuilderForm'
import { startBatch, addCardToBatch, pauseBatch, continueBatch, discardBatch, approveBatch } from '@/actions/batchActions'
import type { BatchSummary } from '@/lib/batches'

vi.mock('@/actions/batchActions', () => ({
  startBatch: vi.fn(),
  addCardToBatch: vi.fn(),
  pauseBatch: vi.fn(),
  continueBatch: vi.fn(),
  discardBatch: vi.fn(),
  approveBatch: vi.fn(),
}))

vi.mock('next/image', () => ({
  default: (props: React.ComponentProps<'img'>) => <img {...props} />,
}))

const mockResults = [
  {
    code: '01007',
    title: 'Corroder',
    factionCode: 'anarch',
    factionName: 'Anarch',
    typeCode: 'program',
    typeName: 'Program',
    packCode: 'core',
    packName: 'Core Set',
    sideCode: 'runner',
    cost: 2,
    factionCost: 1,
    strength: 2,
    deckLimit: 3,
    keywords: 'Icebreaker - Killer',
    text: null,
    uniqueness: false,
    position: 7,
    ownedQuantity: 0,
    quantity: 2,
  },
]

const runningBatch: BatchSummary = {
  id: 1,
  name: 'Batch Test',
  expectedCount: 60,
  status: 'running',
  currentCount: 0,
  elapsedMs: 0,
  cards: [],
}

describe('BatchBuilderForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = vi.fn(async () => ({ json: async () => mockResults })) as unknown as typeof fetch
  })

  it('shows the start form when there is no active batch', () => {
    render(<BatchBuilderForm activeBatch={null} />)

    expect(screen.getByLabelText('Expected card count')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('starting a batch with a valid count shows the active batch UI', async () => {
    vi.mocked(startBatch).mockResolvedValue({ ok: true, batch: runningBatch })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} />)

    await user.type(screen.getByLabelText('Expected card count'), '60')
    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(startBatch).toHaveBeenCalledWith(60)
    await waitFor(() => expect(screen.getByText('Batch Test')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('Search for a card by title...')).toBeInTheDocument()
  })

  it('shows a visible error when starting fails', async () => {
    vi.mocked(startBatch).mockResolvedValue({ ok: false, error: 'A batch is already active' })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={null} />)

    await user.type(screen.getByLabelText('Expected card count'), '60')
    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('A batch is already active')
  })

  it('searching and clicking a quantity button adds to the batch', async () => {
    vi.mocked(addCardToBatch).mockResolvedValue({
      ok: true,
      batch: { ...runningBatch, currentCount: 3, cards: [{ code: '01007', title: 'Corroder', quantity: 3 }] },
    })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))
    await user.click(screen.getByRole('button', { name: 'Add 3 Corroder' }))

    expect(addCardToBatch).toHaveBeenCalledWith(1, '01007', 3)
    await waitFor(() => expect(screen.getByText('3 of 60')).toBeInTheDocument())
  })

  it('shows a "+N in this batch" indicator once a card has been added', async () => {
    const batchWithCard: BatchSummary = {
      ...runningBatch,
      currentCount: 2,
      cards: [{ code: '01007', title: 'Corroder', quantity: 2 }],
    }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={batchWithCard} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    const row = within(screen.getByText('Corroder').closest('li')!)
    expect(row.getByText(/\+2 in this batch/)).toBeInTheDocument()
  })

  it('does not show a "0" reset button (removal is not supported in batch mode)', async () => {
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'corro')
    await waitFor(() => screen.getByText('Corroder'))

    expect(screen.queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument()
  })

  it('typing a search query while paused resumes the batch once', async () => {
    vi.mocked(continueBatch).mockResolvedValue({ ok: true, batch: runningBatch })
    const pausedBatch: BatchSummary = { ...runningBatch, status: 'paused' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={pausedBatch} />)

    await user.type(screen.getByPlaceholderText('Search for a card by title...'), 'c')

    await waitFor(() => expect(continueBatch).toHaveBeenCalledWith(1))
  })

  it('clicking Pause calls pauseBatch and updates the chrome', async () => {
    vi.mocked(pauseBatch).mockResolvedValue({ ok: true, batch: { ...runningBatch, status: 'paused' } })
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={runningBatch} />)

    await user.click(screen.getByRole('button', { name: 'Pause' }))

    expect(pauseBatch).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument())
  })

  it('hides the search UI and shows only Review once stopped', () => {
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    expect(screen.queryByPlaceholderText('Search for a card by title...')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review' })).toBeInTheDocument()
  })

  it('opening Review shows the batch review modal with its card list', async () => {
    const stoppedBatch: BatchSummary = {
      ...runningBatch,
      status: 'stopped',
      currentCount: 3,
      cards: [{ code: '01007', title: 'Corroder', quantity: 3 }],
    }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))

    expect(screen.getByRole('heading', { name: 'Batch Test' })).toBeInTheDocument()
    expect(screen.getAllByText('Corroder').length).toBeGreaterThan(0)
  })

  it('approving a batch from Review returns to the start form', async () => {
    vi.mocked(approveBatch).mockResolvedValue({ ok: true })
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(approveBatch).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByLabelText('Expected card count')).toBeInTheDocument())
  })

  it('discarding a batch from Review returns to the start form', async () => {
    vi.mocked(discardBatch).mockResolvedValue({ ok: true })
    const stoppedBatch: BatchSummary = { ...runningBatch, status: 'stopped' }
    const user = userEvent.setup()
    render(<BatchBuilderForm activeBatch={stoppedBatch} />)

    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(discardBatch).toHaveBeenCalledWith(1)
    await waitFor(() => expect(screen.getByLabelText('Expected card count')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/builder/BatchBuilderForm.test.tsx`
Expected: FAIL — `BatchBuilderForm.tsx` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/app/builder/BatchBuilderForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  startBatch,
  addCardToBatch,
  pauseBatch,
  continueBatch,
  discardBatch,
  approveBatch,
} from '@/actions/batchActions'
import { CardDetailPopup } from '@/components/CardDetailPopup'
import { BatchStatusBar } from './BatchStatusBar'
import { BatchReviewModal } from './BatchReviewModal'
import type { BatchSummary } from '@/lib/batches'
import type { CardSearchResult } from '@/lib/cards'

export function BatchBuilderForm({ activeBatch }: { activeBatch: BatchSummary | null }) {
  const [batch, setBatch] = useState<BatchSummary | null>(activeBatch)
  const [expectedCountInput, setExpectedCountInput] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardSearchResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [pendingCodes, setPendingCodes] = useState<Record<string, boolean>>({})
  const [statusByCode, setStatusByCode] = useState<Record<string, string>>({})
  const [errorByCode, setErrorByCode] = useState<Record<string, string>>({})

  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [chromeError, setChromeError] = useState<string | null>(null)

  async function runSearch(value: string) {
    setQuery(value)
    setSearchError(null)

    if (value.trim().length === 0) {
      setResults([])
      return
    }

    // "Looking for a new card" resumes a paused batch — checked against
    // the current `batch` state, so once the resume succeeds and state
    // updates, subsequent keystrokes see status 'running' and skip this.
    if (batch?.status === 'paused') {
      const result = await continueBatch(batch.id)
      if (result.ok) setBatch(result.batch)
    }

    try {
      const response = await fetch(`/api/cards/search?q=${encodeURIComponent(value)}`)
      const data: CardSearchResult[] = await response.json()
      setResults(data)
    } catch {
      setResults([])
      setSearchError('Search failed — try again')
    }
  }

  async function handleStart() {
    setIsStarting(true)
    setStartError(null)
    const result = await startBatch(Number(expectedCountInput))
    if (result.ok) {
      setBatch(result.batch)
      setExpectedCountInput('')
    } else {
      setStartError(result.error)
    }
    setIsStarting(false)
  }

  async function handleAdd(card: CardSearchResult, amount: number) {
    if (!batch) return
    setPendingCodes((prev) => ({ ...prev, [card.code]: true }))
    setErrorByCode((prev) => {
      if (!(card.code in prev)) return prev
      const { [card.code]: _removed, ...rest } = prev
      return rest
    })

    const result = await addCardToBatch(batch.id, card.code, amount)
    if (result.ok) {
      setBatch(result.batch)
      setStatusByCode((prev) => ({ ...prev, [card.code]: `added ${amount}` }))
    } else {
      setErrorByCode((prev) => ({ ...prev, [card.code]: result.error }))
    }
    setPendingCodes((prev) => ({ ...prev, [card.code]: false }))
  }

  async function handlePause() {
    if (!batch) return
    setChromeError(null)
    const result = await pauseBatch(batch.id)
    if (result.ok) setBatch(result.batch)
    else setChromeError(result.error)
  }

  async function handleContinue() {
    if (!batch) return
    setChromeError(null)
    const result = await continueBatch(batch.id)
    if (result.ok) setBatch(result.batch)
    else setChromeError(result.error)
  }

  function resetAfterReview() {
    setBatch(null)
    setIsReviewOpen(false)
    setResults([])
    setQuery('')
  }

  async function handleDiscard() {
    if (!batch) return
    setIsSubmittingReview(true)
    const result = await discardBatch(batch.id)
    setIsSubmittingReview(false)
    if (result.ok) resetAfterReview()
    else setChromeError(result.error)
  }

  async function handleApprove() {
    if (!batch) return
    setIsSubmittingReview(true)
    const result = await approveBatch(batch.id)
    setIsSubmittingReview(false)
    if (result.ok) resetAfterReview()
    else setChromeError(result.error)
  }

  function batchCardQuantity(code: string): number {
    return batch?.cards.find((c) => c.code === code)?.quantity ?? 0
  }

  if (!batch) {
    return (
      <div className="space-y-4">
        <div>
          <label htmlFor="expected-count" className="block text-sm font-medium">
            Expected card count
          </label>
          <input
            id="expected-count"
            type="number"
            min={1}
            value={expectedCountInput}
            onChange={(event) => setExpectedCountInput(event.target.value)}
            placeholder="e.g. 60"
            className="mt-1 w-32 rounded border border-default bg-surface px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={isStarting || expectedCountInput.trim() === ''}
          className="cursor-pointer rounded border border-accent bg-accent/20 px-4 py-1.5 text-sm text-accent hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isStarting ? 'Starting…' : 'Start'}
        </button>
        {startError && (
          <p className="text-sm text-danger" role="alert">
            {startError}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BatchStatusBar
        batch={batch}
        onPause={handlePause}
        onContinue={handleContinue}
        onReview={() => setIsReviewOpen(true)}
      />

      {chromeError && (
        <p className="text-sm text-danger" role="alert">
          {chromeError}
        </p>
      )}

      {batch.status !== 'stopped' && (
        <div className="space-y-6">
          <input
            type="text"
            value={query}
            onChange={(event) => runSearch(event.target.value)}
            placeholder="Search for a card by title..."
            className="w-full rounded border border-default bg-surface px-4 py-2"
          />

          {searchError && (
            <p className="text-danger" role="alert">
              {searchError}
            </p>
          )}

          <ul className="divide-y divide-subtle">
            {results.map((card) => {
              const isPending = pendingCodes[card.code] === true
              const status = statusByCode[card.code]
              const error = errorByCode[card.code]
              const inBatch = batchCardQuantity(card.code)
              return (
                <li key={card.code} className="flex items-center gap-4 p-3">
                  <CardDetailPopup card={card} />
                  <div className="flex-1">
                    <div className="font-medium">{card.title}</div>
                    <div className="text-sm text-muted">
                      {card.factionCode} ·{' '}
                      <Link href={`/sets/${card.packCode}`} className="underline hover:text-primary">
                        {card.packName}
                      </Link>{' '}
                      · owned: {card.ownedQuantity}
                      {card.quantity !== null && <span> of {card.quantity}</span>}
                      {inBatch > 0 && <span className="text-accent"> · +{inBatch} in this batch</span>}
                    </div>
                    {status && (
                      <div className="text-xs text-success">
                        {card.title}: {status}
                      </div>
                    )}
                    {error && (
                      <div className="text-xs text-danger" role="alert">
                        {error}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        onClick={() => handleAdd(card, n)}
                        disabled={isPending}
                        aria-label={`Add ${n} ${card.title}`}
                        className="h-8 w-8 cursor-pointer rounded border border-default bg-surface font-medium hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {isReviewOpen && (
        <BatchReviewModal
          batchName={batch.name}
          cards={batch.cards}
          isSubmitting={isSubmittingReview}
          onDiscard={handleDiscard}
          onApprove={handleApprove}
          onClose={() => setIsReviewOpen(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/builder/BatchBuilderForm.test.tsx`
Expected: PASS (13 tests).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/builder/BatchBuilderForm.tsx src/app/builder/BatchBuilderForm.test.tsx
git commit -m "Add BatchBuilderForm component (start form, add-to-batch search, review orchestration)"
```

---

### Task 9: Wire mode branching into `/builder`, add the `/builder/batches` archive page

**Files:**
- Modify: `src/app/builder/page.tsx`
- Create: `src/app/builder/batches/page.tsx`

**Interfaces:**
- Consumes: `getBuilderMode` (Task 2), `getActiveBatch`, `listArchivedBatches`, `formatElapsedMs` (Task 4), `BatchBuilderForm` (Task 8), existing `CardBuilderForm` (unchanged).

- [ ] **Step 1: Replace the builder page**

Replace the full contents of `src/app/builder/page.tsx` with:

```tsx
import { prisma } from '@/lib/db'
import { getBuilderMode } from '@/actions/settingsMutations'
import { getActiveBatch } from '@/lib/batches'
import { CardBuilderForm } from './CardBuilderForm'
import { BatchBuilderForm } from './BatchBuilderForm'

// Reflects live DB state (the Builder Mode setting, any active batch) —
// not something to freeze into a build-time snapshot. See the
// dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function BuilderPage() {
  const [builderMode, activeBatch] = await Promise.all([getBuilderMode(prisma), getActiveBatch(prisma)])

  // An in-progress batch is shown regardless of the current Builder Mode
  // setting — otherwise switching the setting mid-batch would strand it
  // with no way to reach it from the UI.
  const showBatchMode = builderMode === 'batch' || activeBatch !== null

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Collection Builder</h1>
      {showBatchMode ? <BatchBuilderForm activeBatch={activeBatch} /> : <CardBuilderForm />}
    </main>
  )
}
```

This does not change `CardBuilderForm`'s own props or behavior — `CardBuilderForm.test.tsx`'s tests, which render `<CardBuilderForm />` directly rather than through this page, are unaffected.

- [ ] **Step 2: Create the batch history page**

Create `src/app/builder/batches/page.tsx`:

```tsx
import { prisma } from '@/lib/db'
import { listArchivedBatches, formatElapsedMs } from '@/lib/batches'

// Reflects live DB state (archived batches) — not something to freeze
// into a build-time snapshot. See the dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function BatchHistoryPage() {
  const batches = await listArchivedBatches(prisma)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">Batch History</h1>

      {batches.length === 0 ? (
        <p className="text-sm text-faint">No batches have been reviewed yet.</p>
      ) : (
        <ul className="space-y-4">
          {batches.map((batch) => (
            <li key={batch.id} className="space-y-2 rounded border border-default p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{batch.name}</span>
                <span className={`text-sm ${batch.status === 'approved' ? 'text-success' : 'text-danger'}`}>
                  {batch.status === 'approved' ? 'Approved' : 'Discarded'}
                </span>
              </div>
              <p className="text-sm text-muted">
                {formatElapsedMs(batch.elapsedMs)} · {batch.currentCount} of {batch.expectedCount}
              </p>
              <ul className="space-y-1 text-sm">
                {batch.cards.map((card) => (
                  <li key={card.code} className="flex items-center justify-between gap-2 text-muted">
                    <span>{card.title}</span>
                    <span className="shrink-0">{card.quantity}</span>
                  </li>
                ))}
                {batch.cards.length === 0 && <li className="text-faint">No cards were added to this batch.</li>}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass (no test file targets `builder/page.tsx` or `builder/batches/page.tsx` directly, matching this codebase's existing convention of not unit-testing thin page-level data-fetching wrappers — verified instead by Task 10's manual check).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/builder/page.tsx src/app/builder/batches/page.tsx
git commit -m "Wire Batch Builder mode into /builder, add /builder/batches archive page"
```

---

### Task 10: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check against real local data**

Run `npm run dev`, wait for it to serve, then:
- On `/settings`, confirm "Builder Mode" appears above "Hide Sets from Builder", defaulting to Simple selected. Switch to Batch, reload `/settings` — confirm Batch is still selected (persisted).
- On `/builder`, confirm it now shows the "Expected card count" + Start form instead of the search box.
- Enter `3` and click Start. Confirm the batch chrome appears (a `Batch YYYY-MM-DD HH:MM` name, a ticking timer starting at `0:00`, `0 of 3`) alongside the search box.
- Search for a real card and click one of its quantity buttons (e.g. "Add 2"). Confirm the count updates to `2 of 3`, a "+2 in this batch" indicator appears on that card's row, and the card's real "owned" count elsewhere in the app (e.g. the dashboard) is unchanged.
- Click Pause. Confirm the timer stops ticking and the search box is replaced by Continue/Review buttons (search box itself should still be present per the plan — re-check: paused still shows search+chrome with Continue+Review, only `stopped` hides search). Wait a few seconds, click Continue — confirm the timer resumes from where it left off (not reset, not counting the paused gap).
- Add one more copy of a card (bringing the total to 3 of 3) — confirm the batch auto-transitions to stopped: the search box disappears, only the batch summary and Review button remain, and no Continue button is available.
- Alternatively (separate run), pause a batch, then type a new search query — confirm this alone resumes it to running (visible via the timer ticking again and Pause reappearing) even before clicking any quantity button.
- Click Review. Confirm the modal lists the batch's cards with quantities, and Discard/Approve are both present.
- Click Discard. Confirm `/builder` returns to the Start form, and `/builder/batches` (via the "Batch History" link, available while chrome was visible) now lists this batch as Discarded with its card list, and the collection was NOT updated.
- Repeat: start a new batch, add a card, let it run or stop, click Review, click Approve. Confirm `/builder` returns to the Start form, the collection's real owned quantity increased by the approved amount (check via `/builder`'s own search once back in Simple/Batch-start state, or the dashboard), and `/builder/batches` lists this batch as Approved.
- Confirm only one batch can be active: while a batch is running, no second Start form is reachable (the UI itself doesn't offer one while `batch` state is non-null, so this is inherently satisfied — just confirm visually that Start never reappears until Discard/Approve).
- On `/settings`, switch Builder Mode back to Simple while a batch is NOT active — confirm `/builder` now shows the plain search box again (Simple mode, unchanged from before this feature).

- [ ] **Step 4: Commit (only if manual checks required a fix)**

If Step 3 surfaced no issues, there is nothing to commit for this task — Task 9's commit already covers the working feature.
