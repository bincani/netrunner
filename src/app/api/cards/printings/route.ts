import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOtherPrintings, getAllPrintings } from '@/lib/cards'
import { getDefaultCollectionId } from '@/lib/collections'
import { getCurrentUser } from '@/lib/currentUser'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.json([])
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const includeSelf = request.nextUrl.searchParams.get('includeSelf') === 'true'
  if (!includeSelf) {
    return NextResponse.json(await getOtherPrintings(prisma, code))
  }

  const collectionId = await getDefaultCollectionId(prisma, user.id)
  return NextResponse.json(await getAllPrintings(prisma, collectionId, code))
}
