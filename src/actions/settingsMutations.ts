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

export async function getSetting(prisma: PrismaClient, key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(prisma: PrismaClient, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

export type BuilderMode = 'simple' | 'batch'

const BUILDER_MODE_KEY = 'builderMode'

export async function getBuilderMode(prisma: PrismaClient): Promise<BuilderMode> {
  const value = await getSetting(prisma, BUILDER_MODE_KEY)
  return value === 'batch' ? 'batch' : 'simple'
}

export async function setBuilderMode(prisma: PrismaClient, mode: BuilderMode): Promise<void> {
  await setSetting(prisma, BUILDER_MODE_KEY, mode)
}
