import Link from 'next/link'
import { prisma } from '@/lib/db'
import { computeAllSetsCompletion, computeCollectionTotals, groupSetsByCycle } from '@/lib/reports'

export default async function DashboardPage() {
  const [sets, totals] = await Promise.all([
    computeAllSetsCompletion(prisma),
    computeCollectionTotals(prisma),
  ])

  const setsByCycle = groupSetsByCycle(sets)

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
