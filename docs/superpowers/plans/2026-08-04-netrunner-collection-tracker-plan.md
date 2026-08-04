# Netrunner Collection Tracker — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, single-user web app that imports the full *Android: Netrunner* card pool, lets the user record what they own, and reports set-completion percentages with a browsable, editable view of every set.

**Architecture:** A single Next.js (App Router, TypeScript) process backed by a file-based SQLite database via Prisma. A re-runnable import script populates the card catalog from the `Null-Signal-Games/netrunner-cards-json` GitHub repo. Server Components read data directly through Prisma; a couple of Server Actions handle the two collection-mutating operations (increment on add, overwrite on edit).

**Tech Stack:** Next.js (App Router) + TypeScript, Prisma + SQLite, Tailwind CSS, Vitest.

## Global Constraints

- Single user, no authentication or accounts.
- Local-only: the app runs via `npm run dev`; no deployment configuration.
- Database is a single SQLite file at `data/netrunner.db`, accessed only through Prisma.
- Cards are stored **per-printing** (one row per card-in-a-set), not deduplicated by title.
- Card data targets the NetrunnerDB v2.0 data shape (via the `netrunner-cards-json` repo's flat `v1`-schema files); the v3 API is preview/unstable and is not used.
- Reference data source: `https://raw.githubusercontent.com/Null-Signal-Games/netrunner-cards-json/main/` — `cycles.json`, `factions.json`, `types.json`, `packs.json`, and one `pack/<code>.json` per set.
- Card images are hotlinked from `https://card-images.netrunnerdb.com/v1/large/<code>.jpg` (verified reachable) — never downloaded or stored locally.
- The collection builder's **Add** action increments the existing owned quantity. The set browser's quantity editor **overwrites** it directly and is not capped at 4.
- All quantity inputs are validated as non-negative integers (Add additionally requires a positive integer).
- Some packs (e.g. the `draft` pack) have no declared `size` in the source data — these are excluded from set-completion percentage reporting, since a percentage against an unknown denominator is meaningless, but their cards still import normally and remain browsable.
- Deckbuilding / "what can I build with this" is explicitly out of scope for this plan.

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore` (additions), `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `next-env.d.ts`
- Test: `src/lib/sanity.test.ts`

**Interfaces:**
- Produces: a working `npm run dev` / `npm run build` / `npm test` toolchain that every later task builds on. Path alias `@/*` → `./src/*`.

- [ ] **Step 1: Initialize package.json and install core dependencies**

```bash
npm init -y
npm install next@latest react@latest react-dom@latest
npm install -D typescript@latest @types/node@latest @types/react@latest @types/react-dom@latest
npm install -D tailwindcss@latest postcss@latest autoprefixer@latest
npm install -D vitest@latest
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next-env.d.ts`**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 4: Write `next.config.mjs`**

Image `remotePatterns` must be set up front — `next/image` refuses to load from a host that isn't allow-listed, and the builder/set-browser pages (Tasks 9 and 11) hotlink card images from NetrunnerDB's CDN.

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'card-images.netrunnerdb.com' },
    ],
  },
}

export default nextConfig
```

- [ ] **Step 5: Write `tailwind.config.ts` and `postcss.config.mjs`**

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
}

export default config
```

```js
// postcss.config.mjs
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 6: Write `src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 7: Write `src/app/layout.tsx` and `src/app/page.tsx`**

```tsx
// src/app/layout.tsx
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Netrunner Collection Tracker',
  description: 'Track your Android: Netrunner card collection',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  )
}
```

```tsx
// src/app/page.tsx
export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Netrunner Collection Tracker</h1>
    </main>
  )
}
```

- [ ] **Step 8: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 9: Add npm scripts**

Edit `package.json` `"scripts"` to:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run"
}
```

- [ ] **Step 10: Write the sanity test**

```ts
// src/lib/sanity.test.ts
import { describe, it, expect } from 'vitest'

