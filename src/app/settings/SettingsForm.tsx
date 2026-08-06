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
