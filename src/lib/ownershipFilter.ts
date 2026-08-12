export type OwnershipFilter = 'all' | 'owned' | 'partial' | 'missing'

export const OWNERSHIP_FILTER_OPTIONS: { value: OwnershipFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'partial', label: 'Partial' },
  { value: 'missing', label: 'Missing' },
]

/**
 * Classifies an (owned, expected) pair into one of the filter buckets.
 * `expected === null` means the target count isn't known, so a nonzero
 * `owned` can never be proven short of it — such an item counts as
 * "owned", never "partial".
 */
export function matchesOwnershipFilter(owned: number, expected: number | null, filter: OwnershipFilter): boolean {
  if (filter === 'all') return true
  if (owned === 0) return filter === 'missing'
  if (expected !== null && owned < expected) return filter === 'partial'
  return filter === 'owned'
}
