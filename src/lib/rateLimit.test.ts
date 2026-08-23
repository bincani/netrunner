import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { checkRateLimit } from './rateLimit'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('checkRateLimit', () => {
  it('allows calls under the limit', () => {
    expect(checkRateLimit('key-a', 3, 1000)).toBe(true)
    expect(checkRateLimit('key-a', 3, 1000)).toBe(true)
    expect(checkRateLimit('key-a', 3, 1000)).toBe(true)
  })

  it('blocks the call that crosses the limit', () => {
    checkRateLimit('key-b', 2, 1000)
    checkRateLimit('key-b', 2, 1000)
    expect(checkRateLimit('key-b', 2, 1000)).toBe(false)
  })

  it('allows again once the window has elapsed', () => {
    checkRateLimit('key-c', 1, 1000)
    expect(checkRateLimit('key-c', 1, 1000)).toBe(false)
    vi.setSystemTime(1001)
    expect(checkRateLimit('key-c', 1, 1000)).toBe(true)
  })

  it('tracks separate keys independently', () => {
    checkRateLimit('key-d', 1, 1000)
    expect(checkRateLimit('key-d', 1, 1000)).toBe(false)
    expect(checkRateLimit('key-e', 1, 1000)).toBe(true)
  })
})
