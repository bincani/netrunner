import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCardDetail } from '@/lib/cards'
import { getDefaultCollectionId } from '@/lib/collections'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 })
  }

  const collectionId = await getDefaultCollectionId(prisma)
  const card = await getCardDetail(prisma, collectionId, code)

  if (!card) {
    return NextResponse.json({ error: `Card ${code} not found` }, { status: 404 })
  }

  return NextResponse.json(card)
}
