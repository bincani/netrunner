import type { PrismaClient } from '@prisma/client'

const CHECKPOINT_KEY = 'tournamentDecksSyncedThrough'

export async function getSyncCheckpoint(prisma: PrismaClient): Promise<string | null> {
  const row = await prisma.syncCheckpoint.findUnique({ where: { key: CHECKPOINT_KEY } })
  return row?.value ?? null
}

export async function setSyncCheckpoint(prisma: PrismaClient, value: string): Promise<void> {
  await prisma.syncCheckpoint.upsert({
    where: { key: CHECKPOINT_KEY },
    create: { key: CHECKPOINT_KEY, value },
    update: { value },
  })
}
