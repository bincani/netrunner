import type { PrismaClient } from '@prisma/client'

export async function getHiddenBuilderPackCodes(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.hiddenBuilderPack.findMany({ select: { packCode: true } })
  return rows.map((row) => row.packCode)
}

export async function setHiddenBuilderPacks(prisma: PrismaClient, packCodes: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.hiddenBuilderPack.deleteMany(),
    prisma.hiddenBuilderPack.createMany({ data: packCodes.map((packCode) => ({ packCode })) }),
  ])
}
