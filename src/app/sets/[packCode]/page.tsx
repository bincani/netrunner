import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { listCardsInPack } from '@/lib/cards'
import { computeSetCompletion, releaseYear } from '@/lib/reports'
import { getDefaultCollection, getCollection } from '@/lib/collections'
import { requireCurrentUser } from '@/lib/currentUser'
import { SetCoverImage } from '@/components/SetCoverImage'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SetCardGrid } from './SetCardGrid'

export default async function SetPage({
  params,
  searchParams,
}: {
  params: Promise<{ packCode: string }>
  searchParams: Promise<{ collectionId?: string }>
}) {
  const { packCode } = await params
  const { collectionId: requestedCollectionId } = await searchParams
  const { id: userId } = await requireCurrentUser()

  const pack = await prisma.pack.findUnique({ where: { code: packCode }, include: { cycle: true } })
  if (!pack) {
    notFound()
  }

  let collection
  if (requestedCollectionId) {
    const parsedId = Number(requestedCollectionId)
    if (!Number.isInteger(parsedId)) notFound()
    collection = await getCollection(prisma, userId, parsedId)
    if (!collection) notFound()
  } else {
    collection = await getDefaultCollection(prisma, userId)
  }

  const [cards, completion] = await Promise.all([
    listCardsInPack(prisma, collection.id, packCode),
    computeSetCompletion(prisma, collection.id, packCode),
  ])

  const year = releaseYear(pack.dateRelease)
  const backHref = collection.isDefault
    ? `/#cycle-${pack.cycleCode}`
    : `/collections/${collection.id}#cycle-${pack.cycleCode}`

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <SetCoverImage packCode={pack.code} packName={pack.name} />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <SetTypeBadge setType={pack.setType} />
            <span>
              <Link href={backHref} className="text-muted hover:text-primary hover:underline">
                {pack.cycle.name}
              </Link>
              <span className="text-faint"> {'>'} </span>
              {pack.name}
              {year && <span className="text-faint"> ({year})</span>}
            </span>
            <a
              href={`https://netrunnerdb.com/en/set/${pack.code}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${pack.name} on NetrunnerDB`}
              className="text-faint hover:text-primary"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </h1>
          {completion && (
            <p className="text-muted">
              {completion.ownedCount}/{completion.totalCount} owned ({completion.percentOwned}%)
            </p>
          )}
          {!collection.isDefault && <p className="text-sm text-accent">Viewing: {collection.name}</p>}
        </div>
      </div>
      <SetCardGrid cards={cards} expectedCount={pack.size} collectionId={collection.id} />
    </main>
  )
}
