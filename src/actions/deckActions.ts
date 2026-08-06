'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { parseDecklistId, fetchDecklist } from '@/lib/netrunnerdb'
import { getDeckWithOwnership, type DeckSummary } from '@/lib/decks'
import { saveDeck, removeDeck } from './deckMutations'

export async function importDeck(input: string): Promise<DeckSummary> {
  const decklistId = parseDecklistId(input)
  if (decklistId === null) {
    throw new Error('Enter a valid NetrunnerDB decklist URL or ID')
  }

  const decklist = await fetchDecklist(decklistId)
  await saveDeck(prisma, decklist.id, decklist.uuid, decklist.name, decklist.cards)
  revalidatePath('/builder')

  const summary = await getDeckWithOwnership(prisma, decklist.id)
  if (!summary) {
    throw new Error('Failed to load the imported deck')
  }
  return summary
}

export async function deleteDeck(id: number): Promise<void> {
  await removeDeck(prisma, id)
  revalidatePath('/builder')
}
