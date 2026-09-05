import type { PrismaClient } from '@prisma/client'

export async function getHiddenBuilderPackCodes(prisma: PrismaClient, userId: number): Promise<string[]> {
  const rows = await prisma.hiddenBuilderPack.findMany({ where: { userId }, select: { packCode: true } })
  return rows.map((row) => row.packCode)
}

export async function setHiddenBuilderPacks(prisma: PrismaClient, userId: number, packCodes: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.hiddenBuilderPack.deleteMany({ where: { userId } }),
    prisma.hiddenBuilderPack.createMany({ data: packCodes.map((packCode) => ({ userId, packCode })) }),
  ])
}

export async function getSetting(prisma: PrismaClient, userId: number, key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { userId_key: { userId, key } } })
  return row?.value ?? null
}

export async function setSetting(prisma: PrismaClient, userId: number, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value },
    update: { value },
  })
}

export type BuilderMode = 'simple' | 'batch'

const BUILDER_MODE_KEY = 'builderMode'

export async function getBuilderMode(prisma: PrismaClient, userId: number): Promise<BuilderMode> {
  const value = await getSetting(prisma, userId, BUILDER_MODE_KEY)
  return value === 'batch' ? 'batch' : 'simple'
}

export async function setBuilderMode(prisma: PrismaClient, userId: number, mode: BuilderMode): Promise<void> {
  await setSetting(prisma, userId, BUILDER_MODE_KEY, mode)
}

export type NavStyle = 'sidebar' | 'topbar'

const NAV_STYLE_KEY = 'navStyle'

export async function getNavStyle(prisma: PrismaClient, userId: number): Promise<NavStyle> {
  const value = await getSetting(prisma, userId, NAV_STYLE_KEY)
  return value === 'sidebar' ? 'sidebar' : 'topbar'
}

export async function setNavStyle(prisma: PrismaClient, userId: number, style: NavStyle): Promise<void> {
  await setSetting(prisma, userId, NAV_STYLE_KEY, style)
}
