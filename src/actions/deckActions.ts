'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireCurrentUser } from '@/lib/currentUser'
import { parseDecklistId, fetchDecklist } from '@/lib/netrunnerdb'
import { getDeckWithOwnership, type DeckSummary } from '@/lib/decks'
import { getDefaultCollectionId } from '@/lib/collections'
import { saveDeck, removeDeck, reorderDecks as reorderDecksMutation } from './deckMutations'

export async function importDeck(
  input: string
): Promise<{ ok: true; deck: DeckSummary } | { ok: false; error: string }> {
  const decklistId = parseDecklistId(input)
  if (decklistId === null) {
    return { ok: false, error: 'Enter a valid NetrunnerDB decklist URL or ID' }
  }

  const { id: userId } = await requireCurrentUser()
  try {
    const decklist = await fetchDecklist(decklistId)
    const deckId = await saveDeck(prisma, userId, decklist.id, decklist.uuid, decklist.name, decklist.dateCreation, decklist.cards)
    revalidatePath('/decks')

    const collectionId = await getDefaultCollectionId(prisma, userId)
    const summary = await getDeckWithOwnership(prisma, userId, collectionId, deckId)
    if (!summary) {
      return { ok: false, error: 'Failed to load the imported deck' }
    }
    return { ok: true, deck: summary }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to import deck' }
  }
}

export async function deleteDeck(id: number): Promise<void> {
  const { id: userId } = await requireCurrentUser()
  await removeDeck(prisma, userId, id)
  revalidatePath('/decks')
}

export type SimpleActionResult = { ok: true } | { ok: false; error: string }

export async function reorderDecks(orderedIds: number[]): Promise<SimpleActionResult> {
  const { id: userId } = await requireCurrentUser()
  try {
    await reorderDecksMutation(prisma, userId, orderedIds)
    revalidatePath('/decks')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
  }
}
