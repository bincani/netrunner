import { describe, it, expect } from 'vitest'
import { setImagePath } from './setImages'

describe('setImagePath', () => {
  it('returns the local path for a set with a known image', () => {
    expect(setImagePath('sg')).toBe('/set-images/sg.png')
  })

  it('preserves the source format for a non-png image', () => {
    expect(setImagePath('elev')).toBe('/set-images/elev.jpg')
    expect(setImagePath('tai')).toBe('/set-images/tai.webp')
  })

  it('returns null for a set with no downloaded image', () => {
    expect(setImagePath('mo')).toBeNull()
  })
})
