import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getDeckWithOwnership, getDecksWithOwnership } from '@/lib/decks'
import { getDefaultCollectionId } from '@/lib/collections'
import { DeckCompletionBar } from '@/components/DeckCompletionBar'
import { DeckCardListByType } from '@/components/DeckCardListByType'
import { DeckPacksUsed } from '@/components/DeckPacksUsed'
import { FormatLegalityBadges } from '@/components/FormatLegalityBadges'
import { DeckViewSwitcher } from './DeckViewSwitcher'
import { DeleteDeckButton } from './DeleteDeckButton'

// Same rationale as the Collection detail page: this page's entire content
// is "what does this deck look like and how much of it do I own right now"
// and must reflect live database state on every request.
export const dynamic = 'force-dynamic'

export default async function DeckDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsedId = Number(id)
  if (!Number.isInteger(parsedId)) {
    notFound()
  }

  const collectionId = await getDefaultCollectionId(prisma)
  const [deck, decks] = await Promise.all([
    getDeckWithOwnership(prisma, collectionId, parsedId),
    getDecksWithOwnership(prisma, collectionId),
  ])
  if (!deck) {
    notFound()
  }

  const { identity } = deck
  const influenceLimit = identity?.influenceLimit ?? null
  const influenceAvailable = influenceLimit === null ? null : influenceLimit - deck.influenceSpent
  const minimumDeckSize = identity?.minimumDeckSize ?? null
  // packsUsed is already sorted ascending by release date (nulls last), so
  // the last dated entry is the most recently released pack referenced.
  const datedPacksUsed = deck.packsUsed.filter((pack) => pack.dateRelease !== null)
  const latestPack = datedPacksUsed.length > 0 ? datedPacksUsed[datedPacksUsed.length - 1] : null

  return (
    <main className="w-3/5 space-y-8 p-8">
      <div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <DeckViewSwitcher current={deck} decks={decks} />
            <h1 className="text-2xl font-bold">{deck.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <a
              href={`https://netrunnerdb.com/en/decklist/${deck.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer text-sm text-accent hover:underline"
            >
              View on NetrunnerDB
            </a>
            <a href={`/api/deck/export?deckId=${deck.id}`} className="cursor-pointer text-sm text-accent hover:underline">
              Export CSV
            </a>
            <DeleteDeckButton deckId={deck.id} />
          </div>
        </div>

        {identity && (
          <div className="mt-2 flex items-center gap-2 text-muted">
            {deck.factionCode && (
              <svg width="24" height="24" fill="currentColor" aria-hidden="true">
                <use href={`/images/icons.svg#faction-${deck.factionCode}`} />
              </svg>
            )}
            <span>
              {identity.title} ({identity.factionName})
            </span>
          </div>
        )}

        <div className="mt-2 space-y-1 text-sm text-muted">
          {influenceLimit !== null && (
            <p>
              {deck.influenceSpent} influence spent (max {influenceLimit}, available {influenceAvailable})
            </p>
          )}
          {deck.agendaPoints && (
            <p>
              {deck.agendaPoints.inDeck} agenda points
              {deck.agendaPoints.required && (
                <>
                  {' '}
                  (between {deck.agendaPoints.required.min} and {deck.agendaPoints.required.max})
                </>
              )}
            </p>
          )}
          <p>
            {deck.totalCount} cards{minimumDeckSize !== null && <> (min {minimumDeckSize})</>}
          </p>
          {latestPack && <p>Cards up to {latestPack.name}</p>}
        </div>

        <div className="mt-3">
          <DeckCompletionBar ownedCount={deck.ownedCount} totalCount={deck.totalCount} percentOwned={deck.percentOwned} />
        </div>
      </div>

      <FormatLegalityBadges formatLegality={deck.formatLegality} />

      <div>
        <h2 className="mb-2 text-lg font-semibold">Decklist</h2>
        <DeckCardListByType cards={deck.cards} />
      </div>

      {deck.packsUsed.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Packs</h2>
          <DeckPacksUsed packs={deck.packsUsed} />
        </div>
      )}
    </main>
  )
}
