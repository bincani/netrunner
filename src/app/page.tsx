import Link from 'next/link'
import { prisma } from '@/lib/db'
import { computeAllSetsCompletion, computeCollectionTotals, listUnsizedPacks } from '@/lib/reports'
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
    <main className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Collection Overview</h1>
        <p className="text-neutral-400">
          {totals.ownedCards} / {totals.totalCards} cards owned ({totals.percentOwned}%)
        </p>
      </div>

      <SetProgressList sets={sets} />

      {unsizedPacks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Sets without a declared size</h2>
          <p className="text-sm text-neutral-400 mb-2">
            These packs don&apos;t have a known card count, so there&apos;s no completion percentage to show — but
            their cards are imported and browsable.
          </p>
          <ul className="space-y-1">
            {unsizedPacks.map((pack) => (
              <li key={pack.packCode}>
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
