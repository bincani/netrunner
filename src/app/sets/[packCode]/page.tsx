import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { listCardsInPack } from '@/lib/cards'
import { computeSetCompletion, releaseYear } from '@/lib/reports'
import { SetCoverImage } from '@/components/SetCoverImage'
import { SetTypeBadge } from '@/components/SetTypeBadge'
import { SetCardGrid } from './SetCardGrid'

export default async function SetPage({ params }: { params: Promise<{ packCode: string }> }) {
  const { packCode } = await params

  const pack = await prisma.pack.findUnique({ where: { code: packCode }, include: { cycle: true } })
  if (!pack) {
    notFound()
  }

  const [cards, completion] = await Promise.all([
    listCardsInPack(prisma, packCode),
    computeSetCompletion(prisma, packCode),
  ])

  const year = releaseYear(pack.dateRelease)

  return (
    <main className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <SetCoverImage packCode={pack.code} packName={pack.name} />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <SetTypeBadge setType={pack.setType} />
            <span>
              <Link href={`/#cycle-${pack.cycleCode}`} className="text-neutral-400 hover:text-neutral-200 hover:underline">
                {pack.cycle.name}
              </Link>
              <span className="text-neutral-600"> {'>'} </span>
              {pack.name}
              {year && <span className="text-neutral-500"> ({year})</span>}
            </span>
            <a
              href={`https://netrunnerdb.com/en/set/${pack.code}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${pack.name} on NetrunnerDB`}
              className="text-neutral-500 hover:text-neutral-300"
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
            <p className="text-neutral-400">
              {completion.ownedCount}/{completion.totalCount} owned ({completion.percentOwned}%)
            </p>
          )}
        </div>
      </div>
      <SetCardGrid cards={cards} />
    </main>
  )
}
