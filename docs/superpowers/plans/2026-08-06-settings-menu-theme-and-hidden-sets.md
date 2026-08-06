# Settings Menu, Theme, and Hidden Builder Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cog-icon settings menu (top right) leading to a `/settings` page with a Light/Dark theme switch and a "Hide Sets from Builder" multi-select, plus a full light-mode re-skin of every existing page via semantic color tokens.

**Architecture:** A new `HiddenBuilderPack` table (DB-backed, enforced inside `searchCards`) drives Builder-search exclusion. Theme is a `localStorage`-backed preference toggled via a `dark` class on `<html>`, applied pre-paint by an inline script to avoid a flash of the wrong theme. A small set of semantic Tailwind v4 `@theme` color tokens (`bg-app`, `bg-surface`, `bg-surface-hover`, `border-default`, `border-subtle`, `text-primary`, `text-muted`, `text-faint`), each redefined under `.dark`, replaces every hardcoded `neutral-*` class across the app — accent colors (blue/red/green/yellow) are left as direct Tailwind classes, unchanged in both themes.

**Tech Stack:** Next.js (App Router) client/server components, Prisma/SQLite, Tailwind CSS v4, Vitest + React Testing Library.

## Global Constraints

- Single-user app, no accounts — one theme preference, one hidden-set list, not per-user.
- Theme persists in `localStorage` (key `netrunner-theme`, values `'light' | 'dark'`); default when unset is `'dark'`.
- Hidden-set list persists in the database via a new `HiddenBuilderPack` table; hiding only affects `searchCards`'s general (unscoped) search — the dashboard and a set's own `/sets/[packCode]` page are unaffected.
- Every color token's dark value must reproduce today's exact look (`bg-app`=`neutral-950`, `bg-surface`=`neutral-900`, `bg-surface-hover`=`neutral-800`, `border-default`=`neutral-700`, `border-subtle`=`neutral-800`, `text-primary`=`neutral-100`, `text-muted`=`neutral-400`, `text-faint`=`neutral-500`/`600` consolidated to `neutral-500`). Light values: `bg-app`/`bg-surface`=`white`, `bg-surface-hover`=`neutral-100`, `border-default`=`neutral-300`, `border-subtle`=`neutral-200`, `text-primary`=`neutral-900`, `text-muted`=`neutral-600`, `text-faint`=`neutral-400`.
- Accent colors (`blue-400`/`blue-600`, `red-400`/`red-500`/`red-800`/`red-950`, `green-400`, `yellow-400`) are never tokenized — left as direct Tailwind classes in every file.
- Every existing test must keep passing; component tests assert behavior/structure, not raw Tailwind class strings, except where a task explicitly adds a class-presence assertion.
- Spec: `docs/superpowers/specs/2026-08-06-settings-menu-theme-and-hidden-sets-design.md`.

---

### Task 1: Data model — `HiddenBuilderPack` table

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces (used by Tasks 5, 7): a `HiddenBuilderPack` Prisma model with `packCode String @id` and a `pack` relation to `Pack`, queryable as `prisma.hiddenBuilderPack.findMany(...)`, `prisma.hiddenBuilderPack.deleteMany()`, `prisma.hiddenBuilderPack.createMany(...)`.

- [ ] **Step 1: Add the model to the schema**

In `prisma/schema.prisma`, add `hiddenFromBuilder HiddenBuilderPack?` as a new field on the `Pack` model (after the existing `cards Card[]` line), and add a new model after `CollectionEntry`:

```prisma
model Pack {
  code        String  @id
  name        String
  cycleCode   String
  cycle       Cycle   @relation(fields: [cycleCode], references: [code])
  position    Int
  size        Int?
  dateRelease String?
  /// e.g. "core", "data_pack", "deluxe", "expansion", "booster_pack", "campaign", "draft", "promo" — see src/lib/setTypes.ts
  setType     String?
  cards       Card[]
  hiddenFromBuilder HiddenBuilderPack?
}
```

(only the `hiddenFromBuilder` line is new — every other line of `Pack` is unchanged, shown here for exact placement)

```prisma
model HiddenBuilderPack {
  packCode String @id
  pack     Pack   @relation(fields: [packCode], references: [code])
}
```

Add this new model at the end of the file, after the existing `CollectionEntry` model.

- [ ] **Step 2: Generate and apply the migration**

Run: `cd /var/www/netrunner && npx prisma migrate dev --name add_hidden_builder_pack`
Expected: a new folder under `prisma/migrations/` (timestamp-prefixed, ending `_add_hidden_builder_pack`) containing `migration.sql` with a `CREATE TABLE "HiddenBuilderPack"` statement, applied to `data/netrunner.db`, and the Prisma client regenerated (no errors).

- [ ] **Step 3: Verify**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "Add HiddenBuilderPack table for hiding sets from Builder search"
```

---

### Task 2: Theme color tokens + anti-flash script + `layout.tsx` color migration

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces (used by every later task touching a `.tsx` file): the Tailwind utility classes `bg-app`, `bg-surface`, `bg-surface-hover`, `border-default`, `border-subtle`, `text-primary`, `text-muted`, `text-faint`, theme-aware via a `dark` class on `<html>`.
- Produces: `localStorage` key `'netrunner-theme'` (values `'light'` or `'dark'`), read by the anti-flash script in this file and later written by `ThemeToggle` (Task 4).

- [ ] **Step 1: Define the color tokens**

Replace the full contents of `src/app/globals.css` with:

```css
@config "../../tailwind.config.ts";
@import "tailwindcss";

@theme {
  --color-app: #ffffff;
  --color-surface: #ffffff;
  --color-surface-hover: #f5f5f5;
  --color-default: #d4d4d4;
  --color-subtle: #e5e5e5;
  --color-primary: #171717;
  --color-muted: #525252;
  --color-faint: #a3a3a3;
}

.dark {
  --color-app: #0a0a0a;
  --color-surface: #171717;
  --color-surface-hover: #262626;
  --color-default: #404040;
  --color-subtle: #262626;
  --color-primary: #f5f5f5;
  --color-muted: #a3a3a3;
  --color-faint: #737373;
}

html {
  /* Reserve space for the vertical scrollbar at all times, so content
     that toggles the page between scrollable and not (e.g. narrowing a
     card list with a filter) doesn't shift horizontally each time. */
  scrollbar-gutter: stable;
}
```

- [ ] **Step 2: Add the anti-flash script and migrate `layout.tsx`'s own colors**

Replace the full contents of `src/app/layout.tsx` with:

```tsx
import Link from 'next/link'
import Script from 'next/script'
import './globals.css'
import type { Metadata } from 'next'
import { ReportsNavDropdown } from '@/components/ReportsNavDropdown'

export const metadata: Metadata = {
  title: 'Netrunner Collection Tracker',
  description: 'Track your Android: Netrunner card collection',
}

const THEME_INIT_SCRIPT = `
try {
  var theme = localStorage.getItem('netrunner-theme');
  if (theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-app text-primary">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <nav className="flex gap-6 border-b border-subtle px-8 py-4">
          <Link href="/" className="font-semibold">
            Dashboard
          </Link>
          <Link href="/builder">Builder</Link>
          <ReportsNavDropdown />
        </nav>
        {children}
      </body>
    </html>
  )
}
```

