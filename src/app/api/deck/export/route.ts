import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getDefaultCollectionId } from '@/lib/collections'
import { exportDeckCsv } from '@/lib/decks'
import { getCurrentUser } from '@/lib/currentUser'

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'deck'
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deckIdParam = request.nextUrl.searchParams.get('deckId')
  const parsed = Number(deckIdParam)
  if (deckIdParam === null || deckIdParam === '' || !Number.isInteger(parsed)) {
    return NextResponse.json({ error: `Invalid deckId "${deckIdParam}"` }, { status: 400 })
  }

  const deck = await prisma.deck.findFirst({ where: { id: parsed, userId: user.id } })
  if (!deck) {
    return NextResponse.json({ error: `Deck ${parsed} not found` }, { status: 404 })
  }

  const collectionId = await getDefaultCollectionId(prisma, user.id)
  const csv = await exportDeckCsv(prisma, user.id, collectionId, parsed)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="netrunner-deck-${slugify(deck.name)}.csv"`,
    },
  })
}
