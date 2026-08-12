import { describe, it, expect } from 'vitest'
import { matchesOwnershipFilter } from './ownershipFilter'

describe('matchesOwnershipFilter', () => {
  it('"all" matches regardless of owned/expected', () => {
    expect(matchesOwnershipFilter(0, 3, 'all')).toBe(true)
    expect(matchesOwnershipFilter(1, 3, 'all')).toBe(true)
    expect(matchesOwnershipFilter(3, 3, 'all')).toBe(true)
  })

  it('"missing" matches only zero owned', () => {
    expect(matchesOwnershipFilter(0, 3, 'missing')).toBe(true)
    expect(matchesOwnershipFilter(1, 3, 'missing')).toBe(false)
    expect(matchesOwnershipFilter(3, 3, 'missing')).toBe(false)
  })

  it('"partial" matches owned less than expected', () => {
    expect(matchesOwnershipFilter(1, 3, 'partial')).toBe(true)
    expect(matchesOwnershipFilter(2, 3, 'partial')).toBe(true)
    expect(matchesOwnershipFilter(0, 3, 'partial')).toBe(false)
    expect(matchesOwnershipFilter(3, 3, 'partial')).toBe(false)
  })

  it('"owned" matches owned at or beyond expected', () => {
    expect(matchesOwnershipFilter(3, 3, 'owned')).toBe(true)
    expect(matchesOwnershipFilter(5, 3, 'owned')).toBe(true)
    expect(matchesOwnershipFilter(1, 3, 'owned')).toBe(false)
    expect(matchesOwnershipFilter(0, 3, 'owned')).toBe(false)
  })

  it('a null expected count is never "partial" — any nonzero owned counts as "owned"', () => {
    expect(matchesOwnershipFilter(1, null, 'owned')).toBe(true)
    expect(matchesOwnershipFilter(1, null, 'partial')).toBe(false)
    expect(matchesOwnershipFilter(0, null, 'missing')).toBe(true)
  })
})
