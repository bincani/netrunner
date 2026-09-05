import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { computeAllSetsCompletion, computeCollectionTotals, listUnsizedPacks } from '@/lib/reports'
import { getCollection, listCollections } from '@/lib/collections'
import { requireCurrentUser } from '@/lib/currentUser'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SetProgressList } from '@/app/SetProgressList'
import { SetDefaultButton } from './SetDefaultButton'
import { CollectionViewSwitcher } from './CollectionViewSwitcher'

// Same rationale as the Dashboard: this page's entire content is "how much
// of this collection do I own right now" and must reflect live database
// state on every request, not a build-time snapshot.
export const dynamic = 'force-dynamic'

export default async function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsedId = Number(id)
  if (!Number.isInteger(parsedId)) {
    notFound()
  }

  const { id: userId } = await requireCurrentUser()
  const collection = await getCollection(prisma, userId, parsedId)
  if (!collection) {
    notFound()
  }

  const [sets, totals, unsizedPacks, collections] = await Promise.all([
    computeAllSetsCompletion(prisma, collection.id),
    computeCollectionTotals(prisma, collection.id),
    listUnsizedPacks(prisma),
    listCollections(prisma, userId),
  ])

  return (
    <main className="w-3/5 space-y-8 p-8">
      <div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <CollectionViewSwitcher current={collection} collections={collections} />
            <h1 className="text-2xl font-bold">Collection: {collection.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <SetDefaultButton collectionId={collection.id} isDefault={collection.isDefault} />
            <a
              href={`/api/collection/export?collectionId=${collection.id}`}
              className="cursor-pointer text-sm text-accent hover:underline"
            >
              Export CSV
            </a>
          </div>
        </div>
        <p className="text-muted">
          {totals.ownedCards} / {totals.totalCards} cards owned ({totals.percentOwned}%)
        </p>
      </div>

      <SetProgressList sets={sets} collectionId={collection.id} />

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
                <Link
                  href={`/sets/${pack.packCode}?collectionId=${collection.id}`}
                  className="text-accent hover:underline"
                >
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
