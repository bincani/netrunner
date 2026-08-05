import { describe, it, expect } from 'vitest'
import { setTypeInfo } from './setTypes'

describe('setTypeInfo', () => {
  it('returns label and styling for a known set type', () => {
    expect(setTypeInfo('core')).toEqual({ label: 'Core', className: expect.any(String) })
    expect(setTypeInfo('data_pack')?.label).toBe('Data Pack')
    expect(setTypeInfo('deluxe')?.label).toBe('Deluxe')
  })

  it('returns null for null (unknown set type)', () => {
    expect(setTypeInfo(null)).toBeNull()
  })

  it('returns null for a set type not in the known list', () => {
    expect(setTypeInfo('some_future_type')).toBeNull()
  })
})
