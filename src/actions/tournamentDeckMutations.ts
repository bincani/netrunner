import type { PrismaClient } from '@prisma/client'

export interface TournamentDeckInput {
  id: number
  uuid: string
  name: string
  dateCreation: Date
  userName: string
  factionCode: string | null
  cards: Record<string, number>
}

export async function saveTournamentDeck(prisma: PrismaClient, deck: TournamentDeckInput): Promise<void> {
  await prisma.$transaction([
    prisma.tournamentDeck.upsert({
      where: { id: deck.id },
      create: {
        id: deck.id,
        uuid: deck.uuid,
        name: deck.name,
        dateCreation: deck.dateCreation,
        userName: deck.userName,
        factionCode: deck.factionCode,
      },
      update: {
        uuid: deck.uuid,
        name: deck.name,
        dateCreation: deck.dateCreation,
        userName: deck.userName,
        factionCode: deck.factionCode,
      },
    }),
    prisma.tournamentDeckCard.deleteMany({ where: { deckId: deck.id } }),
    prisma.tournamentDeckCard.createMany({
      data: Object.entries(deck.cards).map(([cardCode, quantity]) => ({ deckId: deck.id, cardCode, quantity })),
    }),
  ])
}
