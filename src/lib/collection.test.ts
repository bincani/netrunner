import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { incrementOwned, setOwned, getOwnedQuantity } from './collection'
import type { PrismaClient } from '@prisma/client'

describe('collection', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = createTestDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.card.deleteMany()
  })

  it('getOwnedQuantity returns 0 for a card with no collection entry', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    expect(await getOwnedQuantity(prisma, '01007')).toBe(0)
  })

  it('incrementOwned creates an entry when none exists', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    const quantity = await incrementOwned(prisma, '01007', 2)
    expect(quantity).toBe(2)
  })

  it('incrementOwned adds to an existing owned count', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, '01007', 1)
    const quantity = await incrementOwned(prisma, '01007', 2)
    expect(quantity).toBe(3)
  })

  it('incrementOwned rejects non-positive amounts', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await expect(incrementOwned(prisma, '01007', 0)).rejects.toThrow()
  })

  it('setOwned overwrites the owned count regardless of prior value', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, '01007', 3)
    const quantity = await setOwned(prisma, '01007', 1)
    expect(quantity).toBe(1)
  })

  it('setOwned accepts 0 to mark a card as not owned', async () => {
    await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })
    await incrementOwned(prisma, '01007', 3)
    const quantity = await setOwned(prisma, '01007', 0)
    expect(quantity).toBe(0)
  })
})