This step does not yet add the `SettingsMenu` or restructure the nav — that's Task 3, which builds on this exact file state.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (this step changes only CSS custom-property definitions and a `<script>`/color-class swap in `layout.tsx`, which has no test file — no behavioral change to any tested component).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "Add theme color tokens and pre-paint dark/light init script"
```

---

### Task 3: `SettingsMenu` component + nav restructure

**Files:**
- Create: `src/components/SettingsMenu.tsx`
- Create: `src/components/SettingsMenu.test.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: nothing new — a self-contained client component, structurally mirroring `src/components/ReportsNavDropdown.tsx`.
- Produces: `SettingsMenu(): JSX.Element` — a cog-icon button (`aria-label="Settings"`) that toggles a `role="menu"` dropdown containing one `role="menuitem"` link, text `Configuration`, `href="/settings"`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/SettingsMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsMenu } from './SettingsMenu'

// jsdom doesn't implement real navigation — clicking any real <a href> (Next's
// Link or otherwise) triggers it to log "Not implemented: navigation to
// another Document". The mock still renders a real, inspectable anchor and
// still fires the component's own onClick, it just stops the browser's
// default action first so jsdom never attempts the unsupported navigation.
vi.mock('next/link', () => ({
  default: ({ onClick, ...props }: React.ComponentProps<'a'>) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
    />
  ),
}))

