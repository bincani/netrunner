import type { PrismaClient } from '@prisma/client'
import { requireOwnedDeck } from '@/lib/decks'

export async function saveDeck(
  prisma: PrismaClient,
  userId: number,
  netrunnerdbId: number,
  uuid: string,
  name: string,
  dateCreation: string | null,
  cards: Record<string, number>
): Promise<number> {
  // A brand new deck is prepended (given the lowest sortOrder) so it lands
  // at the top of the list, matching the "most recently imported first"
  // ordering this list had before manual reordering existed. A re-import
  // of an existing netrunnerdbId leaves sortOrder untouched, same as it
  // already leaves importedAt untouched — re-importing doesn't move the deck.
  const minSortOrder = await prisma.deck.aggregate({ where: { userId }, _min: { sortOrder: true } })
  const parsedDateCreation = dateCreation === null ? null : new Date(dateCreation)
  const deck = await prisma.deck.upsert({
    where: { userId_netrunnerdbId: { userId, netrunnerdbId } },
    create: {
      userId,
      netrunnerdbId,
      uuid,
      name,
      dateCreation: parsedDateCreation,
      sortOrder: (minSortOrder._min.sortOrder ?? 0) - 1,
    },
    update: { uuid, name, dateCreation: parsedDateCreation },
  })
  await prisma.$transaction([
    prisma.deckCard.deleteMany({ where: { deckId: deck.id } }),
    prisma.deckCard.createMany({
      data: Object.entries(cards).map(([cardCode, quantity]) => ({ deckId: deck.id, cardCode, quantity })),
    }),
  ])
  return deck.id
}

export async function removeDeck(prisma: PrismaClient, userId: number, id: number): Promise<void> {
  await requireOwnedDeck(prisma, userId, id)
  await prisma.$transaction([
    prisma.deckCard.deleteMany({ where: { deckId: id } }),
    prisma.deck.deleteMany({ where: { id } }),
  ])
}

export async function reorderDecks(prisma: PrismaClient, userId: number, orderedIds: number[]): Promise<void> {
  for (const id of orderedIds) {
    await requireOwnedDeck(prisma, userId, id)
  }
  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.deck.update({ where: { id }, data: { sortOrder: index } }))
  )
}
