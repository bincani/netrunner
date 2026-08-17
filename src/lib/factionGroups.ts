export interface FactionOption {
  code: string
  name: string
  sideCode: string
}

export interface FactionGroup {
  sideCode: string
  label: string
  options: FactionOption[]
}

const SIDE_ORDER = ['corp', 'runner']
const SIDE_LABELS: Record<string, string> = { corp: 'Corp', runner: 'Runner' }

/**
 * Groups faction options by side (Corp before Runner, matching how
 * Netrunner decklists/deckbuilders conventionally order the two), for
 * rendering as <optgroup>s in a faction <select>. An unrecognized
 * sideCode is appended after the known ones, labeled with its raw code.
 */
export function groupFactionsBySide(factionOptions: FactionOption[]): FactionGroup[] {
  const bySide = new Map<string, FactionOption[]>()
  for (const option of factionOptions) {
    const existing = bySide.get(option.sideCode)
    if (existing) existing.push(option)
    else bySide.set(option.sideCode, [option])
  }

  const orderedSides = [...SIDE_ORDER, ...[...bySide.keys()].filter((side) => !SIDE_ORDER.includes(side))]

  return orderedSides
    .filter((side) => bySide.has(side))
    .map((side) => ({
      sideCode: side,
      label: SIDE_LABELS[side] ?? side,
      options: bySide.get(side)!,
    }))
}
