import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { searchCards } from '@/lib/cards'
import { getDefaultCollectionId } from '@/lib/collections'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? ''

  if (query.trim().length === 0) {
    return NextResponse.json([])
  }

  const collectionId = await getDefaultCollectionId(prisma)
  const results = await searchCards(prisma, collectionId, {
    query,
    factionCode: request.nextUrl.searchParams.get('faction') ?? undefined,
    typeCode: request.nextUrl.searchParams.get('type') ?? undefined,
    packCode: request.nextUrl.searchParams.get('pack') ?? undefined,
    sideCode: request.nextUrl.searchParams.get('side') ?? undefined,
  })

  return NextResponse.json(results)
}
