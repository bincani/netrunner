import type { PrismaClient } from '@prisma/client'
import { fetchDecklistsByDate } from './netrunnerdb'
import { saveTournamentDeck } from '@/actions/tournamentDeckMutations'
import { getSyncCheckpoint, setSyncCheckpoint } from './syncCheckpoint'

export const SYNC_CHECKPOINT_KEY = 'tournamentDecksSyncedThrough'
export const FLOOR_DATE = '2012-01-01'

function addDays(date: string, delta: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + delta)
  return parsed.toISOString().slice(0, 10)
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface SyncProgress {
  date: string
  totalDecks: number
  tournamentDecks: number
}

export interface SyncSummary {
  daysWalked: number
  tournamentDecksSaved: number
}

export interface SyncOptions {
  onProgress?: (progress: SyncProgress) => void
  delayMs?: number
  endDate?: string
}

/**
 * Walks NetrunnerDB's public decklists/by_date endpoint one calendar day
 * at a time, persisting tournament-flagged decks and advancing the
 * SYNC_CHECKPOINT_KEY checkpoint after each successfully-synced day (not
 * batched to the end), so an interrupted run resumes at the next
 * unsynced day rather than re-walking from the last full success.
 */
export async function syncTournamentDecks(prisma: PrismaClient, options: SyncOptions = {}): Promise<SyncSummary> {
  const delayMs = options.delayMs ?? 150
  const endDate = options.endDate ?? addDays(todayUtc(), -1)

  const checkpoint = await getSyncCheckpoint(prisma)
  let cursor = checkpoint ? addDays(checkpoint, 1) : FLOOR_DATE

  let daysWalked = 0
  let tournamentDecksSaved = 0

  while (cursor <= endDate) {
    const dayDecks = await fetchDecklistsByDate(cursor)
    const tournamentDecks = dayDecks.filter((deck) => deck.tournamentBadge)

    for (const deck of tournamentDecks) {
      const identity = await prisma.card.findFirst({
        where: { code: { in: Object.keys(deck.cards) }, typeCode: 'identity' },
        select: { factionCode: true },
      })
      await saveTournamentDeck(prisma, {
        id: deck.id,
        uuid: deck.uuid,
        name: deck.name,
        dateCreation: new Date(deck.dateCreation),
        userName: deck.userName,
        factionCode: identity?.factionCode ?? null,
        cards: deck.cards,
      })
      tournamentDecksSaved += 1
    }

    await setSyncCheckpoint(prisma, cursor)
    options.onProgress?.({ date: cursor, totalDecks: dayDecks.length, tournamentDecks: tournamentDecks.length })
    daysWalked += 1

    if (cursor < endDate && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    cursor = addDays(cursor, 1)
  }

  return { daysWalked, tournamentDecksSaved }
}
