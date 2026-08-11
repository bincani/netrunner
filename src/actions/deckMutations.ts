import type { PrismaClient } from '@prisma/client'

export async function saveDeck(
  prisma: PrismaClient,
  id: number,
  uuid: string,
  name: string,
  cards: Record<string, number>
): Promise<void> {
  // A brand new deck is prepended (given the lowest sortOrder) so it lands
  // at the top of the list, matching the "most recently imported first"
  // ordering this list had before manual reordering existed. A re-import
  // of an existing id leaves sortOrder untouched, same as it already
  // leaves importedAt untouched — re-importing doesn't move the deck.
  const minSortOrder = await prisma.deck.aggregate({ _min: { sortOrder: true } })
  await prisma.$transaction([
    prisma.deck.upsert({
      where: { id },
      create: { id, uuid, name, sortOrder: (minSortOrder._min.sortOrder ?? 0) - 1 },
      update: { uuid, name },
    }),
    prisma.deckCard.deleteMany({ where: { deckId: id } }),
    prisma.deckCard.createMany({
      data: Object.entries(cards).map(([cardCode, quantity]) => ({ deckId: id, cardCode, quantity })),
    }),
  ])
}

export async function removeDeck(prisma: PrismaClient, id: number): Promise<void> {
  await prisma.$transaction([
    prisma.deckCard.deleteMany({ where: { deckId: id } }),
    prisma.deck.deleteMany({ where: { id } }),
  ])
}

export async function reorderDecks(prisma: PrismaClient, orderedIds: number[]): Promise<void> {
  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.deck.update({ where: { id }, data: { sortOrder: index } }))
  )
}
