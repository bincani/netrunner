import type { PrismaClient, Card } from '@prisma/client'

interface SeedCardOptions {
  code: string
  title: string
  packCode: string
  packName?: string
  packSize?: number | null
  cycleCode?: string
  factionCode?: string
  typeCode?: string
  position?: number
}

export async function seedCard(prisma: PrismaClient, options: SeedCardOptions): Promise<Card> {
  const cycleCode = options.cycleCode ?? 'core'
  const factionCode = options.factionCode ?? 'anarch'
  const typeCode = options.typeCode ?? 'program'

  await prisma.cycle.upsert({
    where: { code: cycleCode },
    create: { code: cycleCode, name: cycleCode, position: 1 },
    update: {},
  })

  await prisma.pack.upsert({
    where: { code: options.packCode },
    create: {
      code: options.packCode,
      name: options.packName ?? options.packCode,
      cycleCode,
      position: 1,
      size: options.packSize === undefined ? 1 : options.packSize,
    },
    update: {},
  })

  await prisma.faction.upsert({
    where: { code: factionCode },
    create: { code: factionCode, name: factionCode, sideCode: 'runner' },
    update: {},
  })

  await prisma.cardType.upsert({
    where: { code: typeCode },
    create: { code: typeCode, name: typeCode, sideCode: 'runner' },
    update: {},
  })

  return prisma.card.create({
    data: {
      code: options.code,
      title: options.title,
      typeCode,
      factionCode,
      packCode: options.packCode,
      sideCode: 'runner',
      position: options.position ?? 1,
      uniqueness: false,
    },
  })
}