describe('sanity', () => {
  it('vitest is wired up', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 11: Update `.gitignore`**

Append:

```
node_modules/
.next/
data/*.db
data/*.db-journal
```

- [ ] **Step 12: Run the test suite**

Run: `npm test`
Expected: 1 passed (`sanity > vitest is wired up`)

- [ ] **Step 13: Run a production build to confirm the scaffold compiles**

Run: `npm run build`
Expected: build completes successfully, no type errors.

- [ ] **Step 14: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.mjs next-env.d.ts tailwind.config.ts postcss.config.mjs vitest.config.ts .gitignore src/
git commit -m "Scaffold Next.js + TypeScript + Tailwind + Vitest project"
```

---

### Task 2: Prisma schema and database client

**Files:**
- Create: `prisma/schema.prisma`, `.env`, `data/.gitkeep`, `src/lib/db.ts`, `src/lib/testDb.ts`, `src/lib/db.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `prisma` (singleton `PrismaClient`, from `src/lib/db.ts`) used by every later data-access module. `createTestDb(): PrismaClient` (from `src/lib/testDb.ts`) used by every later `*.test.ts`. Prisma models: `Cycle { code, name, position }`, `Pack { code, name, cycleCode, position, size (nullable), dateRelease (nullable) }`, `Faction { code, name, sideCode }`, `CardType { code, name, sideCode }`, `Card { code, title, typeCode, factionCode, packCode, sideCode, cost, factionCost, text, deckLimit, keywords, strength, uniqueness, position }`, `CollectionEntry { cardCode, quantityOwned }`.

- [ ] **Step 1: Install Prisma**

```bash
npm install @prisma/client@latest
npm install -D prisma@latest
```

- [ ] **Step 2: Create the data directory**

```bash
mkdir -p data
touch data/.gitkeep
```

- [ ] **Step 3: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Cycle {
  code     String @id
  name     String
  position Int
  packs    Pack[]
}

model Pack {
  code        String  @id
  name        String
  cycleCode   String
  cycle       Cycle   @relation(fields: [cycleCode], references: [code])
  position    Int
  size        Int?
  dateRelease String?
  cards       Card[]
}

model Faction {
  code     String @id
  name     String
  sideCode String
  cards    Card[]
}

model CardType {
  code     String @id
  name     String
  sideCode String
  cards    Card[]
}

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
  position        Int
  collectionEntry CollectionEntry?
}

model CollectionEntry {
  cardCode      String @id
  card          Card   @relation(fields: [cardCode], references: [code])
  quantityOwned Int    @default(0)
}
```

- [ ] **Step 4: Write `.env`**

The sqlite path is resolved relative to `prisma/schema.prisma`, so `../data/netrunner.db` points at the project-root `data/` directory created in Step 2.

```
DATABASE_URL="file:../data/netrunner.db"
```

- [ ] **Step 5: Run the initial migration**

Run: `npx prisma migrate dev --name init`
Expected: creates `prisma/migrations/<timestamp>_init/migration.sql`, applies it to `data/netrunner.db`, and generates the Prisma Client.

- [ ] **Step 6: Write the Prisma client singleton**

```ts
// src/lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
```

- [ ] **Step 7: Write the test-database helper**

Each test file gets its own throwaway SQLite file (via `prisma db push`, which applies the schema without going through the migration history) so tests never touch `data/netrunner.db`.

```ts
// src/lib/testDb.ts
import { PrismaClient } from '@prisma/client'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export function createTestDb(): PrismaClient {
  const dir = mkdtempSync(path.join(tmpdir(), 'netrunner-test-'))
  const dbPath = path.join(dir, 'test.db')
  const url = `file:${dbPath}`

  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  return new PrismaClient({ datasources: { db: { url } } })
}
```

- [ ] **Step 8: Write the schema integration test**

```ts
// src/lib/db.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb } from './testDb'
import type { PrismaClient } from '@prisma/client'

describe('prisma schema', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('stores a card with its cycle, pack, faction, and type relations', async () => {
    await prisma.cycle.create({ data: { code: 'core', name: 'Core Set', position: 1 } })
    await prisma.pack.create({
      data: { code: 'core', name: 'Core Set', cycleCode: 'core', position: 1, size: 1 },
    })
    await prisma.faction.create({ data: { code: 'anarch', name: 'Anarch', sideCode: 'runner' } })
    await prisma.cardType.create({ data: { code: 'program', name: 'Program', sideCode: 'runner' } })
    await prisma.card.create({
      data: {
        code: '01007',
        title: 'Corroder',
        typeCode: 'program',
        factionCode: 'anarch',
        packCode: 'core',
        sideCode: 'runner',
        cost: 2,
        factionCost: 2,
        deckLimit: 3,
        position: 7,
        uniqueness: false,
      },
    })

    const card = await prisma.card.findUniqueOrThrow({
      where: { code: '01007' },
      include: { pack: true, faction: true, type: true },
    })

    expect(card.title).toBe('Corroder')
    expect(card.pack.name).toBe('Core Set')
    expect(card.faction.name).toBe('Anarch')
    expect(card.type.name).toBe('Program')
  })

  it('tracks a collection entry for a card', async () => {
    await prisma.collectionEntry.create({ data: { cardCode: '01007', quantityOwned: 2 } })
    const entry = await prisma.collectionEntry.findUniqueOrThrow({ where: { cardCode: '01007' } })
    expect(entry.quantityOwned).toBe(2)
  })
})
```

- [ ] **Step 9: Run the test suite**

Run: `npm test`
Expected: all tests pass, including the two new `prisma schema` tests.

- [ ] **Step 10: Commit**

```bash
git add prisma/ .env data/.gitkeep src/lib/db.ts src/lib/testDb.ts src/lib/db.test.ts .gitignore
git commit -m "Add Prisma schema, SQLite datasource, and test-db helper"
```

---

### Task 3: Card data import logic

**Files:**
- Create: `src/lib/importData.ts`, `src/lib/importData.test.ts`

**Interfaces:**
- Consumes: `PrismaClient` (from `src/lib/db.ts`), `createTestDb()` (from `src/lib/testDb.ts`).
- Produces: `importAllCardData(prisma: PrismaClient, fetchImpl?: typeof fetch): Promise<ImportSummary>` where `ImportSummary = { cycles: number; packs: number; factions: number; types: number; cards: number }`. Used by Task 4's CLI script.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/importData.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createTestDb } from './testDb'
import { importAllCardData } from './importData'
import type { PrismaClient } from '@prisma/client'

function makeFetch(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = {
    'cycles.json': [{ code: 'core', name: 'Core Set', position: 1 }],
    'factions.json': [{ code: 'anarch', name: 'Anarch', side_code: 'runner' }],
    'types.json': [{ code: 'program', name: 'Program', side_code: 'runner' }],
    'packs.json': [
      { code: 'core', name: 'Core Set', cycle_code: 'core', position: 1, size: 1, date_release: '2012-09-06' },
    ],
    'pack/core.json': [
      {
        code: '01007',
        title: 'Corroder',
        type_code: 'program',
        faction_code: 'anarch',
        pack_code: 'core',
        side_code: 'runner',
        cost: 2,
        faction_cost: 2,
        deck_limit: 3,
        position: 7,
        uniqueness: false,
      },
    ],
    ...overrides,
  }

  return vi.fn(async (url: string) => {
    const key = Object.keys(responses).find((k) => url.endsWith(k))
    if (!key) throw new Error(`Unexpected fetch: ${url}`)
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => responses[key],
    } as Response
  })
}

describe('importAllCardData', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('imports cycles, factions, types, packs, and cards', async () => {
    const summary = await importAllCardData(prisma, makeFetch())

    expect(summary).toEqual({ cycles: 1, packs: 1, factions: 1, types: 1, cards: 1 })

    const card = await prisma.card.findUniqueOrThrow({ where: { code: '01007' } })
    expect(card.title).toBe('Corroder')
  })

  it('is idempotent and picks up field updates on re-import', async () => {
    await importAllCardData(prisma, makeFetch())
    await importAllCardData(
      prisma,
      makeFetch({
        'pack/core.json': [
          {
            code: '01007',
            title: 'Corroder (Errata)',
            type_code: 'program',
            faction_code: 'anarch',
            pack_code: 'core',
            side_code: 'runner',
            cost: 2,
            faction_cost: 2,
            deck_limit: 3,
            position: 7,
            uniqueness: false,
          },
        ],
      })
    )

    const cards = await prisma.card.findMany()
    expect(cards).toHaveLength(1)
    expect(cards[0].title).toBe('Corroder (Errata)')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- importData`
Expected: FAIL — `Cannot find module './importData'` (it doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/importData.ts
import type { PrismaClient } from '@prisma/client'

const BASE_URL = 'https://raw.githubusercontent.com/Null-Signal-Games/netrunner-cards-json/main'

export interface ImportSummary {
  cycles: number
  packs: number
  factions: number
  types: number
  cards: number
}

interface RawCycle {
  code: string
  name: string
  position: number
}

interface RawPack {
  code: string
  name: string
  cycle_code: string
  position: number
  size: number | null
  date_release: string | null
}

interface RawFaction {
  code: string
  name: string
  side_code: string
}

interface RawType {
  code: string
  name: string
  side_code: string
}

interface RawCard {
  code: string
  title: string
  type_code: string
  faction_code: string
  pack_code: string
  side_code: string
  cost?: number
  faction_cost?: number
  text?: string
  deck_limit?: number
  keywords?: string
  strength?: number
  uniqueness?: boolean
  position: number
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export async function importAllCardData(
  prisma: PrismaClient,
  fetchImpl: typeof fetch = fetch
): Promise<ImportSummary> {
  const [cycles, factions, types, packs] = await Promise.all([
    fetchJson<RawCycle[]>(fetchImpl, `${BASE_URL}/cycles.json`),
    fetchJson<RawFaction[]>(fetchImpl, `${BASE_URL}/factions.json`),
    fetchJson<RawType[]>(fetchImpl, `${BASE_URL}/types.json`),
    fetchJson<RawPack[]>(fetchImpl, `${BASE_URL}/packs.json`),
  ])

  const cardsByPack: Record<string, RawCard[]> = {}
  for (const pack of packs) {
    cardsByPack[pack.code] = await fetchJson<RawCard[]>(fetchImpl, `${BASE_URL}/pack/${pack.code}.json`)
  }

  let cardCount = 0

  await prisma.$transaction(
    async (tx) => {
      for (const cycle of cycles) {
        await tx.cycle.upsert({
          where: { code: cycle.code },
          create: { code: cycle.code, name: cycle.name, position: cycle.position },
          update: { name: cycle.name, position: cycle.position },
        })
      }

      for (const faction of factions) {
        await tx.faction.upsert({
          where: { code: faction.code },
          create: { code: faction.code, name: faction.name, sideCode: faction.side_code },
          update: { name: faction.name, sideCode: faction.side_code },
        })
      }

      for (const type of types) {
        await tx.cardType.upsert({
          where: { code: type.code },
          create: { code: type.code, name: type.name, sideCode: type.side_code },
          update: { name: type.name, sideCode: type.side_code },
        })
      }

      for (const pack of packs) {
        await tx.pack.upsert({
          where: { code: pack.code },
          create: {
            code: pack.code,
            name: pack.name,
            cycleCode: pack.cycle_code,
            position: pack.position,
            size: pack.size,
            dateRelease: pack.date_release,
          },
          update: {
            name: pack.name,
            cycleCode: pack.cycle_code,
            position: pack.position,
            size: pack.size,
            dateRelease: pack.date_release,
          },
        })
      }

      for (const pack of packs) {
        for (const card of cardsByPack[pack.code] ?? []) {
          const data = {
            title: card.title,
            typeCode: card.type_code,
            factionCode: card.faction_code,
            packCode: card.pack_code,
            sideCode: card.side_code,
            cost: card.cost ?? null,
            factionCost: card.faction_cost ?? null,
            text: card.text ?? null,
            deckLimit: card.deck_limit ?? null,
            keywords: card.keywords ?? null,
            strength: card.strength ?? null,
            uniqueness: card.uniqueness ?? false,
            position: card.position,
          }

          await tx.card.upsert({
            where: { code: card.code },
            create: { code: card.code, ...data },
            update: data,
          })
          cardCount += 1
        }
      }
    },
    { timeout: 60_000 }
  )

  return {
    cycles: cycles.length,
    packs: packs.length,
    factions: factions.length,
    types: types.length,
    cards: cardCount,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- importData`
Expected: PASS — both `importAllCardData` tests green.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/importData.ts src/lib/importData.test.ts
git commit -m "Add card data import logic with idempotent upserts"
```

---

### Task 4: Import CLI script and real data load

**Files:**
- Create: `scripts/import-cards.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `importAllCardData` (from `src/lib/importData.ts`), `prisma` (from `src/lib/db.ts`).
- Produces: a populated `data/netrunner.db` that every later manual-verification step (Tasks 9–12) relies on.

- [ ] **Step 1: Install tsx**

```bash
npm install -D tsx@latest
```

- [ ] **Step 2: Write the CLI script**

```ts
// scripts/import-cards.ts
import { prisma } from '../src/lib/db'
import { importAllCardData } from '../src/lib/importData'

async function main() {
  console.log('Importing Netrunner card data...')
  const summary = await importAllCardData(prisma)
  console.log('Import complete:', summary)
}

main()
  .catch((error) => {
    console.error('Import failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

- [ ] **Step 3: Add the npm script**

Edit `package.json` `"scripts"`, adding:

```json
"import-cards": "tsx scripts/import-cards.ts"
```

- [ ] **Step 4: Run the import against real data**

Run: `npm run import-cards`

Expected (verified against the live repo while writing this plan): `packs: 75`, `factions: 12`, `types: 14`, `cycles: 29`, and `cards` at least 2400 (the sum of declared pack sizes alone is 2451, plus cards from the one pack with no declared size). The command should complete without throwing.

- [ ] **Step 5: Spot-check the imported data**

Run: `npx prisma studio` (or a one-off query) and confirm `Card` rows exist for a well-known card, e.g. title `Sure Gamble`, and that `Pack` rows exist for `code: "core"` with `name: "Core Set"`.

- [ ] **Step 6: Commit**

```bash
git add scripts/import-cards.ts package.json package-lock.json
git commit -m "Add import-cards CLI script and run initial data load"
```

---

### Task 5: Collection business logic

**Files:**
- Create: `src/lib/testFixtures.ts`, `src/lib/collection.ts`, `src/lib/collection.test.ts`

**Interfaces:**
- Consumes: `createTestDb()` (from `src/lib/testDb.ts`).
- Produces: `seedCard(prisma, options): Promise<Card>` (test helper, reused by Tasks 6 and 7). `incrementOwned(prisma, cardCode, amount): Promise<number>`, `setOwned(prisma, cardCode, quantity): Promise<number>`, `getOwnedQuantity(prisma, cardCode): Promise<number>` — all consumed by Task 8's server actions and Task 7's search results.

- [ ] **Step 1: Write the shared test fixture helper**

```ts
// src/lib/testFixtures.ts
import type { PrismaClient, Card } from '@prisma/client'

interface SeedCardOptions {
  code: string
  title: string
  packCode: string
  packName?: string
  packSize?: number | null
  cycleCode?: string
  factionCode?: string
  typeCode?: string
  position?: number
}

export async function seedCard(prisma: PrismaClient, options: SeedCardOptions): Promise<Card> {
  const cycleCode = options.cycleCode ?? 'core'
  const factionCode = options.factionCode ?? 'anarch'
  const typeCode = options.typeCode ?? 'program'

  await prisma.cycle.upsert({
    where: { code: cycleCode },
    create: { code: cycleCode, name: cycleCode, position: 1 },
    update: {},
  })

  await prisma.pack.upsert({
    where: { code: options.packCode },
    create: {
      code: options.packCode,
      name: options.packName ?? options.packCode,
      cycleCode,
      position: 1,
      size: options.packSize === undefined ? 1 : options.packSize,
    },
    update: {},
  })

  await prisma.faction.upsert({
    where: { code: factionCode },
    create: { code: factionCode, name: factionCode, sideCode: 'runner' },
    update: {},
  })

  await prisma.cardType.upsert({
    where: { code: typeCode },
    create: { code: typeCode, name: typeCode, sideCode: 'runner' },
    update: {},
  })

  return prisma.card.create({
    data: {
      code: options.code,
      title: options.title,
      typeCode,
      factionCode,
      packCode: options.packCode,
      sideCode: 'runner',
      position: options.position ?? 1,
      uniqueness: false,
    },
  })
}
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/collection.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { incrementOwned, setOwned, getOwnedQuantity } from './collection'
import type { PrismaClient } from '@prisma/client'

describe('collection', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.card.deleteMany()
  })

  it('getOwnedQuantity returns 0 for a card with no collection entry', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    expect(await getOwnedQuantity(prisma, '01007')).toBe(0)
  })

  it('incrementOwned creates an entry when none exists', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    const quantity = await incrementOwned(prisma, '01007', 2)
    expect(quantity).toBe(2)
  })

  it('incrementOwned adds to an existing owned count', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, '01007', 1)
    const quantity = await incrementOwned(prisma, '01007', 2)
    expect(quantity).toBe(3)
  })

  it('incrementOwned rejects non-positive amounts', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await expect(incrementOwned(prisma, '01007', 0)).rejects.toThrow()
  })

  it('setOwned overwrites the owned count regardless of prior value', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, '01007', 3)
    const quantity = await setOwned(prisma, '01007', 1)
    expect(quantity).toBe(1)
  })

  it('setOwned accepts 0 to mark a card as not owned', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, '01007', 3)
    const quantity = await setOwned(prisma, '01007', 0)
    expect(quantity).toBe(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- collection`
Expected: FAIL — `Cannot find module './collection'`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/collection.ts
import type { PrismaClient } from '@prisma/client'

export async function incrementOwned(
  prisma: PrismaClient,
  cardCode: string,
  amount: number
): Promise<number> {
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error(`amount must be a positive integer, got ${amount}`)
  }

  const entry = await prisma.collectionEntry.upsert({
    where: { cardCode },
    create: { cardCode, quantityOwned: amount },
    update: { quantityOwned: { increment: amount } },
  })

  return entry.quantityOwned
}

export async function setOwned(
  prisma: PrismaClient,
  cardCode: string,
  quantity: number
): Promise<number> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`quantity must be a non-negative integer, got ${quantity}`)
  }

  const entry = await prisma.collectionEntry.upsert({
    where: { cardCode },
    create: { cardCode, quantityOwned: quantity },
    update: { quantityOwned: quantity },
  })

  return entry.quantityOwned
}

export async function getOwnedQuantity(prisma: PrismaClient, cardCode: string): Promise<number> {
  const entry = await prisma.collectionEntry.findUnique({ where: { cardCode } })
  return entry?.quantityOwned ?? 0
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- collection`
Expected: PASS — all 6 `collection` tests green.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/testFixtures.ts src/lib/collection.ts src/lib/collection.test.ts
git commit -m "Add collection business logic: increment-on-add vs overwrite-on-edit"
```

---

### Task 6: Reports business logic

**Files:**
- Create: `src/lib/reports.ts`, `src/lib/reports.test.ts`

**Interfaces:**
- Consumes: `createTestDb()`, `seedCard()`, `incrementOwned()`.
- Produces: `computeSetCompletion(prisma, packCode): Promise<SetCompletion | null>`, `computeAllSetsCompletion(prisma): Promise<SetCompletion[]>`, `computeCollectionTotals(prisma): Promise<CollectionTotals>` — consumed by Task 10 (dashboard) and Task 11 (set browser). `SetCompletion = { packCode, packName, cycleCode, ownedCount, totalCount, percentOwned }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/reports.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { incrementOwned } from './collection'
import { computeSetCompletion, computeAllSetsCompletion, computeCollectionTotals } from './reports'
import type { PrismaClient } from '@prisma/client'

describe('reports', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.card.deleteMany()
    await prisma.pack.deleteMany()
    await prisma.cycle.deleteMany()
  })

  it('computes percent owned for a set', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await incrementOwned(prisma, '01001', 1)

    const completion = await computeSetCompletion(prisma, 'core')

    expect(completion).toEqual({
      packCode: 'core',
      packName: 'core',
      cycleCode: 'core',
      ownedCount: 1,
      totalCount: 2,
      percentOwned: 50,
    })
  })

  it('returns null for a pack with no declared size', async () => {
    await seedCard(prisma, { code: '01001', title: 'Draft Card', packCode: 'draft', packSize: null, position: 1 })
    const completion = await computeSetCompletion(prisma, 'draft')
    expect(completion).toBeNull()
  })

  it('excludes sets with no declared size from the full list', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 1, position: 1 })
    await seedCard(prisma, { code: '02001', title: 'Draft Card', packCode: 'draft', packSize: null, position: 1 })

    const all = await computeAllSetsCompletion(prisma)

    expect(all.map((c) => c.packCode)).toEqual(['core'])
  })

  it('computes overall collection totals across all cards', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', packSize: 2, position: 1 })
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', packSize: 2, position: 2 })
    await incrementOwned(prisma, '01001', 1)

    const totals = await computeCollectionTotals(prisma)

    expect(totals).toEqual({ ownedCards: 1, totalCards: 2, percentOwned: 50 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- reports`
Expected: FAIL — `Cannot find module './reports'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/reports.ts
import type { PrismaClient } from '@prisma/client'

export interface SetCompletion {
  packCode: string
  packName: string
  cycleCode: string
  ownedCount: number
  totalCount: number
  percentOwned: number
}

export interface CollectionTotals {
  ownedCards: number
  totalCards: number
  percentOwned: number
}

export async function computeSetCompletion(
  prisma: PrismaClient,
  packCode: string
): Promise<SetCompletion | null> {
  const pack = await prisma.pack.findUnique({ where: { code: packCode } })
  if (!pack || !pack.size) {
    return null
  }

  const ownedCount = await prisma.card.count({
    where: {
      packCode,
      collectionEntry: { quantityOwned: { gt: 0 } },
    },
  })

  return {
    packCode: pack.code,
    packName: pack.name,
    cycleCode: pack.cycleCode,
    ownedCount,
    totalCount: pack.size,
    percentOwned: Math.round((ownedCount / pack.size) * 100),
  }
}

export async function computeAllSetsCompletion(prisma: PrismaClient): Promise<SetCompletion[]> {
  const packs = await prisma.pack.findMany({
    where: { size: { not: null } },
    orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }],
  })

  const results: SetCompletion[] = []
  for (const pack of packs) {
    const completion = await computeSetCompletion(prisma, pack.code)
    if (completion) {
      results.push(completion)
    }
  }

  return results
}

export async function computeCollectionTotals(prisma: PrismaClient): Promise<CollectionTotals> {
  const totalCards = await prisma.card.count()
  const ownedCards = await prisma.card.count({
    where: { collectionEntry: { quantityOwned: { gt: 0 } } },
  })

  return {
    ownedCards,
    totalCards,
    percentOwned: totalCards === 0 ? 0 : Math.round((ownedCards / totalCards) * 100),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- reports`
Expected: PASS — all 4 `reports` tests green.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reports.ts src/lib/reports.test.ts
git commit -m "Add set-completion and collection-total reporting logic"
```

---

### Task 7: Card search, image URLs, and the search API route

**Files:**
- Create: `src/lib/cardImage.ts`, `src/lib/cards.ts`, `src/lib/cards.test.ts`, `src/app/api/cards/search/route.ts`

**Interfaces:**
- Consumes: `createTestDb()`, `seedCard()`, `incrementOwned()`.
- Produces: `cardImageUrl(code): string` (consumed by Tasks 9 and 11 UI). `searchCards(prisma, filters): Promise<CardSearchResult[]>` where `CardSearchResult = { code, title, factionCode, typeCode, packCode, packName, sideCode, ownedQuantity }` (consumed by the route below and by Task 9's builder UI). `GET /api/cards/search?q=&faction=&type=&pack=&side=` returning `CardSearchResult[]` as JSON (consumed by Task 9's client component).

- [ ] **Step 1: Write the card image helper and its test**

```ts
// src/lib/cardImage.ts
export function cardImageUrl(code: string): string {
  return `https://card-images.netrunnerdb.com/v1/large/${code}.jpg`
}
```

```ts
// src/lib/cardImage.test.ts
import { describe, it, expect } from 'vitest'
import { cardImageUrl } from './cardImage'

describe('cardImageUrl', () => {
  it('builds the NetrunnerDB CDN url for a card code', () => {
    expect(cardImageUrl('01007')).toBe('https://card-images.netrunnerdb.com/v1/large/01007.jpg')
  })
})
```

- [ ] **Step 2: Write the failing test for search**

```ts
// src/lib/cards.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { incrementOwned } from './collection'
import { searchCards } from './cards'
import type { PrismaClient } from '@prisma/client'

describe('searchCards', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.card.deleteMany()
  })

  it('finds cards by a case-insensitive partial title match', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '01011', title: 'Mimic', packCode: 'core' })

    const results = await searchCards(prisma, { query: 'corro' })

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Corroder')
  })

  it('includes owned quantity in results', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, '01007', 2)

    const results = await searchCards(prisma, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(2)
  })

  it('returns 0 owned quantity for cards not in the collection', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const results = await searchCards(prisma, { query: 'Corroder' })

    expect(results[0].ownedQuantity).toBe(0)
  })

  it('filters by faction when provided', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', factionCode: 'anarch' })
    await seedCard(prisma, { code: '02001', title: 'Corroder Alt', packCode: 'core', factionCode: 'shaper' })

    const results = await searchCards(prisma, { query: 'Corroder', factionCode: 'anarch' })

    expect(results).toHaveLength(1)
    expect(results[0].code).toBe('01007')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- cards`
Expected: FAIL — `Cannot find module './cards'`.

- [ ] **Step 4: Write the implementation**

SQLite's default `LIKE` (which Prisma's `contains` compiles to) is already case-insensitive for ASCII, so no `mode` option is needed — and passing one would throw, since `mode: 'insensitive'` is a Postgres-only Prisma option.

```ts
// src/lib/cards.ts
import type { PrismaClient } from '@prisma/client'

export interface CardSearchFilters {
  query: string
  factionCode?: string
  typeCode?: string
  packCode?: string
  sideCode?: string
}

export interface CardSearchResult {
  code: string
  title: string
  factionCode: string
  typeCode: string
  packCode: string
  packName: string
  sideCode: string
  ownedQuantity: number
}

export async function searchCards(
  prisma: PrismaClient,
  filters: CardSearchFilters
): Promise<CardSearchResult[]> {
  const cards = await prisma.card.findMany({
    where: {
      title: { contains: filters.query },
      ...(filters.factionCode ? { factionCode: filters.factionCode } : {}),
      ...(filters.typeCode ? { typeCode: filters.typeCode } : {}),
      ...(filters.packCode ? { packCode: filters.packCode } : {}),
      ...(filters.sideCode ? { sideCode: filters.sideCode } : {}),
    },
    include: { pack: true, collectionEntry: true },
    orderBy: { title: 'asc' },
    take: 50,
  })

  return cards.map((card) => ({
    code: card.code,
    title: card.title,
    factionCode: card.factionCode,
    typeCode: card.typeCode,
    packCode: card.packCode,
    packName: card.pack.name,
    sideCode: card.sideCode,
    ownedQuantity: card.collectionEntry?.quantityOwned ?? 0,
  }))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- cards`
Expected: PASS — all 4 `searchCards` tests plus the `cardImageUrl` test green.

- [ ] **Step 6: Write the search API route**

```ts
// src/app/api/cards/search/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { searchCards } from '@/lib/cards'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? ''

  if (query.trim().length === 0) {
    return NextResponse.json([])
  }

  const results = await searchCards(prisma, {
    query,
    factionCode: request.nextUrl.searchParams.get('faction') ?? undefined,
    typeCode: request.nextUrl.searchParams.get('type') ?? undefined,
    packCode: request.nextUrl.searchParams.get('pack') ?? undefined,
    sideCode: request.nextUrl.searchParams.get('side') ?? undefined,
  })

  return NextResponse.json(results)
}
```

- [ ] **Step 7: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds (confirms the route handler type-checks).

- [ ] **Step 8: Manually verify the route against real data**

Run: `npm run dev`, then in another terminal: `curl "http://localhost:3000/api/cards/search?q=sure+gamble"`
Expected: a JSON array containing a card titled `Sure Gamble`. Stop the dev server afterward.

- [ ] **Step 9: Commit**

```bash
git add src/lib/cardImage.ts src/lib/cardImage.test.ts src/lib/cards.ts src/lib/cards.test.ts src/app/api/cards/search/route.ts
git commit -m "Add card search logic, image URL helper, and search API route"
```

---

### Task 8: Collection server actions

**Files:**
- Create: `src/actions/collectionActions.ts`

**Interfaces:**
- Consumes: `incrementOwned`, `setOwned` (from `src/lib/collection.ts`), `prisma` (from `src/lib/db.ts`).
- Produces: `addToCollection(cardCode: string, amount: number): Promise<number>`, `updateCollectionQuantity(cardCode: string, quantity: number): Promise<number>` — consumed directly by Task 9's and Task 11's client components.

This is a thin wiring layer over already-tested logic (Task 5), so it has no dedicated unit test — Next.js Server Actions must take serializable arguments to be callable from client components, which rules out injecting a test `PrismaClient` the way earlier tasks do. Its correctness is verified by the type-check in Step 2 and the manual UI walkthroughs in Tasks 9, 11, and 12.

- [ ] **Step 1: Write the server actions**

```ts
// src/actions/collectionActions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { incrementOwned, setOwned } from '@/lib/collection'

export async function addToCollection(cardCode: string, amount: number): Promise<number> {
  const quantity = await incrementOwned(prisma, cardCode, amount)
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  return quantity
}

export async function updateCollectionQuantity(cardCode: string, quantity: number): Promise<number> {
  const updated = await setOwned(prisma, cardCode, quantity)
  revalidatePath('/')
  revalidatePath('/sets/[packCode]', 'page')
  return updated
}
```

- [ ] **Step 2: Verify it compiles under Next.js's server-action constraints**

Run: `npm run build`
Expected: build succeeds with no errors about non-serializable arguments or invalid `'use server'` exports.

- [ ] **Step 3: Commit**

```bash
git add src/actions/collectionActions.ts
git commit -m "Add server actions wiring collection mutations to the UI"
```

---

### Task 9: Collection builder page

**Files:**
- Create: `src/app/builder/page.tsx`, `src/app/builder/CardBuilderForm.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `CardSearchResult` (from `src/lib/cards.ts`), `cardImageUrl` (from `src/lib/cardImage.ts`), `addToCollection` (from `src/actions/collectionActions.ts`), `GET /api/cards/search`.
- Produces: the `/builder` route and a shared nav bar in the root layout, used by Task 10 and Task 11's pages too.

- [ ] **Step 1: Add navigation to the root layout**

```tsx
// src/app/layout.tsx
import Link from 'next/link'
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Netrunner Collection Tracker',
  description: 'Track your Android: Netrunner card collection',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <nav className="flex gap-6 border-b border-neutral-800 px-8 py-4">
          <Link href="/" className="font-semibold">
            Dashboard
          </Link>
          <Link href="/builder">Builder</Link>
        </nav>
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Write the builder form client component**

```tsx
// src/app/builder/CardBuilderForm.tsx
'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { addToCollection } from '@/actions/collectionActions'
import { cardImageUrl } from '@/lib/cardImage'
import type { CardSearchResult } from '@/lib/cards'

export function CardBuilderForm() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardSearchResult[]>([])
  const [selected, setSelected] = useState<CardSearchResult | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [status, setStatus] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function runSearch(value: string) {
    setQuery(value)
    setSelected(null)
    setStatus(null)

    if (value.trim().length === 0) {
      setResults([])
      return
    }

    const response = await fetch(`/api/cards/search?q=${encodeURIComponent(value)}`)
    const data: CardSearchResult[] = await response.json()
    setResults(data)
  }

  function handleAdd() {
    if (!selected) return

    startTransition(async () => {
      const newQuantity = await addToCollection(selected.code, quantity)
      setStatus(`${selected.title}: now own ${newQuantity}`)
      setResults((prev) =>
        prev.map((card) => (card.code === selected.code ? { ...card, ownedQuantity: newQuantity } : card))
      )
    })
  }

  return (
    <div className="space-y-6">
      <input
        type="text"
        value={query}
        onChange={(event) => runSearch(event.target.value)}
        placeholder="Search for a card by title..."
        className="w-full rounded border border-neutral-700 bg-neutral-900 px-4 py-2"
      />

      <ul className="divide-y divide-neutral-800">
        {results.map((card) => (
          <li
            key={card.code}
            onClick={() => setSelected(card)}
            className={`flex items-center gap-4 p-3 cursor-pointer ${
              selected?.code === card.code ? 'bg-neutral-800' : ''
            }`}
          >
            <Image src={cardImageUrl(card.code)} alt={card.title} width={44} height={62} className="rounded" />
            <div className="flex-1">
              <div className="font-medium">{card.title}</div>
              <div className="text-sm text-neutral-400">
                {card.factionCode} · {card.packName} · owned: {card.ownedQuantity}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {selected && (
        <div className="flex items-center gap-4 rounded border border-neutral-700 p-4">
          <span>Adding {selected.title}</span>
          <select
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={isPending}
            className="rounded bg-blue-600 px-4 py-2 font-medium disabled:opacity-50"
          >
            {isPending ? 'Adding...' : 'Add'}
          </button>
        </div>
      )}

      {status && <p className="text-green-400">{status}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Write the page**

```tsx
// src/app/builder/page.tsx
import { CardBuilderForm } from './CardBuilderForm'

export default function BuilderPage() {
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Collection Builder</h1>
      <CardBuilderForm />
    </main>
  )
}
```

- [ ] **Step 4: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3000/builder`.
- Type "corroder" into the search box — expect one result with its image, faction, and set.
- Click the result, pick quantity 2, click Add — expect the status line to read "Corroder: now own 2".
- Search "corroder" again — expect the result's "owned: 2" to reflect the update.
Stop the dev server afterward.

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.tsx src/app/builder/
git commit -m "Add collection builder page with search, quantity picker, and add"
```

---

### Task 10: Dashboard / reports page

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `computeAllSetsCompletion`, `computeCollectionTotals` (from `src/lib/reports.ts`), `prisma` (from `src/lib/db.ts`).
- Produces: links to `/sets/[packCode]`, the route Task 11 implements.

- [ ] **Step 1: Replace the placeholder home page with the dashboard**

```tsx
// src/app/page.tsx
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { computeAllSetsCompletion, computeCollectionTotals, type SetCompletion } from '@/lib/reports'

export default async function DashboardPage() {
  const [sets, totals] = await Promise.all([
    computeAllSetsCompletion(prisma),
    computeCollectionTotals(prisma),
  ])

  const setsByCycle = new Map<string, SetCompletion[]>()
  for (const set of sets) {
    const existing = setsByCycle.get(set.cycleCode) ?? []
    existing.push(set)
    setsByCycle.set(set.cycleCode, existing)
  }

  return (
    <main className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Collection Overview</h1>
        <p className="text-neutral-400">
          {totals.ownedCards} / {totals.totalCards} cards owned ({totals.percentOwned}%)
        </p>
      </div>

      <div className="space-y-6">
        {[...setsByCycle.entries()].map(([cycleCode, cycleSets]) => (
          <div key={cycleCode}>
            <h2 className="text-lg font-semibold mb-2 capitalize">{cycleCode.replace(/-/g, ' ')}</h2>
            <ul className="space-y-2">
              {cycleSets.map((set) => (
                <li key={set.packCode}>
                  <Link
                    href={`/sets/${set.packCode}`}
                    className="block rounded border border-neutral-800 p-3 hover:border-neutral-600"
                  >
                    <div className="flex justify-between">
                      <span>{set.packName}</span>
                      <span>
                        {set.ownedCount}/{set.totalCount} ({set.percentOwned}%)
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded bg-neutral-800">
                      <div className="h-2 rounded bg-blue-600" style={{ width: `${set.percentOwned}%` }} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 3: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3000/`.
Expected: the overall total line at the top reflects whatever was added in Task 9's walkthrough (e.g. `1 / <total> cards owned`); sets are grouped under cycle headings; the Core Set entry shows a non-zero percentage if Corroder was added there. Links to individual sets will 404 until Task 11 — that's expected at this point. Stop the dev server afterward.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "Add dashboard page with per-set completion and overall totals"
```

---

### Task 11: Set browser page

**Files:**
- Modify: `src/lib/cards.ts`, `src/lib/cards.test.ts`
- Create: `src/app/sets/[packCode]/page.tsx`, `src/app/sets/[packCode]/SetCardGrid.tsx`

**Interfaces:**
- Consumes: `computeSetCompletion` (from `src/lib/reports.ts`), `updateCollectionQuantity` (from `src/actions/collectionActions.ts`), `cardImageUrl` (from `src/lib/cardImage.ts`), `prisma`.
- Produces: `listCardsInPack(prisma, packCode): Promise<PackCardEntry[]>` where `PackCardEntry = { code, title, factionCode, typeCode, position, ownedQuantity }`. The `/sets/[packCode]` route linked from Task 10's dashboard.

- [ ] **Step 1: Write the failing test for the new lib function**

Append to `src/lib/cards.test.ts`:

```ts
import { listCardsInPack } from './cards'

// ... inside the existing top-level describe block, add a new describe:
describe('listCardsInPack', () => {
  it('lists cards in a pack ordered by position with owned quantities', async () => {
    await seedCard(prisma, { code: '01002', title: 'Card B', packCode: 'core', position: 2 })
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', position: 1 })
    await incrementOwned(prisma, '01001', 3)

    const cards = await listCardsInPack(prisma, 'core')

    expect(cards.map((c) => c.code)).toEqual(['01001', '01002'])
    expect(cards[0].ownedQuantity).toBe(3)
    expect(cards[1].ownedQuantity).toBe(0)
  })
})
```

(The `listCardsInPack` import joins the existing `searchCards` import at the top of the file; the `describe('listCardsInPack', ...)` block is a sibling of the existing `describe('searchCards', ...)` block, sharing the same `beforeAll`/`afterEach` setup already in the file.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- cards`
Expected: FAIL — `listCardsInPack` is not exported from `./cards`.

- [ ] **Step 3: Add the implementation to `src/lib/cards.ts`**

Append:

```ts
export interface PackCardEntry {
  code: string
  title: string
  factionCode: string
  typeCode: string
  position: number
  ownedQuantity: number
}

export async function listCardsInPack(prisma: PrismaClient, packCode: string): Promise<PackCardEntry[]> {
  const cards = await prisma.card.findMany({
    where: { packCode },
    include: { collectionEntry: true },
    orderBy: { position: 'asc' },
  })

  return cards.map((card) => ({
    code: card.code,
    title: card.title,
    factionCode: card.factionCode,
    typeCode: card.typeCode,
    position: card.position,
    ownedQuantity: card.collectionEntry?.quantityOwned ?? 0,
  }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- cards`
Expected: PASS — including the new `listCardsInPack` test.

- [ ] **Step 5: Write the quantity-editing grid client component**

```tsx
// src/app/sets/[packCode]/SetCardGrid.tsx
'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { updateCollectionQuantity } from '@/actions/collectionActions'
import { cardImageUrl } from '@/lib/cardImage'
import type { PackCardEntry } from '@/lib/cards'

export function SetCardGrid({ cards }: { cards: PackCardEntry[] }) {
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(cards.map((card) => [card.code, card.ownedQuantity]))
  )
  const [isPending, startTransition] = useTransition()

  function handleChange(code: string, value: number) {
    setQuantities((prev) => ({ ...prev, [code]: value }))
    startTransition(async () => {
      await updateCollectionQuantity(code, value)
    })
  }

  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {cards.map((card) => {
        const owned = quantities[card.code]
        return (
          <li
            key={card.code}
            className={`flex items-center gap-3 rounded border p-3 ${
              owned > 0 ? 'border-neutral-700' : 'border-neutral-800 opacity-50'
            }`}
          >
            <Image src={cardImageUrl(card.code)} alt={card.title} width={44} height={62} className="rounded" />
            <div className="flex-1">
              <div className="font-medium">{card.title}</div>
              <div className="text-sm text-neutral-400">{card.factionCode}</div>
            </div>
            <input
              type="number"
              min={0}
              value={owned}
              disabled={isPending}
              onChange={(event) => handleChange(card.code, Number(event.target.value))}
              className="w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-center"
            />
          </li>
        )
      })}
    </ul>
  )
}
```

- [ ] **Step 6: Write the page**

Next.js (current versions) resolve dynamic route `params` as a `Promise`, not a plain object — it must be awaited before use.

```tsx
// src/app/sets/[packCode]/page.tsx
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { listCardsInPack } from '@/lib/cards'
import { computeSetCompletion } from '@/lib/reports'
import { SetCardGrid } from './SetCardGrid'

export default async function SetPage({ params }: { params: Promise<{ packCode: string }> }) {
  const { packCode } = await params

  const pack = await prisma.pack.findUnique({ where: { code: packCode } })
  if (!pack) {
    notFound()
  }

  const [cards, completion] = await Promise.all([
    listCardsInPack(prisma, packCode),
    computeSetCompletion(prisma, packCode),
  ])

  return (
    <main className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{pack.name}</h1>
        {completion && (
          <p className="text-neutral-400">
            {completion.ownedCount}/{completion.totalCount} owned ({completion.percentOwned}%)
          </p>
        )}
      </div>
      <SetCardGrid cards={cards} />
    </main>
  )
}
```

- [ ] **Step 7: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 8: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3000/` and click into the Core Set.
Expected: every Core Set card is listed in box order; Corroder (added in Task 9) shows quantity 2 and is not dimmed; other cards show 0 and are dimmed. Change Corroder's quantity to 3 via the number input, reload the page — expect it to still read 3. Go back to `/`, expect the Core Set percentage to have changed accordingly. Stop the dev server afterward.

- [ ] **Step 9: Commit**

```bash
git add src/lib/cards.ts src/lib/cards.test.ts src/app/sets/
git commit -m "Add set browser page with owned/missing view and inline quantity editing"
```

---

### Task 12: End-to-end verification

**Files:** none (verification only).

**Interfaces:** none — this task exercises the full stack built in Tasks 1–11.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`
Expected: every test across `sanity`, `db`, `importData`, `collection`, `reports`, `cardImage`, and `cards` passes.

- [ ] **Step 2: Run a production build**

Run: `npm run build`
Expected: builds successfully with no type errors.

- [ ] **Step 3: Walk through the full user flow**

Run: `npm run dev`, then in the browser:
1. Open `/` — confirm sets are grouped by cycle with progress bars, and the overall total at the top matches the state left over from Tasks 9–11's manual checks.
2. Open `/builder`, search for a card you haven't added yet (e.g. "Sure Gamble"), select it, choose quantity 3, click Add — confirm the status message and that re-searching shows "owned: 3".
3. Return to `/`, confirm the relevant set's percentage increased.
4. Click into that set, confirm the newly-added card shows quantity 3 and is no longer dimmed; change it to 4 via the number input; reload the page and confirm it persisted.
5. Return to `/`, confirm the set's percentage is unchanged from step 3 (going 3→4 owned doesn't change how many *distinct* cards are owned).

- [ ] **Step 4: Confirm the working tree is clean**

Run: `git status`
Expected: no uncommitted changes (everything was committed at the end of each task).
