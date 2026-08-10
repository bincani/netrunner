import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getDefaultCollection } from '@/lib/collections'
import { exportCollectionCsv } from '@/lib/collection'

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'collection'
}

export async function GET(request: NextRequest) {
  const collectionIdParam = request.nextUrl.searchParams.get('collectionId')

  let collectionId: number
  let collectionName: string

  if (collectionIdParam === null || collectionIdParam === '') {
    const collection = await getDefaultCollection(prisma)
    collectionId = collection.id
    collectionName = collection.name
  } else {
    const parsed = Number(collectionIdParam)
    if (!Number.isInteger(parsed)) {
      return NextResponse.json({ error: `Invalid collectionId "${collectionIdParam}"` }, { status: 400 })
    }
    const collection = await prisma.collection.findUnique({ where: { id: parsed } })
    if (!collection) {
      return NextResponse.json({ error: `Collection ${parsed} not found` }, { status: 404 })
    }
    collectionId = collection.id
    collectionName = collection.name
  }

  const csv = await exportCollectionCsv(prisma, collectionId)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="netrunner-${slugify(collectionName)}.csv"`,
    },
  })
}
