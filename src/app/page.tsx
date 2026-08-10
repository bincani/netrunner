import Link from 'next/link'
import { prisma } from '@/lib/db'
import { computeAllSetsCompletion, computeCollectionTotals, listUnsizedPacks } from '@/lib/reports'
import { getDefaultCollection, listCollections } from '@/lib/collections'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SetProgressList } from './SetProgressList'
import { CollectionSwitcher } from './CollectionSwitcher'

// This page's entire content is "how much of my current collection do I
// own right now" — it must reflect live database state on every request,
// not a build-time snapshot. See finding 4 of the 2026-08-04 whole-branch
// review.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const collection = await getDefaultCollection(prisma)
  const [sets, totals, unsizedPacks, collections] = await Promise.all([
    computeAllSetsCompletion(prisma, collection.id),
    computeCollectionTotals(prisma, collection.id),
    listUnsizedPacks(prisma),
    listCollections(prisma),
  ])

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <CollectionSwitcher current={collection} collections={collections} />
            <h1 className="text-2xl font-bold">Collection: {collection.name}</h1>
          </div>
          <a href="/api/collection/export" className="shrink-0 cursor-pointer text-sm text-accent hover:underline">
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
