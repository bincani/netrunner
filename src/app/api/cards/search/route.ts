import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { searchCards } from '@/lib/cards'
import { getDefaultCollectionId } from '@/lib/collections'
import { getCurrentUser } from '@/lib/currentUser'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') ?? ''

  if (query.trim().length === 0) {
    return NextResponse.json([])
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const collectionId = await getDefaultCollectionId(prisma, user.id)
  const results = await searchCards(prisma, collectionId, {
    query,
    factionCode: request.nextUrl.searchParams.get('faction') ?? undefined,
    typeCode: request.nextUrl.searchParams.get('type') ?? undefined,
    packCode: request.nextUrl.searchParams.get('pack') ?? undefined,
    sideCode: request.nextUrl.searchParams.get('side') ?? undefined,
  })

  return NextResponse.json(results)
}
