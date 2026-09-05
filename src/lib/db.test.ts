import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb } from './testDb'
import { seedUser } from './testFixtures'
import type { PrismaClient } from '@prisma/client'

describe('prisma schema', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('stores a card with its cycle, pack, faction, and type relations', async () => {
    await prisma.cycle.create({ data: { code: 'core', name: 'Core Set', position: 1 } })
    await prisma.pack.create({
      data: { code: 'core', name: 'Core Set', cycleCode: 'core', position: 1, size: 1 },
    })
    await prisma.faction.create({ data: { code: 'anarch', name: 'Anarch', sideCode: 'runner' } })
    await prisma.cardType.create({ data: { code: 'program', name: 'Program', sideCode: 'runner' } })
    await prisma.card.create({
      data: {
        code: '01007',
        title: 'Corroder',
        typeCode: 'program',
        factionCode: 'anarch',
        packCode: 'core',
        sideCode: 'runner',
        cost: 2,
        factionCost: 2,
        deckLimit: 3,
        position: 7,
        uniqueness: false,
      },
    })

    const card = await prisma.card.findUniqueOrThrow({
      where: { code: '01007' },
      include: { pack: true, faction: true, type: true },
    })

    expect(card.title).toBe('Corroder')
    expect(card.pack.name).toBe('Core Set')
    expect(card.faction.name).toBe('Anarch')
    expect(card.type.name).toBe('Program')
  })

  it('tracks a collection entry for a card, scoped to a collection', async () => {
    const user = await seedUser(prisma)
    const collection = await prisma.collection.create({ data: { userId: user.id, name: 'Test Collection', isDefault: true } })
    await prisma.collectionEntry.create({
      data: { collectionId: collection.id, cardCode: '01007', quantityOwned: 2 },
    })
    const entry = await prisma.collectionEntry.findUniqueOrThrow({
      where: { collectionId_cardCode: { collectionId: collection.id, cardCode: '01007' } },
    })
    expect(entry.quantityOwned).toBe(2)
  })
})
