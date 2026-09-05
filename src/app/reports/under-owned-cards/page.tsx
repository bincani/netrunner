import Link from 'next/link'
import { prisma } from '@/lib/db'
import { listCardsUnderExpectedQuantity } from '@/lib/reports'
import { getDefaultCollectionId } from '@/lib/collections'
import { requireCurrentUser } from '@/lib/currentUser'

// Reflects live collection state (owned quantities) — not something to
// freeze into a build-time snapshot. See the dashboard's identical
// rationale.
export const dynamic = 'force-dynamic'

export default async function UnderOwnedCardsReportPage() {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  const sets = await listCardsUnderExpectedQuantity(prisma, collectionId)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Under-Owned Cards</h1>
        <p className="text-muted">
          {sets.length === 0
            ? "No under-owned cards — every set you've started is either complete or untouched."
            : 'Cards you own some copies of, but fewer than a full playset.'}
        </p>
      </div>

      {sets.length > 0 && (
        <div className="space-y-6">
          {sets.map((set) => (
            <div key={set.packCode} className="space-y-2">
              <h2 className="font-semibold">
                <Link href={`/sets/${set.packCode}`} className="underline hover:text-accent">
                  {set.packName}
                </Link>
              </h2>
              <ul className="space-y-1">
                {set.cards.map((card) => (
                  <li key={card.code} className="flex items-center justify-between gap-2 text-danger">
                    <span>
                      {card.title} <span className="text-sm">({card.factionName})</span>
                    </span>
                    <span className="shrink-0 text-sm">
                      {card.quantityOwned} of {card.quantity}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
