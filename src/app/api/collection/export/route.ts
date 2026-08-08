import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { exportCollectionCsv } from '@/lib/collection'

export async function GET() {
  const csv = await exportCollectionCsv(prisma)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="netrunner-collection.csv"',
    },
  })
}
