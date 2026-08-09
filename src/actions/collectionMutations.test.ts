import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addToCollectionMutation, updateCollectionQuantityMutation } from './collectionMutations'
import * as collectionLib from '@/lib/collection'
import type { PrismaClient } from '@prisma/client'

vi.mock('@/lib/collection', () => ({
  incrementOwned: vi.fn(),
  setOwned: vi.fn(),
}))

describe('collection action wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('addToCollectionMutation delegates to incrementOwned, not setOwned', async () => {
    vi.mocked(collectionLib.incrementOwned).mockResolvedValue(5)
    const prisma = {} as PrismaClient

    const result = await addToCollectionMutation(prisma, 1, '01007', 2)

    expect(collectionLib.incrementOwned).toHaveBeenCalledWith(prisma, 1, '01007', 2)
    expect(collectionLib.setOwned).not.toHaveBeenCalled()
    expect(result).toBe(5)
  })

  it('updateCollectionQuantityMutation delegates to setOwned, not incrementOwned', async () => {
    vi.mocked(collectionLib.setOwned).mockResolvedValue(1)
    const prisma = {} as PrismaClient

    const result = await updateCollectionQuantityMutation(prisma, 1, '01007', 1)

    expect(collectionLib.setOwned).toHaveBeenCalledWith(prisma, 1, '01007', 1)
    expect(collectionLib.incrementOwned).not.toHaveBeenCalled()
    expect(result).toBe(1)
  })
})
