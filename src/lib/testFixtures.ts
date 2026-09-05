import type { PrismaClient, Card } from '@prisma/client'

interface SeedCardOptions {
  code: string
  title: string
  packCode: string
  packName?: string
  packSize?: number | null
  packSetType?: string | null
  packDateRelease?: string | null
  cycleCode?: string
  factionCode?: string
  typeCode?: string
  position?: number
  quantity?: number | null
  factionCost?: number | null
  agendaPoints?: number | null
  influenceLimit?: number | null
  minimumDeckSize?: number | null
  sideCode?: string
  keywords?: string | null
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

  const packData = {
    name: options.packName ?? options.packCode,
    cycleCode,
    position: 1,
    size: options.packSize === undefined ? 1 : options.packSize,
    setType: options.packSetType === undefined ? null : options.packSetType,
    dateRelease: options.packDateRelease === undefined ? null : options.packDateRelease,
  }
  await prisma.pack.upsert({
    where: { code: options.packCode },
    create: { code: options.packCode, ...packData },
    update: packData,
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
      sideCode: options.sideCode ?? 'runner',
      position: options.position ?? 1,
      uniqueness: false,
      quantity: options.quantity === undefined ? 1 : options.quantity,
      factionCost: options.factionCost === undefined ? null : options.factionCost,
      agendaPoints: options.agendaPoints === undefined ? null : options.agendaPoints,
      influenceLimit: options.influenceLimit === undefined ? null : options.influenceLimit,
      minimumDeckSize: options.minimumDeckSize === undefined ? null : options.minimumDeckSize,
      keywords: options.keywords === undefined ? null : options.keywords,
    },
  })
}

interface SeedCollectionOptions {
  name?: string
  isDefault?: boolean
}

export async function seedCollection(prisma: PrismaClient, userId: number, options: SeedCollectionOptions = {}) {
  return prisma.collection.create({
    data: {
      userId,
      name: options.name ?? 'Test Collection',
      isDefault: options.isDefault ?? true,
    },
  })
}

let userCounter = 0

export async function seedUser(prisma: PrismaClient, options: { email?: string } = {}) {
  userCounter += 1
  return prisma.user.create({
    data: {
      email: options.email ?? `test-user-${userCounter}@example.com`,
      passwordHash: 'not-a-real-hash',
    },
  })
}
