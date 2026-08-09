import Link from 'next/link'
import { prisma } from '@/lib/db'
import { computeAllSetsCompletion, computeCollectionTotals, listUnsizedPacks } from '@/lib/reports'
import { getDefaultCollectionId } from '@/lib/collections'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SetProgressList } from './SetProgressList'

// This page's entire content is "how much of my current collection do I
// own right now" — it must reflect live database state on every request,
// not a build-time snapshot. See finding 4 of the 2026-08-04 whole-branch
// review.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const [sets, totals, unsizedPacks] = await Promise.all([
    computeAllSetsCompletion(prisma, collectionId),
    computeCollectionTotals(prisma, collectionId),
    listUnsizedPacks(prisma),
  ])

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">Collection Overview</h1>
          <a
            href="/api/collection/export"
            className="shrink-0 cursor-pointer rounded border border-default px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Export CSV
          </a>
        </div>
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
                <Link href={`/sets/${pack.packCode}`} className="text-accent hover:underline">
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
