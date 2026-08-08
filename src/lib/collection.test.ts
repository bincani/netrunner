import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createTestDb } from './testDb'
import { seedCard } from './testFixtures'
import { incrementOwned, setOwned, getOwnedQuantity, exportCollectionCsv } from './collection'
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

  describe('exportCollectionCsv', () => {
    it('returns just the header when nothing is owned', async () => {
      const csv = await exportCollectionCsv(prisma)
      expect(csv).toBe('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n')
    })

    it('includes one row per owned card, with printed quantity', async () => {
      // packCode 'sg' (rather than the already-seeded-elsewhere-in-this-file
      // 'core') so this test's packName isn't shadowed by an earlier test's
      // seedCard call — pack.upsert's `update: {}` means only the FIRST
      // seedCard call for a given packCode in this process sets its name.
      await seedCard(prisma, {
        code: '02001',
        title: 'Corroder',
        packCode: 'sg',
        packName: 'System Gateway',
        factionCode: 'anarch',
        quantity: 3,
      })
      await incrementOwned(prisma, '02001', 2)

      const csv = await exportCollectionCsv(prisma)

      const lines = csv.trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(lines[1]).toBe('02001,Corroder,anarch,sg,System Gateway,2,3')
    })

    it('leaves printedQuantity blank for a card with no declared quantity', async () => {
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core', quantity: null })
      await incrementOwned(prisma, '01007', 1)

      const csv = await exportCollectionCsv(prisma)

      expect(csv.trim().split('\n')[1]).toBe('01007,Corroder,anarch,core,core,1,')
    })

    it('quotes and escapes a title containing a double quote', async () => {
      await seedCard(prisma, { code: '01007', title: 'Kate "Mac" McCaffrey', packCode: 'core' })
      await incrementOwned(prisma, '01007', 1)

      const csv = await exportCollectionCsv(prisma)

      expect(csv.trim().split('\n')[1]).toContain('"Kate ""Mac"" McCaffrey"')
    })

    it('excludes a card with no collection entry', async () => {
      await seedCard(prisma, { code: '01007', title: 'Corroder', packCode: 'core' })

      const csv = await exportCollectionCsv(prisma)

      expect(csv).toBe('cardCode,title,faction,packCode,packName,quantityOwned,printedQuantity\n')
    })
  })
})
