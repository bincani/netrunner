'use client'

import { useState } from 'react'
import Link from 'next/link'
import { groupSetsByCycle, type SetCompletion } from '@/lib/reports'

export function SetProgressList({ sets }: { sets: SetCompletion[] }) {
  const [filter, setFilter] = useState<'all' | 'owned' | 'missing'>('all')

  const visibleSets = sets.filter((set) => {
    if (filter === 'owned') return set.ownedCount > 0
    if (filter === 'missing') return set.ownedCount === 0
    return true
  })

  const setsByCycle = groupSetsByCycle(visibleSets)

  return (
    <div className="space-y-6">
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

      {[...setsByCycle.entries()].map(([cycleCode, cycleSets]) => (
        <div key={cycleCode}>
          <h2 className="mb-2 text-lg font-semibold capitalize">{cycleCode.replace(/-/g, ' ')}</h2>
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

      {visibleSets.length === 0 && <p className="text-sm text-neutral-500">No sets match this filter.</p>}
    </div>
  )
}
