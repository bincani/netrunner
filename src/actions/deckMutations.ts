import type { PrismaClient } from '@prisma/client'

export async function saveDeck(
  prisma: PrismaClient,
  id: number,
  uuid: string,
  name: string,
  cards: Record<string, number>
): Promise<void> {
  await prisma.$transaction([
    prisma.deck.upsert({
      where: { id },
      create: { id, uuid, name },
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