describe('SettingsMenu', () => {
  it('is closed by default', () => {
    render(<SettingsMenu />)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the trigger opens the menu with a link to /settings', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('menuitem', { name: 'Configuration' })).toHaveAttribute('href', '/settings')
  })

  it('clicking the trigger again closes the menu', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    const trigger = screen.getByRole('button', { name: 'Settings' })
    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking outside the dropdown closes it', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <SettingsMenu />
        <p>Elsewhere on the page</p>
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByText('Elsewhere on the page'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking the Configuration link closes the menu', async () => {
    const user = userEvent.setup()
    render(<SettingsMenu />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('menuitem', { name: 'Configuration' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/SettingsMenu.test.tsx`
Expected: FAIL — `SettingsMenu.tsx` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/components/SettingsMenu.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

export function SettingsMenu() {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Settings"
        className="cursor-pointer text-muted hover:text-primary"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-2 min-w-48 rounded border border-default bg-surface py-1 shadow-lg"
        >
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setIsOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-surface-hover"
          >
            Configuration
          </Link>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/SettingsMenu.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire it into the nav bar, pushed to the right**

Replace the full contents of `src/app/layout.tsx` with (builds on Task 2's version — adds the `SettingsMenu` import/usage and restructures `<nav>` with `justify-between`, wrapping the existing left-side links in their own `<div>` so `gap-6` still applies only among them):

```tsx
import Link from 'next/link'
import Script from 'next/script'
import './globals.css'
import type { Metadata } from 'next'
import { ReportsNavDropdown } from '@/components/ReportsNavDropdown'
import { SettingsMenu } from '@/components/SettingsMenu'

export const metadata: Metadata = {
  title: 'Netrunner Collection Tracker',
  description: 'Track your Android: Netrunner card collection',
}

const THEME_INIT_SCRIPT = `
try {
  var theme = localStorage.getItem('netrunner-theme');
  if (theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-app text-primary">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <nav className="flex items-center justify-between border-b border-subtle px-8 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold">
              Dashboard
            </Link>
            <Link href="/builder">Builder</Link>
            <ReportsNavDropdown />
          </div>
          <SettingsMenu />
        </nav>
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 5 new `SettingsMenu` tests (no existing test targets `layout.tsx` directly, so nothing else is affected).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/SettingsMenu.tsx src/components/SettingsMenu.test.tsx src/app/layout.tsx
git commit -m "Add cog-icon SettingsMenu to the nav bar"
```

---

### Task 4: `ThemeToggle` component

**Files:**
- Create: `src/components/ThemeToggle.tsx`
- Create: `src/components/ThemeToggle.test.tsx`

**Interfaces:**
- Consumes: `document.documentElement.classList`, `localStorage` key `'netrunner-theme'` (established by Task 2's init script).
- Produces (used by Task 6's `SettingsForm`): `ThemeToggle(): JSX.Element` — no props. Renders two buttons, accessible names exactly `Light` and `Dark` (capitalized). Clicking one sets `document.documentElement`'s `dark` class accordingly and writes `'light'`/`'dark'` to `localStorage['netrunner-theme']`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/ThemeToggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from './ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
    localStorage.clear()
  })

  it('shows Dark as selected when the html element currently has the dark class', () => {
    document.documentElement.classList.add('dark')
    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Dark' })).toHaveClass('text-blue-400')
    expect(screen.getByRole('button', { name: 'Light' })).not.toHaveClass('text-blue-400')
  })

  it('shows Light as selected when the html element does not have the dark class', () => {
    render(<ThemeToggle />)

    expect(screen.getByRole('button', { name: 'Light' })).toHaveClass('text-blue-400')
    expect(screen.getByRole('button', { name: 'Dark' })).not.toHaveClass('text-blue-400')
  })

  it('clicking Light removes the dark class and persists the choice', async () => {
    document.documentElement.classList.add('dark')
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'Light' }))

    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('netrunner-theme')).toBe('light')
    expect(screen.getByRole('button', { name: 'Light' })).toHaveClass('text-blue-400')
  })

  it('clicking Dark adds the dark class and persists the choice', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)

    await user.click(screen.getByRole('button', { name: 'Dark' }))

    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('netrunner-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveClass('text-blue-400')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/ThemeToggle.test.tsx`
Expected: FAIL — `ThemeToggle.tsx` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/components/ThemeToggle.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'netrunner-theme'

type Theme = 'light' | 'dark'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  function selectTheme(next: Theme) {
    setTheme(next)
    applyTheme(next)
  }

  return (
    <div className="flex gap-2">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => selectTheme(option.value)}
          className={`cursor-pointer rounded border px-3 py-1 text-sm ${
            theme === option.value
              ? 'border-blue-600 bg-blue-600/20 text-blue-400'
              : 'border-default hover:bg-surface-hover'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/ThemeToggle.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ThemeToggle.tsx src/components/ThemeToggle.test.tsx
git commit -m "Add ThemeToggle component"
```

---

### Task 5: Hidden-set mutations + `searchCards` filtering

**Files:**
- Create: `src/actions/settingsMutations.ts`
- Create: `src/actions/settingsMutations.test.ts`
- Create: `src/actions/settingsActions.ts`
- Modify: `src/lib/cards.ts`
- Modify: `src/lib/cards.test.ts`

**Interfaces:**
- Consumes: `HiddenBuilderPack` model from Task 1.
- Produces (used by Task 6): `getHiddenBuilderPackCodes(prisma: PrismaClient): Promise<string[]>`, `setHiddenBuilderPacks(prisma: PrismaClient, packCodes: string[]): Promise<void>` (both in `settingsMutations.ts`), and `updateHiddenBuilderPacks(packCodes: string[]): Promise<void>` (in `settingsActions.ts`, the `'use server'` wrapper the client form calls directly).
- Modifies: `searchCards` (`src/lib/cards.ts`) — same exported signature as today, now additionally excludes cards whose `packCode` is hidden, for the general (unscoped) search only.

- [ ] **Step 1: Write the failing tests for the mutations**

Create `src/actions/settingsMutations.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from '@/lib/testDb'
import { seedCard } from '@/lib/testFixtures'
import { getHiddenBuilderPackCodes, setHiddenBuilderPacks } from './settingsMutations'
import type { PrismaClient } from '@prisma/client'

let prisma: PrismaClient

beforeAll(() => {
  prisma = createTestDb()
})

afterAll(async () => {
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.hiddenBuilderPack.deleteMany()
  await prisma.collectionEntry.deleteMany()
  await prisma.card.deleteMany()
  await prisma.pack.deleteMany()
})

describe('getHiddenBuilderPackCodes / setHiddenBuilderPacks', () => {
  it('returns an empty list when nothing is hidden', async () => {
    expect(await getHiddenBuilderPackCodes(prisma)).toEqual([])
  })

  it('persists a hidden-set list and returns it back', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '02001', title: 'Card B', packCode: 'sg' })

    await setHiddenBuilderPacks(prisma, ['core', 'sg'])

    expect(await getHiddenBuilderPackCodes(prisma)).toEqual(expect.arrayContaining(['core', 'sg']))
  })

  it('replaces the full list rather than appending to it', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await seedCard(prisma, { code: '02001', title: 'Card B', packCode: 'sg' })
    await setHiddenBuilderPacks(prisma, ['core', 'sg'])

    await setHiddenBuilderPacks(prisma, ['sg'])

    expect(await getHiddenBuilderPackCodes(prisma)).toEqual(['sg'])
  })

  it('clears every hidden pack when given an empty list', async () => {
    await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core' })
    await setHiddenBuilderPacks(prisma, ['core'])

    await setHiddenBuilderPacks(prisma, [])

    expect(await getHiddenBuilderPackCodes(prisma)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/actions/settingsMutations.test.ts`
Expected: FAIL — `settingsMutations.ts` does not exist yet.

- [ ] **Step 3: Write the mutations**

Create `src/actions/settingsMutations.ts`:

```ts
import type { PrismaClient } from '@prisma/client'

export async function getHiddenBuilderPackCodes(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.hiddenBuilderPack.findMany({ select: { packCode: true } })
  return rows.map((row) => row.packCode)
}

export async function setHiddenBuilderPacks(prisma: PrismaClient, packCodes: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.hiddenBuilderPack.deleteMany(),
    prisma.hiddenBuilderPack.createMany({ data: packCodes.map((packCode) => ({ packCode })) }),
  ])
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/actions/settingsMutations.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the server-action wrapper**

Create `src/actions/settingsActions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { setHiddenBuilderPacks } from './settingsMutations'

export async function updateHiddenBuilderPacks(packCodes: string[]): Promise<void> {
  await setHiddenBuilderPacks(prisma, packCodes)
  revalidatePath('/settings')
}
```

- [ ] **Step 6: Write the failing test for `searchCards`'s hidden-pack exclusion**

In `src/lib/cards.test.ts`, add these two tests inside the existing `describe('searchCards', ...)` block (after its last existing test, before the closing `})`):

```ts
  it('excludes cards from a hidden pack in the general search', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await seedCard(prisma, { code: '02007', title: 'Corroder Alt', packCode: 'sg' })
    await prisma.hiddenBuilderPack.create({ data: { packCode: 'core' } })

    const results = await searchCards(prisma, { query: 'Corroder' })

    expect(results.map((r) => r.code)).toEqual(['02007'])
  })

  it('is unaffected when no packs are hidden', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

    const results = await searchCards(prisma, { query: 'Corroder' })

    expect(results.map((r) => r.code)).toEqual(['01007'])
  })
```

- [ ] **Step 7: Run the test file to verify the new tests fail**

Run: `npx vitest run src/lib/cards.test.ts`
Expected: the two new tests FAIL (hidden packs aren't excluded yet); all pre-existing tests in this file still PASS.

- [ ] **Step 8: Implement the exclusion in `searchCards`**

In `src/lib/cards.ts`, replace the `searchCards` function with:

```ts
export async function searchCards(
  prisma: PrismaClient,
  filters: CardSearchFilters
): Promise<CardSearchResult[]> {
  const hiddenPacks = await prisma.hiddenBuilderPack.findMany({ select: { packCode: true } })
  const hiddenPackCodes = hiddenPacks.map((row) => row.packCode)

  const cards = await prisma.card.findMany({
    where: {
      title: { contains: filters.query },
      ...(filters.factionCode ? { factionCode: filters.factionCode } : {}),
      ...(filters.typeCode ? { typeCode: filters.typeCode } : {}),
      // An explicit pack filter is a deliberate, scoped search (like
      // visiting that set's own page) and isn't subject to hiding —
      // hiding only applies to the general/unscoped search hidden sets
      // are meant to disappear from.
      ...(filters.packCode
        ? { packCode: filters.packCode }
        : hiddenPackCodes.length > 0
          ? { packCode: { notIn: hiddenPackCodes } }
          : {}),
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

- [ ] **Step 9: Run the test file to verify everything passes**

Run: `npx vitest run src/lib/cards.test.ts`
Expected: PASS — all pre-existing tests plus the two new ones.

- [ ] **Step 10: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 11: Commit**

```bash
git add src/actions/settingsMutations.ts src/actions/settingsMutations.test.ts src/actions/settingsActions.ts src/lib/cards.ts src/lib/cards.test.ts
git commit -m "Add hidden-builder-pack mutations and exclude them from searchCards"
```

---

### Task 6: `/settings` page

**Files:**
- Create: `src/app/settings/page.tsx`
- Create: `src/app/settings/SettingsForm.tsx`
- Create: `src/app/settings/SettingsForm.test.tsx`

**Interfaces:**
- Consumes: `ThemeToggle` (Task 4), `updateHiddenBuilderPacks` (Task 5's `settingsActions.ts`), `prisma` (`@/lib/db`).
- Produces: nothing consumed by later tasks — this is a leaf page.

- [ ] **Step 1: Write the failing tests for `SettingsForm`**

Create `src/app/settings/SettingsForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsForm } from './SettingsForm'
import { updateHiddenBuilderPacks } from '@/actions/settingsActions'

vi.mock('@/actions/settingsActions', () => ({
  updateHiddenBuilderPacks: vi.fn(),
}))

const packs = [
  { code: 'core', name: 'Core Set' },
  { code: 'sg', name: 'System Gateway' },
]

describe('SettingsForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    document.documentElement.classList.remove('dark')
  })

  it('renders the theme toggle', () => {
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
  })

  it('pre-checks currently-hidden sets', () => {
    render(<SettingsForm packs={packs} initialHiddenPackCodes={['sg']} />)

    expect(screen.getByRole('checkbox', { name: 'Core Set' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'System Gateway' })).toBeChecked()
  })

  it('filters the set list by name', async () => {
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    await user.type(screen.getByRole('textbox', { name: 'Filter sets by name' }), 'core')

    expect(screen.getByRole('checkbox', { name: 'Core Set' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'System Gateway' })).not.toBeInTheDocument()
  })

  it('saving calls updateHiddenBuilderPacks with the currently-checked pack codes', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    await user.click(screen.getByRole('checkbox', { name: 'System Gateway' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateHiddenBuilderPacks).toHaveBeenCalledWith(['sg'])
  })

  it('unchecking a previously-hidden set removes it from what gets saved', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={['core', 'sg']} />)

    await user.click(screen.getByRole('checkbox', { name: 'Core Set' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateHiddenBuilderPacks).toHaveBeenCalledWith(['sg'])
  })

  it('shows a status message after a successful save', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('shows an error message when saving fails', async () => {
    vi.mocked(updateHiddenBuilderPacks).mockRejectedValue(new Error('db exploded'))
    const user = userEvent.setup()
    render(<SettingsForm packs={packs} initialHiddenPackCodes={[]} />)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/failed to save/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/app/settings/SettingsForm.test.tsx`
Expected: FAIL — `SettingsForm.tsx` does not exist yet.

- [ ] **Step 3: Write `SettingsForm`**

Create `src/app/settings/SettingsForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { updateHiddenBuilderPacks } from '@/actions/settingsActions'
import { ThemeToggle } from '@/components/ThemeToggle'

interface PackOption {
  code: string
  name: string
}

export function SettingsForm({
  packs,
  initialHiddenPackCodes,
}: {
  packs: PackOption[]
  initialHiddenPackCodes: string[]
}) {
  const [hiddenCodes, setHiddenCodes] = useState<Set<string>>(new Set(initialHiddenPackCodes))
  const [nameQuery, setNameQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

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
            className="cursor-pointer rounded border border-blue-600 bg-blue-600/20 px-4 py-1.5 text-sm text-blue-400 hover:bg-blue-600/30 disabled:cursor-not-allowed disabled:opacity-50"
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/app/settings/SettingsForm.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the page**

Create `src/app/settings/page.tsx`:

```tsx
import { prisma } from '@/lib/db'
import { getHiddenBuilderPackCodes } from '@/actions/settingsMutations'
import { SettingsForm } from './SettingsForm'

// Reflects live DB state (every pack, and which ones are currently
// hidden) — not something to freeze into a build-time snapshot. See the
// dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const [packs, hiddenPackCodes] = await Promise.all([
    prisma.pack.findMany({ orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }] }),
    getHiddenBuilderPackCodes(prisma),
  ])

  return (
    <main className="p-8 max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsForm
        packs={packs.map((pack) => ({ code: pack.code, name: pack.name }))}
        initialHiddenPackCodes={hiddenPackCodes}
      />
    </main>
  )
}
```

- [ ] **Step 6: Run the full test suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/settings/page.tsx src/app/settings/SettingsForm.tsx src/app/settings/SettingsForm.test.tsx
git commit -m "Add /settings page with Theme and Hide Sets from Builder sections"
```

---

### Task 7: Migrate every remaining hardcoded color to semantic tokens

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/SetProgressList.tsx`
- Modify: `src/app/builder/CardBuilderForm.tsx`
- Modify: `src/app/reports/sets-missing-image/page.tsx`
- Modify: `src/app/sets/[packCode]/page.tsx`
- Modify: `src/app/sets/[packCode]/SetCardGrid.tsx`
- Modify: `src/app/sets/[packCode]/SetCardFilterSidebar.tsx`
- Modify: `src/components/CardDetailPopup.tsx`
- Modify: `src/components/CardThumbnail.tsx`
- Modify: `src/components/SetCoverImage.tsx`
- Modify: `src/components/SetThumbnail.tsx`
- Modify: `src/components/ReportsNavDropdown.tsx`

**Interfaces:**
- Consumes: the tokens from Task 2 (`bg-app`, `bg-surface`, `bg-surface-hover`, `border-default`, `border-subtle`, `text-primary`, `text-muted`, `text-faint`).
- Produces: nothing new — pure class-name substitution, no behavioral/DOM-structure/prop changes to any of these 12 files. `layout.tsx` (already migrated in Task 2) is not part of this task.

This task is a mechanical, uniform substitution across every file below. No test file needs any change — every existing test in this codebase asserts behavior, text content, or structure, never raw Tailwind class strings, for these 12 files.

- [ ] **Step 1: `src/app/page.tsx`**

Replace the full contents with:

```tsx
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { computeAllSetsCompletion, computeCollectionTotals, listUnsizedPacks } from '@/lib/reports'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SetProgressList } from './SetProgressList'

