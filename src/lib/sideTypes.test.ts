import { describe, it, expect } from 'vitest'
import { sideTypeInfo } from './sideTypes'

describe('sideTypeInfo', () => {
  it('returns label and styling for corp', () => {
    expect(sideTypeInfo('corp')).toEqual({
      label: 'Corp',
      className: expect.any(String),
      borderClassName: expect.any(String),
      textClassName: expect.any(String),
    })
  })

  it('returns label and styling for runner', () => {
    expect(sideTypeInfo('runner')?.label).toBe('Runner')
  })

  it('returns null for null (unknown side)', () => {
    expect(sideTypeInfo(null)).toBeNull()
  })

  it('returns null for a side code not in the known list', () => {
    expect(sideTypeInfo('some_future_side')).toBeNull()
  })
})
