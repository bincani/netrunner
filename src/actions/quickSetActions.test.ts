import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createTestDb } from '@/lib/testDb'
import { seedCard, seedCollection, seedUser } from '@/lib/testFixtures'
import { getOwnedQuantity, incrementOwned } from '@/lib/collection'

const dbHolder = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))

vi.mock('@/lib/db', () => ({
  get prisma() {
    return dbHolder.prisma
  },
}))

// Every action under test resolves its own userId via requireCurrentUser()
// rather than accepting one as an argument, so tests fix it to a single
// known id and seed a matching User row (see TEST_USER_ID below).
vi.mock('@/lib/currentUser', () => ({
  requireCurrentUser: vi.fn().mockResolvedValue({ id: 1, email: 'test@example.com', emailVerifiedAt: null, createdAt: new Date() }),
}))

const TEST_USER_ID = 1

// These actions call revalidatePath, which throws ("static generation
// store missing") outside a real Next.js request — there's no request
// context in this unit test. Stub it out; what's under test here is the
// real server-side scoping logic, not Next's cache invalidation.
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}))

const { quickAddSet, clearSet, undoQuickSetChange } = await import('./quickSetActions')

describe('quickSetActions', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = createTestDb()
    dbHolder.prisma = prisma
    // Matches the fixed userId requireCurrentUser() is mocked to resolve —
    // real ownership checks in the lib layer require an actual User row.
    await prisma.user.create({ data: { id: TEST_USER_ID, email: 'test@example.com', passwordHash: 'not-a-real-hash' } })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.collectionEntry.deleteMany()
    await prisma.collection.deleteMany()
    await prisma.card.deleteMany()
  })

  describe('quickAddSet', () => {
    it('raises every card in the set up to its printed quantity', async () => {
      const collection = await seedCollection(prisma, TEST_USER_ID, { name: 'A', isDefault: true })
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

      const result = await quickAddSet(collection.id, 'core')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.changes).toEqual([{ cardCode: '01001', previousQuantity: 0 }])
      }
      expect(await getOwnedQuantity(prisma, TEST_USER_ID, collection.id, '01001')).toBe(3)
    })

    it('rejects a collectionId owned by a different user', async () => {
      const stranger = await seedUser(prisma, { email: 'stranger@example.com' })
      const foreign = await seedCollection(prisma, stranger.id, { name: 'Not mine', isDefault: true })
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })

      const result = await quickAddSet(foreign.id, 'core')

      expect(result.ok).toBe(false)
      expect(await getOwnedQuantity(prisma, stranger.id, foreign.id, '01001')).toBe(0)
    })
  })

  describe('clearSet', () => {
    it('zeros every card in the set that is currently owned', async () => {
      const collection = await seedCollection(prisma, TEST_USER_ID, { name: 'A', isDefault: true })
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
      await incrementOwned(prisma, TEST_USER_ID, collection.id, '01001', 2)

      const result = await clearSet(collection.id, 'core')

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.changes).toEqual([{ cardCode: '01001', previousQuantity: 2 }])
      }
      expect(await getOwnedQuantity(prisma, TEST_USER_ID, collection.id, '01001')).toBe(0)
    })

    it('rejects a collectionId owned by a different user', async () => {
      const stranger = await seedUser(prisma, { email: 'stranger2@example.com' })
      const foreign = await seedCollection(prisma, stranger.id, { name: 'Not mine', isDefault: true })
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
      await incrementOwned(prisma, stranger.id, foreign.id, '01001', 2)

      const result = await clearSet(foreign.id, 'core')

      expect(result.ok).toBe(false)
      expect(await getOwnedQuantity(prisma, stranger.id, foreign.id, '01001')).toBe(2)
    })
  })

  describe('undoQuickSetChange', () => {
    it('restores each card to its previous quantity', async () => {
      const collection = await seedCollection(prisma, TEST_USER_ID, { name: 'A', isDefault: true })
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
      await quickAddSet(collection.id, 'core')

      const result = await undoQuickSetChange(collection.id, [{ cardCode: '01001', previousQuantity: 0 }])

      expect(result.ok).toBe(true)
      expect(await getOwnedQuantity(prisma, TEST_USER_ID, collection.id, '01001')).toBe(0)
    })

    it('rejects a collectionId owned by a different user', async () => {
      const stranger = await seedUser(prisma, { email: 'stranger3@example.com' })
      const foreign = await seedCollection(prisma, stranger.id, { name: 'Not mine', isDefault: true })
      await seedCard(prisma, { code: '01001', title: 'Card A', packCode: 'core', quantity: 3 })
      await incrementOwned(prisma, stranger.id, foreign.id, '01001', 2)

      const result = await undoQuickSetChange(foreign.id, [{ cardCode: '01001', previousQuantity: 0 }])

      expect(result.ok).toBe(false)
      expect(await getOwnedQuantity(prisma, stranger.id, foreign.id, '01001')).toBe(2)
    })
  })
})
