import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
import { exportCollectionCsv } from '@/lib/collection'

export async function GET() {
  const collectionId = await getDefaultCollectionId(prisma)
  const csv = await exportCollectionCsv(prisma, collectionId)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="netrunner-collection.csv"',
    },
  })
}
