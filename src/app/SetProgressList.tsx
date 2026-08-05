'use client'

import { useState } from 'react'
import Link from 'next/link'
import { groupSetsByCycle, releaseYear, type SetCompletion } from '@/lib/reports'
import { SetThumbnail } from '@/components/SetThumbnail'

export function SetProgressList({ sets }: { sets: SetCompletion[] }) {
  const [filter, setFilter] = useState<'all' | 'owned' | 'missing'>('all')

  const visibleSets = sets.filter((set) => {
    if (filter === 'owned') return set.ownedCount > 0
    if (filter === 'missing') return set.ownedCount === 0
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
                className="block rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              >
                {cycleSets[0].cycleName} ({cycleSets.length})
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex gap-2">
          {(['all', 'owned', 'missing'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setFilter(option)}
              className={`cursor-pointer rounded border px-3 py-1 text-sm ${
                filter === option
                  ? 'border-blue-600 bg-blue-600/20 text-blue-400'
                  : 'border-neutral-700 hover:bg-neutral-800'
              }`}
            >
              {option === 'all' ? 'All' : option === 'owned' ? 'Owned' : 'Missing'}
            </button>
          ))}
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
                      className="flex items-center gap-3 rounded border border-neutral-800 p-3 hover:border-neutral-600"
                    >
                      <SetThumbnail packCode={set.packCode} packName={set.packName} />
                      <div className="flex-1">
                        <div className="flex justify-between">
                          <span>
                            {set.packName}
                            {year && <span className="text-neutral-500"> ({year})</span>}
                          </span>
                          <span>
                            {set.ownedCount}/{set.totalCount} ({set.percentOwned}%)
                          </span>
                        </div>
                        <div className="mt-2 h-2 rounded bg-neutral-800">
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

        {visibleSets.length === 0 && <p className="text-sm text-neutral-500">No sets match this filter.</p>}
      </div>
    </div>
  )
}