// This page's entire content is "how much of my current collection do I
// own right now" — it must reflect live database state on every request,
// not a build-time snapshot. See finding 4 of the 2026-08-04 whole-branch
// review.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [sets, totals, unsizedPacks] = await Promise.all([
    computeAllSetsCompletion(prisma),
    computeCollectionTotals(prisma),
    listUnsizedPacks(prisma),
  ])

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Collection Overview</h1>
        <p className="text-muted">
          {totals.ownedCards} / {totals.totalCards} cards owned ({totals.percentOwned}%)
        </p>
      </div>

      <SetProgressList sets={sets} />

      {unsizedPacks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Sets without a declared size</h2>
          <p className="text-sm text-muted mb-2">
            These packs don&apos;t have a known card count, so there&apos;s no completion percentage to show — but
            their cards are imported and browsable.
          </p>
          <ul className="space-y-1">
            {unsizedPacks.map((pack) => (
              <li key={pack.packCode} className="flex items-center gap-2">
                <SetTypeBadge setType={pack.setType} />
                <Link href={`/sets/${pack.packCode}`} className="text-blue-400 hover:underline">
                  {pack.packName}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 2: `src/app/SetProgressList.tsx`**

Replace the full contents with:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { groupSetsByCycle, releaseYear, type SetCompletion } from '@/lib/reports'
import { SetThumbnail } from '@/components/SetThumbnail'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SET_TYPES } from '@/lib/setTypes'

export function SetProgressList({ sets }: { sets: SetCompletion[] }) {
  const [filter, setFilter] = useState<'all' | 'owned' | 'missing'>('all')
  const [typeFilter, setTypeFilter] = useState<string | 'all'>('all')
  const [nameQuery, setNameQuery] = useState('')

  // Only offer a button for a type that's actually present in this data,
  // in the same order SET_TYPES declares them (not the order sets happen
  // to appear in).
  const presentTypes = Object.keys(SET_TYPES).filter((type) => sets.some((set) => set.setType === type))

  const trimmedQuery = nameQuery.trim().toLowerCase()

  const visibleSets = sets.filter((set) => {
    if (filter === 'owned' && set.ownedCount === 0) return false
    if (filter === 'missing' && set.ownedCount > 0) return false
    if (typeFilter !== 'all' && set.setType !== typeFilter) return false
    if (trimmedQuery !== '' && !set.packName.toLowerCase().includes(trimmedQuery)) return false
    return true
  })

  const setsByCycle = groupSetsByCycle(visibleSets)
  const cycles = [...setsByCycle.entries()]

  return (
    <div className="flex gap-8">
      <nav aria-label="Jump to cycle" className="hidden w-56 shrink-0 self-start sm:block sm:sticky sm:top-8">
        <ul className="space-y-1">
          {cycles.map(([cycleCode, cycleSets]) => (
            <li key={cycleCode}>
              <a
                href={`#cycle-${cycleCode}`}
                className="block rounded px-2 py-1 text-sm text-muted hover:bg-surface-hover hover:text-primary"
              >
                {cycleSets[0].cycleName} ({cycleSets.length})
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="Filter sets by name"
            placeholder="Filter sets by name…"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            className="w-full max-w-xs rounded border border-default bg-surface px-3 py-1 text-sm placeholder:text-faint"
          />
          {nameQuery !== '' && (
            <button
              type="button"
              onClick={() => setNameQuery('')}
              className="cursor-pointer rounded border border-default px-3 py-1 text-sm hover:bg-surface-hover"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'owned', 'missing'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setFilter(option)}
              className={`cursor-pointer rounded border px-3 py-1 text-sm ${
                filter === option
                  ? 'border-blue-600 bg-blue-600/20 text-blue-400'
                  : 'border-default hover:bg-surface-hover'
              }`}
            >
              {option === 'all' ? 'All' : option === 'owned' ? 'Owned' : 'Missing'}
            </button>
          ))}

          <span className="mx-1 h-5 w-px bg-subtle" aria-hidden="true" />

          <label className="flex items-center gap-1.5 text-sm">
            {typeFilter !== 'all' && <SetTypeBadge setType={typeFilter} />}
            <span className="sr-only">Filter by set type</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="cursor-pointer rounded border border-default bg-surface px-3 py-1 text-sm hover:bg-surface-hover"
            >
              <option value="all">All types</option>
              {presentTypes.map((type) => (
                <option key={type} value={type}>
                  {SET_TYPES[type].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {cycles.map(([cycleCode, cycleSets]) => (
          <div key={cycleCode} id={`cycle-${cycleCode}`} className="scroll-mt-8">
            <h2 className="mb-2 text-lg font-semibold">{cycleSets[0].cycleName}</h2>
            <ul className="space-y-2">
              {cycleSets.map((set) => {
                const year = releaseYear(set.dateRelease)
                return (
                  <li key={set.packCode}>
                    <Link
                      href={`/sets/${set.packCode}`}
                      className="flex items-center gap-3 rounded border border-subtle p-3 hover:border-default"
                    >
                      <SetThumbnail packCode={set.packCode} packName={set.packName} />
                      <div className="flex-1">
                        <div className="flex justify-between">
                          <span className="flex items-center gap-2">
                            <SetTypeBadge setType={set.setType} />
                            {set.packName}
                            {year && <span className="text-faint"> ({year})</span>}
                          </span>
                          <span>
                            {set.ownedCount}/{set.totalCount} ({set.percentOwned}%)
                          </span>
                        </div>
                        <div className="mt-2 h-2 rounded bg-subtle">
                          <div className="h-2 rounded bg-blue-600" style={{ width: `${set.percentOwned}%` }} />
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}

        {visibleSets.length === 0 && <p className="text-sm text-faint">No sets match this filter.</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `src/app/builder/CardBuilderForm.tsx`**

Replace the full contents with:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { addToCollection, updateCollectionQuantity } from '@/actions/collectionActions'
import { CardThumbnail } from '@/components/CardThumbnail'
import type { CardSearchResult } from '@/lib/cards'

export function CardBuilderForm() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CardSearchResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  // All per-card state is keyed by card code, not shared, so acting on one
  // card doesn't disable or overwrite the status of any other row.
  const [pendingCodes, setPendingCodes] = useState<Record<string, boolean>>({})
  const [statusByCode, setStatusByCode] = useState<Record<string, string>>({})
  const [errorByCode, setErrorByCode] = useState<Record<string, string>>({})

  async function runSearch(value: string) {
    setQuery(value)
    setSearchError(null)

    if (value.trim().length === 0) {
      setResults([])
      return
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

  async function performUpdate(card: CardSearchResult, action: () => Promise<number>, failureVerb: string) {
    setPendingCodes((prev) => ({ ...prev, [card.code]: true }))
    setErrorByCode((prev) => {
      if (!(card.code in prev)) return prev
      const { [card.code]: _removed, ...rest } = prev
      return rest
    })

    try {
      const newQuantity = await action()
      setStatusByCode((prev) => ({ ...prev, [card.code]: `now own ${newQuantity}` }))
      setResults((prev) =>
        prev.map((c) => (c.code === card.code ? { ...c, ownedQuantity: newQuantity } : c))
      )
    } catch {
      setErrorByCode((prev) => ({ ...prev, [card.code]: `Failed to ${failureVerb} ${card.title} — try again` }))
    } finally {
      setPendingCodes((prev) => ({ ...prev, [card.code]: false }))
    }
  }

  function handleAdd(card: CardSearchResult, amount: number) {
    return performUpdate(card, () => addToCollection(card.code, amount), 'add')
  }

  // Zeroing out is a correction, not "adding zero copies" — it overwrites
  // the owned count via updateCollectionQuantity, the same action the set
  // browser's editor uses, rather than the incrementing addToCollection.
  function handleZero(card: CardSearchResult) {
    return performUpdate(card, () => updateCollectionQuantity(card.code, 0), 'reset')
  }

  return (
    <div className="space-y-6">
      <input
        type="text"
        value={query}
        onChange={(event) => runSearch(event.target.value)}
        placeholder="Search for a card by title..."
        className="w-full rounded border border-default bg-surface px-4 py-2"
      />

      {searchError && (
        <p className="text-red-400" role="alert">
          {searchError}
        </p>
      )}

      <ul className="divide-y divide-subtle">
        {results.map((card) => {
          const isPending = pendingCodes[card.code] === true
          const status = statusByCode[card.code]
          const error = errorByCode[card.code]
          return (
            <li key={card.code} className="flex items-center gap-4 p-3">
              <CardThumbnail code={card.code} title={card.title} />
              <div className="flex-1">
                <div className="font-medium">{card.title}</div>
                <div className="text-sm text-muted">
                  {card.factionCode} ·{' '}
                  <Link href={`/sets/${card.packCode}`} className="underline hover:text-primary">
                    {card.packName}
                  </Link>{' '}
                  · owned: {card.ownedQuantity}
                </div>
                {status && <div className="text-xs text-green-400">{card.title}: {status}</div>}
                {error && (
                  <div className="text-xs text-red-400" role="alert">
                    {error}
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleZero(card)}
                  disabled={isPending}
                  aria-label={`Reset ${card.title} to 0`}
                  className="h-8 w-8 cursor-pointer rounded border border-red-800 bg-red-950/40 font-medium text-red-400 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  0
                </button>
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
  )
}
```

- [ ] **Step 4: `src/app/reports/sets-missing-image/page.tsx`**

Replace the full contents with:

```tsx
import { prisma } from '@/lib/db'
import { listPacksMissingImage, releaseYear } from '@/lib/reports'

// Depends on live DB state (which packs exist) and reflects source-file
// changes to setImages.ts — not something to freeze into a build-time
// snapshot. See the dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function SetsMissingImageReportPage() {
  const packs = await listPacksMissingImage(prisma)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Sets Missing Image</h1>
        <p className="text-muted">
          {packs.length === 0
            ? 'Every set has a cover image.'
            : `${packs.length} set${packs.length === 1 ? '' : 's'} with no cover image yet — names below are selectable to copy/paste into a search.`}
        </p>
      </div>

      {packs.length > 0 && (
        <ul className="space-y-1 font-mono text-sm">
          {packs.map((pack) => {
            const year = releaseYear(pack.dateRelease)
            return (
              <li
                key={pack.packCode}
                className="flex items-center justify-between gap-4 rounded border border-subtle px-3 py-2"
              >
                <span>
                  {pack.packName}
                  {year && <span className="text-faint"> ({year})</span>}
                </span>
                <span className="shrink-0 text-faint">{pack.cycleName}</span>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
```

- [ ] **Step 5: `src/app/sets/[packCode]/page.tsx`**

Replace the full contents with:

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { listCardsInPack } from '@/lib/cards'
import { computeSetCompletion, releaseYear } from '@/lib/reports'
import { SetCoverImage } from '@/components/SetCoverImage'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SetCardGrid } from './SetCardGrid'

export default async function SetPage({ params }: { params: Promise<{ packCode: string }> }) {
  const { packCode } = await params

  const pack = await prisma.pack.findUnique({ where: { code: packCode }, include: { cycle: true } })
  if (!pack) {
    notFound()
  }

  const [cards, completion] = await Promise.all([
    listCardsInPack(prisma, packCode),
    computeSetCompletion(prisma, packCode),
  ])

  const year = releaseYear(pack.dateRelease)

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <SetCoverImage packCode={pack.code} packName={pack.name} />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <SetTypeBadge setType={pack.setType} />
            <span>
              <Link href={`/#cycle-${pack.cycleCode}`} className="text-muted hover:text-primary hover:underline">
                {pack.cycle.name}
              </Link>
              <span className="text-faint"> {'>'} </span>
              {pack.name}
              {year && <span className="text-faint"> ({year})</span>}
            </span>
            <a
              href={`https://netrunnerdb.com/en/set/${pack.code}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${pack.name} on NetrunnerDB`}
              className="text-faint hover:text-primary"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </h1>
          {completion && (
            <p className="text-muted">
              {completion.ownedCount}/{completion.totalCount} owned ({completion.percentOwned}%)
            </p>
          )}
        </div>
      </div>
      <SetCardGrid cards={cards} expectedCount={pack.size} />
    </main>
  )
}
```

- [ ] **Step 6: `src/app/sets/[packCode]/SetCardGrid.tsx`**

Replace the full contents with:

```tsx
'use client'

import { useState } from 'react'
import { updateCollectionQuantity } from '@/actions/collectionActions'
import { CardDetailPopup } from '@/components/CardDetailPopup'
import { SetCardFilterSidebar } from './SetCardFilterSidebar'
import {
  createEmptyAttributeFilters,
  matchesAttributeFilters,
  type AttributeFilters,
  type OwnershipFilter,
} from './attributeFilters'
import type { PackCardEntry } from '@/lib/cards'

function parseQuantity(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return null
  return value
}

const OWNERSHIP_OPTIONS: { value: OwnershipFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Missing' },
]

export function SetCardGrid({
  cards,
  expectedCount = null,
}: {
  cards: PackCardEntry[]
  /** The set's officially declared card count, if known — shown as the total rather than however many happened to import. */
  expectedCount?: number | null
}) {
  // What's currently typed in each input, kept as a string so an in-progress
  // edit (e.g. a cleared field, or "-" while typing "-5") can be displayed
  // without being coerced into a number prematurely.
  const [inputValues, setInputValues] = useState<Record<string, string>>(
    Object.fromEntries(cards.map((card) => [card.code, String(card.ownedQuantity)]))
  )
  // The last value confirmed saved to the database, used both to render
  // "owned" state (dimming) and to roll back a failed/invalid edit.
  const [savedQuantities, setSavedQuantities] = useState<Record<string, number>>(
    Object.fromEntries(cards.map((card) => [card.code, card.ownedQuantity]))
  )
  // Pending/error state is tracked per card code, not as one shared flag,
  // so saving one card's quantity doesn't affect any other card's input.
  const [pendingCodes, setPendingCodes] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ownership, setOwnership] = useState<OwnershipFilter>('all')
  const [attributeFilters, setAttributeFilters] = useState<AttributeFilters>(createEmptyAttributeFilters())

  function handleChange(code: string, value: string) {
    setInputValues((prev) => ({ ...prev, [code]: value }))
  }

  async function commit(code: string) {
    const raw = inputValues[code]
    const parsed = parseQuantity(raw)
    const savedValue = savedQuantities[code]

    if (parsed === null) {
      setErrors((prev) => ({ ...prev, [code]: 'Enter a whole number, 0 or more' }))
      setInputValues((prev) => ({ ...prev, [code]: String(savedValue) }))
      return
    }

    // Normalize the display (e.g. "007" -> "7") even when nothing changed.
    setInputValues((prev) => ({ ...prev, [code]: String(parsed) }))

    if (parsed === savedValue) {
      setErrors((prev) => {
        if (!(code in prev)) return prev
        const { [code]: _removed, ...rest } = prev
        return rest
      })
      return
    }

    setPendingCodes((prev) => ({ ...prev, [code]: true }))
    try {
      const updated = await updateCollectionQuantity(code, parsed)
      setSavedQuantities((prev) => ({ ...prev, [code]: updated }))
      setInputValues((prev) => ({ ...prev, [code]: String(updated) }))
      setErrors((prev) => {
        if (!(code in prev)) return prev
        const { [code]: _removed, ...rest } = prev
        return rest
      })
    } catch {
      setErrors((prev) => ({ ...prev, [code]: 'Failed to save — try again' }))
      setInputValues((prev) => ({ ...prev, [code]: String(savedValue) }))
    } finally {
      setPendingCodes((prev) => ({ ...prev, [code]: false }))
    }
  }

  const visibleCards = cards.filter((card) => {
    const owned = savedQuantities[card.code]
    if (ownership === 'owned' && owned === 0) return false
    if (ownership === 'missing' && owned > 0) return false
    return matchesAttributeFilters(card, attributeFilters)
  })

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <SetCardFilterSidebar
        cards={cards}
        ownership={ownership}
        onOwnershipChange={setOwnership}
        attributeFilters={attributeFilters}
        onAttributeFiltersChange={setAttributeFilters}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {OWNERSHIP_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setOwnership(option.value)}
                className={`cursor-pointer rounded border px-3 py-1 text-sm ${
                  ownership === option.value
                    ? 'border-blue-600 bg-blue-600/20 text-blue-400'
                    : 'border-default hover:bg-surface-hover'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="text-sm text-muted">
            {visibleCards.length} of {expectedCount ?? cards.length} cards
          </span>
        </div>

        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibleCards.map((card) => {
            const owned = savedQuantities[card.code]
            const isSaving = pendingCodes[card.code] === true
            const error = errors[card.code]
            return (
              <li
                key={card.code}
                className={`flex items-center gap-3 rounded border p-3 ${
                  owned > 0 ? 'border-default' : 'border-subtle opacity-50'
                }`}
              >
                <CardDetailPopup card={card} />
                <div className="flex-1">
                  <div className="font-medium">{card.title}</div>
                  <div className="text-sm text-muted">{card.factionName}</div>
                  {error && (
                    <div className="text-xs text-red-400" role="alert">
                      {error}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      aria-label={`${card.title} owned quantity`}
                      value={inputValues[card.code]}
                      onChange={(event) => handleChange(card.code, event.target.value)}
                      onBlur={() => commit(card.code)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.currentTarget.blur()
                        }
                      }}
                      className={`w-16 rounded border bg-surface px-2 py-1 text-center ${
                        card.quantity !== null && owned < card.quantity
                          ? 'border-red-400 bg-red-500/10'
                          : 'border-default'
                      }`}
                    />
                    {card.quantity !== null && <span className="text-xs text-faint">of {card.quantity}</span>}
                  </div>
                  {isSaving && <span className="text-[10px] text-faint">saving…</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: `src/app/sets/[packCode]/SetCardFilterSidebar.tsx`**

Replace the full contents with:

```tsx
'use client'

import type { PackCardEntry } from '@/lib/cards'
import {
  computeCardFacets,
  createEmptyAttributeFilters,
  isAttributeFiltersEmpty,
  type AttributeFilters,
  type OwnershipFilter,
} from './attributeFilters'

interface SetCardFilterSidebarProps {
  cards: PackCardEntry[]
  ownership: OwnershipFilter
  onOwnershipChange: (value: OwnershipFilter) => void
  attributeFilters: AttributeFilters
  onAttributeFiltersChange: (value: AttributeFilters) => void
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

const legendClassName = 'mb-1 text-xs font-semibold uppercase text-faint'
const checkboxLabelClassName = 'flex cursor-pointer items-center gap-2 text-sm'
const zeroCountCheckboxLabelClassName = 'flex cursor-pointer items-center gap-2 text-sm text-faint'

function checkboxLabelClass(count: number): string {
  return count === 0 ? zeroCountCheckboxLabelClassName : checkboxLabelClassName
}

export function SetCardFilterSidebar({
  cards,
  ownership,
  onOwnershipChange,
  attributeFilters,
  onAttributeFiltersChange,
}: SetCardFilterSidebarProps) {
  const facets = computeCardFacets(cards, attributeFilters)
  const showClearAll = ownership !== 'all' || !isAttributeFiltersEmpty(attributeFilters)

  function toggleFaction(code: string) {
    onAttributeFiltersChange({ ...attributeFilters, factionCodes: toggleInSet(attributeFilters.factionCodes, code) })
  }

  function toggleType(code: string) {
    onAttributeFiltersChange({ ...attributeFilters, typeCodes: toggleInSet(attributeFilters.typeCodes, code) })
  }

  function toggleSide(code: string) {
    onAttributeFiltersChange({ ...attributeFilters, sideCodes: toggleInSet(attributeFilters.sideCodes, code) })
  }

  function toggleCost(value: number | null) {
    onAttributeFiltersChange({ ...attributeFilters, costs: toggleInSet(attributeFilters.costs, value) })
  }

  return (
    <aside className="w-full shrink-0 space-y-3 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:w-80 lg:self-start lg:overflow-y-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">Filters</h2>
        <button
          type="button"
          disabled={!showClearAll}
          onClick={() => {
            onOwnershipChange('all')
            onAttributeFiltersChange(createEmptyAttributeFilters())
          }}
          className={`text-xs ${
            showClearAll ? 'cursor-pointer text-blue-400 hover:underline' : 'cursor-not-allowed text-faint'
          }`}
        >
          Clear all
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {facets.sides.length > 1 && (
          <fieldset>
            <legend className={legendClassName}>Side</legend>
            <div className="space-y-1">
              {facets.sides.map((option) => (
                <label key={option.value} className={checkboxLabelClass(option.count)}>
                  <input
                    type="checkbox"
                    checked={attributeFilters.sideCodes.has(option.value)}
                    onChange={() => toggleSide(option.value)}
                  />
                  <span>
                    {option.label} ({option.count})
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {facets.factions.length > 1 && (
          <fieldset>
            <legend className={legendClassName}>Faction</legend>
            <div className="space-y-1">
              {facets.factions.map((option) => (
                <label key={option.value} className={checkboxLabelClass(option.count)}>
                  <input
                    type="checkbox"
                    checked={attributeFilters.factionCodes.has(option.value)}
                    onChange={() => toggleFaction(option.value)}
                  />
                  <span>
                    {option.label} ({option.count})
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {facets.types.length > 1 && (
          <fieldset>
            <legend className={legendClassName}>Type</legend>
            <div className="space-y-1">
              {facets.types.map((option) => (
                <label key={option.value} className={checkboxLabelClass(option.count)}>
                  <input
                    type="checkbox"
                    checked={attributeFilters.typeCodes.has(option.value)}
                    onChange={() => toggleType(option.value)}
                  />
                  <span>
                    {option.label} ({option.count})
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {facets.costs.length > 1 && (
          <fieldset>
            <legend className={legendClassName}>Cost</legend>
            <div className="space-y-1">
              {facets.costs.map((option) => (
                <label key={option.label} className={checkboxLabelClass(option.count)}>
                  <input
                    type="checkbox"
                    checked={attributeFilters.costs.has(option.value)}
                    onChange={() => toggleCost(option.value)}
                  />
                  <span>
                    {option.label} ({option.count})
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 8: `src/components/CardDetailPopup.tsx`**

Replace the full contents with:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { cardImageUrl } from '@/lib/cardImage'
import { CardThumbnail } from './CardThumbnail'
import type { PackCardEntry } from '@/lib/cards'

// Wraps a card's small thumbnail so clicking it opens a popup with the
// larger image plus whatever stats/text/faction info the card has.
export function CardDetailPopup({ card }: { card: PackCardEntry }) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Show details for ${card.title}`}
        className="cursor-pointer"
      >
        <CardThumbnail code={card.code} title={card.title} />
      </button>

      {isOpen &&
        // Portalled to document.body: this card's row may sit inside a
        // dimmed (opacity-50) "missing" list item, and opacity < 1 on an
        // ancestor creates a stacking context that would otherwise trap
        // this fixed-position popup and render it at that same reduced
        // opacity — letting the page show through instead of a solid
        // backdrop. Rendering outside that subtree avoids it entirely.
        createPortal(
          <div
            role="presentation"
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          >
            <div
              onClick={(event) => event.stopPropagation()}
              className="flex max-h-[90vh] w-full max-w-2xl gap-4 overflow-y-auto rounded-lg bg-surface p-4"
            >
              <Image
                src={cardImageUrl(card.code)}
                alt={card.title}
                width={300}
                height={419}
                className="h-auto w-40 shrink-0 rounded sm:w-56"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-bold">
                    {card.uniqueness && <span className="mr-1 text-yellow-400">◆</span>}
                    {card.title}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close"
                    className="shrink-0 cursor-pointer rounded bg-surface-hover px-2 py-1 text-sm hover:bg-default"
                  >
                    ✕
                  </button>
                </div>

                <div className="text-sm text-muted">
                  {card.factionName} · {card.typeName} · {card.sideCode}
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                  {card.cost !== null && <span>Cost: {card.cost}</span>}
                  {card.factionCost !== null && <span>Influence: {card.factionCost}</span>}
                  {card.strength !== null && <span>Strength: {card.strength}</span>}
                  {card.deckLimit !== null && <span>Deck limit: {card.deckLimit}</span>}
                </div>

                {card.keywords && <div className="text-sm italic text-muted">{card.keywords}</div>}

                {card.text && <p className="whitespace-pre-line text-sm text-primary">{card.text}</p>}

                <div className="pt-2 text-sm text-muted">Owned: {card.ownedQuantity}</div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
```

- [ ] **Step 9: `src/components/CardThumbnail.tsx`**

Replace the full contents with:

```tsx
'use client'

import { useState } from 'react'
import Image from 'next/image'
import { cardImageUrl } from '@/lib/cardImage'

// Some cards (mostly from newer sets) don't have an image hosted at
// NetrunnerDB's CDN yet, which returns a 403 rather than a 404 for those.
// Fall back to a placeholder instead of letting a broken image render.
export function CardThumbnail({ code, title }: { code: string; title: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${title} (image unavailable)`}
        className="flex h-[62px] w-[44px] shrink-0 items-center justify-center rounded bg-surface-hover text-center text-[9px] leading-tight text-faint"
      >
        No image
      </div>
    )
  }

  return (
    <Image
      src={cardImageUrl(code)}
      alt={title}
      width={44}
      height={62}
      className="rounded"
      onError={() => setFailed(true)}
    />
  )
}
```

- [ ] **Step 10: `src/components/SetCoverImage.tsx`**

Replace the full contents with (note: the popup's close button sits directly on the fixed dark backdrop, not on a themed surface, so its `bg-neutral-900/80`/`text-white`/`hover:bg-neutral-800` colors are intentionally left unchanged — same reasoning as the backdrop's own `bg-black/80`):

```tsx
'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { setImagePath } from '@/lib/setImages'

// Larger, clickable variant of the set cover image used on a set's own
// page — clicking it opens a full-size popup. See SetThumbnail for the
// smaller, non-interactive version used in list rows.
export function SetCoverImage({ packCode, packName }: { packCode: string; packName: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const src = setImagePath(packCode)

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  if (!src) {
    return (
      <div
        role="img"
        aria-label={`${packName} (no cover image)`}
        className="flex h-24 w-24 shrink-0 items-center justify-center rounded bg-surface-hover text-2xl font-semibold text-faint"
      >
        {packName.charAt(0)}
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Show a larger image of ${packName}'s cover art`}
        className="cursor-pointer rounded"
      >
        <Image src={src} alt={packName} width={96} height={96} className="h-24 w-24 rounded object-cover" />
      </button>

      {isOpen &&
        // Portalled to document.body so this popup can never get trapped
        // inside a lower-opacity/transformed ancestor's stacking context
        // (see CardDetailPopup for the concrete bug that pattern causes).
        createPortal(
          <div
            role="presentation"
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          >
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
              className="absolute right-4 top-4 cursor-pointer rounded bg-neutral-900/80 px-3 py-1 text-white hover:bg-neutral-800"
            >
              ✕
            </button>
            <Image
              src={src}
              alt={packName}
              width={800}
              height={800}
              onClick={(event) => event.stopPropagation()}
              className="max-h-[85vh] w-auto max-w-[90vw] rounded object-contain"
            />
          </div>,
          document.body
        )}
    </>
  )
}
```

- [ ] **Step 11: `src/components/SetThumbnail.tsx`**

Replace the full contents with:

```tsx
import Image from 'next/image'
import { setImagePath } from '@/lib/setImages'

// Not all sets have a downloaded cover image (see src/lib/setImages.ts) —
// falls back to a plain initial badge rather than an empty gap.
export function SetThumbnail({ packCode, packName }: { packCode: string; packName: string }) {
  const src = setImagePath(packCode)

  if (!src) {
    return (
      <div
        role="img"
        aria-label={`${packName} (no cover image)`}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-surface-hover text-sm font-semibold text-faint"
      >
        {packName.charAt(0)}
      </div>
    )
  }

  return (
    <Image
      src={src}
      alt={packName}
      width={48}
      height={48}
      className="h-12 w-12 shrink-0 rounded object-cover"
    />
  )
}
```

- [ ] **Step 12: `src/components/ReportsNavDropdown.tsx`**

Replace the full contents with:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const REPORTS = [{ href: '/reports/sets-missing-image', label: 'Sets Missing Image' }]

export function ReportsNavDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="cursor-pointer"
      >
        Reports ▾
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-10 mt-2 min-w-48 rounded border border-default bg-surface py-1 shadow-lg"
        >
          {REPORTS.map((report) => (
            <Link
              key={report.href}
              href={report.href}
              role="menuitem"
              onClick={() => setIsOpen(false)}
              className="block px-3 py-2 text-sm hover:bg-surface-hover"
            >
              {report.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 13: Run the full test suite**

Run: `npm test`
Expected: PASS — every existing test in every one of these 12 files' test suites still passes unmodified (behavior, text, and structure are unchanged; only class names changed).

- [ ] **Step 14: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 15: Commit**

```bash
git add src/app/page.tsx src/app/SetProgressList.tsx src/app/builder/CardBuilderForm.tsx src/app/reports/sets-missing-image/page.tsx "src/app/sets/[packCode]/page.tsx" "src/app/sets/[packCode]/SetCardGrid.tsx" "src/app/sets/[packCode]/SetCardFilterSidebar.tsx" src/components/CardDetailPopup.tsx src/components/CardThumbnail.tsx src/components/SetCoverImage.tsx src/components/SetThumbnail.tsx src/components/ReportsNavDropdown.tsx
git commit -m "Migrate remaining hardcoded dark colors to semantic theme tokens"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check in the browser**

Run `npm run dev`, then:
- Confirm the cog icon appears top-right of the nav bar; clicking it opens a dropdown with a "Configuration" link; clicking that link navigates to `/settings`.
- On `/settings`, confirm the Theme section shows Light/Dark buttons (Dark selected by default on first visit), and clicking Light immediately re-skins the whole page (background, borders, text) without a reload; reloading the page keeps the chosen theme (no flash of the other theme on load).
- Confirm the Hide Sets from Builder list shows every set, the name filter narrows it, and checking a few sets + clicking Save persists (reloading `/settings` still shows them checked).
- Go to `/builder`, search for a card that belongs to a set you just hid — confirm it no longer appears in results; search for a card in a non-hidden set — confirm it still appears.
- Spot-check the dashboard, a set's page, and the builder in both Light and Dark to confirm nothing reads as unstyled/invisible (e.g. light text on a light background) in either theme.

- [ ] **Step 4: Commit (only if manual checks required a fix)**

If Step 3 surfaced no issues, there is nothing to commit for this task — Task 7's commit already covers the working feature.
