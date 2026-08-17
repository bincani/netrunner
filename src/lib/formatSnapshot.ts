export interface RawSnapshot {
  id: string
  date_start: string
  card_pool_id: string
  restriction_id?: string
  active?: boolean
}

/**
 * Picks the currently-active snapshot for a format: the one with the
 * latest date_start that is not in the future and not explicitly marked
 * active: false. Real NSG data includes entries explicitly deactivated
 * after their date passed (a reverted change) and at least one
 * out-of-chronological-order special entry mixed into the same array —
 * comparing every eligible entry's date_start directly (never relying on
 * array position) handles both correctly.
 */
export function resolveCurrentSnapshot(snapshots: RawSnapshot[], today: Date): RawSnapshot | null {
  const todayStr = today.toISOString().slice(0, 10)
  const eligible = snapshots.filter((snapshot) => snapshot.active !== false && snapshot.date_start <= todayStr)

  if (eligible.length === 0) {
    return null
  }

  return eligible.reduce((latest, snapshot) => (snapshot.date_start > latest.date_start ? snapshot : latest))
}
