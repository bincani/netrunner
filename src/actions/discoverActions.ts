'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
import { getDiscoverDecks, type DiscoverDeck, type DiscoverFilters } from '@/lib/discover'
import { saveDeck } from './deckMutations'
import type { SimpleActionResult } from './deckActions'

export async function fetchDiscoverDecks(filters: DiscoverFilters): Promise<{ decks: DiscoverDeck[]; total: number }> {
  const collectionId = await getDefaultCollectionId(prisma)
  return getDiscoverDecks(prisma, collectionId, filters)
}

export async function saveDiscoveredDeck(id: number): Promise<SimpleActionResult> {
  const deck = await prisma.tournamentDeck.findUnique({ where: { id }, include: { cards: true } })
  if (!deck) {
    return { ok: false, error: 'Deck not found' }
  }

  const cards = Object.fromEntries(deck.cards.map((card) => [card.cardCode, card.quantity]))
  await saveDeck(prisma, deck.id, deck.uuid, deck.name, cards)
  revalidatePath('/decks')
  return { ok: true }
}
