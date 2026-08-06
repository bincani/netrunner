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
