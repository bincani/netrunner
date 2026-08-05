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
    <main className="p-8 max-w-4xl mx-auto space-y-6">
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
