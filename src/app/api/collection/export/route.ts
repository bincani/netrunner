import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
import { exportCollectionCsv } from '@/lib/collection'

export async function GET(request: NextRequest) {
  const collectionIdParam = request.nextUrl.searchParams.get('collectionId')
  const collectionId = collectionIdParam ? Number(collectionIdParam) : await getDefaultCollectionId(prisma)
  const csv = await exportCollectionCsv(prisma, collectionId)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="netrunner-collection.csv"',
    },
  })
}
