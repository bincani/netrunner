import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getOtherPrintings } from '@/lib/cards'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.json([])
  }

  const printings = await getOtherPrintings(prisma, code)

  return NextResponse.json(printings)
}
