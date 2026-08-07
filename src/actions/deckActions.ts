'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { parseDecklistId, fetchDecklist } from '@/lib/netrunnerdb'
import { getDeckWithOwnership, type DeckSummary } from '@/lib/decks'
import { saveDeck, removeDeck } from './deckMutations'

export async function importDeck(
  input: string
): Promise<{ ok: true; deck: DeckSummary } | { ok: false; error: string }> {
  const decklistId = parseDecklistId(input)
  if (decklistId === null) {
    return { ok: false, error: 'Enter a valid NetrunnerDB decklist URL or ID' }
  }

  try {
    const decklist = await fetchDecklist(decklistId)
    await saveDeck(prisma, decklist.id, decklist.uuid, decklist.name, decklist.cards)
    revalidatePath('/builder')

    const summary = await getDeckWithOwnership(prisma, decklist.id)
    if (!summary) {
      return { ok: false, error: 'Failed to load the imported deck' }
    }
    return { ok: true, deck: summary }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to import deck' }
  }
}

export async function deleteDeck(id: number): Promise<void> {
  await removeDeck(prisma, id)
  revalidatePath('/builder')
}
