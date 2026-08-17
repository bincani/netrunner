import { prisma } from '@/lib/db'
import { getDiscoverDecks, type DiscoverFilters } from '@/lib/discover'
import { getDefaultCollectionId } from '@/lib/collections'
import { DiscoverSection } from './DiscoverSection'

// Reflects live DB state (owned quantities, synced deck pool) — not
// something to freeze into a build-time snapshot. See the dashboard's
// identical rationale.
export const dynamic = 'force-dynamic'

const DEFAULT_FILTERS: DiscoverFilters = { sort: 'percentOwned', limit: 25, offset: 0 }

export default async function DiscoverPage() {
  const collectionId = await getDefaultCollectionId(prisma)
  const [{ decks, total }, savedDecks, factions] = await Promise.all([
    getDiscoverDecks(prisma, collectionId, DEFAULT_FILTERS),
    prisma.deck.findMany({ select: { id: true } }),
    prisma.faction.findMany({ orderBy: { name: 'asc' } }),
  ])

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Discover</h1>
      <DiscoverSection
        initialDecks={decks}
        initialTotal={total}
        savedDeckIds={savedDecks.map((deck) => deck.id)}
        factionOptions={factions.map((faction) => ({ code: faction.code, name: faction.name, sideCode: faction.sideCode }))}
      />
    </main>
  )
}
