import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { listCardsInPack } from '@/lib/cards'
import { computeSetCompletion } from '@/lib/reports'
import { SetCardGrid } from './SetCardGrid'

export default async function SetPage({ params }: { params: Promise<{ packCode: string }> }) {
  const { packCode } = await params

  const pack = await prisma.pack.findUnique({ where: { code: packCode } })
  if (!pack) {
    notFound()
  }

  const [cards, completion] = await Promise.all([
    listCardsInPack(prisma, packCode),
    computeSetCompletion(prisma, packCode),
  ])

  return (
    <main className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{pack.name}</h1>
        {completion && (
          <p className="text-neutral-400">
            {completion.ownedCount}/{completion.totalCount} owned ({completion.percentOwned}%)
          </p>
        )}
      </div>
      <SetCardGrid cards={cards} />
    </main>
  )
}
