'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireCurrentUser } from '@/lib/currentUser'
import { getDefaultCollectionId } from '@/lib/collections'
import { getDiscoverDecks, type DiscoverDeck, type DiscoverFilters } from '@/lib/discover'
import { saveDeck } from './deckMutations'
import type { SimpleActionResult } from './deckActions'

export async function fetchDiscoverDecks(filters: DiscoverFilters): Promise<{ decks: DiscoverDeck[]; total: number }> {
  const { id: userId } = await requireCurrentUser()
  const collectionId = await getDefaultCollectionId(prisma, userId)
  return getDiscoverDecks(prisma, collectionId, filters)
}

export async function saveDiscoveredDeck(id: number): Promise<SimpleActionResult> {
  const deck = await prisma.tournamentDeck.findUnique({ where: { id }, include: { cards: true } })
  if (!deck) {
    return { ok: false, error: 'Deck not found' }
  }

  const { id: userId } = await requireCurrentUser()
  try {
    const cards = Object.fromEntries(deck.cards.map((card) => [card.cardCode, card.quantity]))
    await saveDeck(prisma, userId, deck.id, deck.uuid, deck.name, deck.dateCreation.toISOString(), cards)
    revalidatePath('/decks')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save deck' }
  }
}
