'use client'

import { useState } from 'react'
import Link from 'next/link'
import { groupSetsByCycle, releaseYear, type SetCompletion } from '@/lib/reports'
import { SetThumbnail } from '@/components/SetThumbnail'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SET_TYPES } from '@/lib/setTypes'
import { OWNERSHIP_FILTER_OPTIONS, matchesOwnershipFilter, type OwnershipFilter } from '@/lib/ownershipFilter'
import { QuickAddSetModal } from '@/components/QuickAddSetModal'
import { undoQuickSetChange } from '@/actions/quickSetActions'
import type { QuickSetChange } from '@/lib/quickSet'

export function SetProgressList({ sets, collectionId }: { sets: SetCompletion[]; collectionId: number }) {
  const [filter, setFilter] = useState<OwnershipFilter>('all')
  const [typeFilter, setTypeFilter] = useState<string | 'all'>('all')
  const [nameQuery, setNameQuery] = useState('')

  const [quickAddPackCode, setQuickAddPackCode] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<{
    collectionId: number
    packCode: string
    verb: 'Added' | 'Cleared'
    changes: QuickSetChange[]
  } | null>(null)
  const [isUndoing, setIsUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)

  // Only offer a button for a type that's actually present in this data,
  // in the same order SET_TYPES declares them (not the order sets happen
  // to appear in).
  const presentTypes = Object.keys(SET_TYPES).filter((type) => sets.some((set) => set.setType === type))

  const trimmedQuery = nameQuery.trim().toLowerCase()

  const visibleSets = sets.filter((set) => {
    if (lastAction?.collectionId === collectionId && lastAction.packCode === set.packCode) return true
    if (!matchesOwnershipFilter(set.ownedCount, set.totalCount, filter)) return false
    if (typeFilter !== 'all' && set.setType !== typeFilter) return false
    if (trimmedQuery !== '' && !set.packName.toLowerCase().includes(trimmedQuery)) return false
    return true
  })

  const setsByCycle = groupSetsByCycle(visibleSets)
  const cycles = [...setsByCycle.entries()]

  const quickAddTarget = sets.find((set) => set.packCode === quickAddPackCode) ?? null

  async function handleUndo() {
    if (!lastAction || lastAction.collectionId !== collectionId) return
    setIsUndoing(true)
    setUndoError(null)
    try {
      const result = await undoQuickSetChange(lastAction.collectionId, lastAction.changes)
      if (result.ok) {
        setLastAction(null)
      } else {
        setUndoError(result.error)
      }
    } finally {
      setIsUndoing(false)
    }
  }

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
          {OWNERSHIP_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setFilter(option.value)}
              className={`cursor-pointer rounded border px-3 py-1 text-sm ${
                filter === option.value
                  ? 'border-accent bg-accent/20 text-accent'
                  : 'border-default hover:bg-surface-hover'
              }`}
            >
              {option.label}
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
                  <li key={set.packCode} className="space-y-1">
                    <div className="flex items-center gap-2 rounded border border-subtle p-3 hover:border-default">
                      <Link href={`/sets/${set.packCode}`} className="flex min-w-0 flex-1 items-center gap-3">
                        <SetThumbnail packCode={set.packCode} packName={set.packName} />
                        <div className="min-w-0 flex-1">
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
                      <button
                        type="button"
                        onClick={() => setQuickAddPackCode(set.packCode)}
                        aria-label={`Quick add ${set.packName}`}
                        className="shrink-0 cursor-pointer rounded p-1.5 text-faint hover:bg-surface-hover hover:text-primary"
                      >
                        ⚡
                      </button>
                    </div>
                    {lastAction?.collectionId === collectionId && lastAction.packCode === set.packCode && (
                      <div className="px-3">
                        <p className="text-sm text-muted">
                          {lastAction.verb} {lastAction.changes.length} card printing
                          {lastAction.changes.length === 1 ? '' : 's'}{' '}
                          <button
                            type="button"
                            onClick={handleUndo}
                            disabled={isUndoing}
                            className="cursor-pointer text-accent underline hover:text-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isUndoing ? 'Undoing…' : 'Undo'}
                          </button>
                        </p>
                        {undoError && (
                          <p className="text-sm text-danger" role="alert">
                            {undoError}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}

        {visibleSets.length === 0 && <p className="text-sm text-faint">No sets match this filter.</p>}
      </div>

      {quickAddTarget && (
        <QuickAddSetModal
          set={quickAddTarget}
          collectionId={collectionId}
          onClose={() => setQuickAddPackCode(null)}
          onDone={(verb, changes) => {
            if (changes.length > 0) {
              setLastAction({ collectionId, packCode: quickAddTarget.packCode, verb, changes })
              setUndoError(null)
            }
            setQuickAddPackCode(null)
          }}
        />
      )}
    </div>
  )
}
