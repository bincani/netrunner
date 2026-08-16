import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOtherPrintings, getAllPrintings } from '@/lib/cards'
import { getDefaultCollectionId } from '@/lib/collections'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.json([])
  }

  const includeSelf = request.nextUrl.searchParams.get('includeSelf') === 'true'
  if (!includeSelf) {
    return NextResponse.json(await getOtherPrintings(prisma, code))
  }

  const collectionId = await getDefaultCollectionId(prisma)
  return NextResponse.json(await getAllPrintings(prisma, collectionId, code))
}
