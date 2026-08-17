import { describe, it, expect } from 'vitest'
import { resolveCurrentSnapshot, type RawSnapshot } from './formatSnapshot'

describe('resolveCurrentSnapshot', () => {
  it('picks the snapshot with the latest date_start that is not in the future', () => {
    const snapshots: RawSnapshot[] = [
      { id: 'a', date_start: '2020-01-01', card_pool_id: 'pool-a' },
      { id: 'b', date_start: '2021-06-01', card_pool_id: 'pool-b' },
      { id: 'c', date_start: '2026-01-01', card_pool_id: 'pool-c' },
    ]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.id).toBe('b')
  })

  it('includes a snapshot whose date_start is exactly today', () => {
    const snapshots: RawSnapshot[] = [{ id: 'a', date_start: '2022-01-01', card_pool_id: 'pool-a' }]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.id).toBe('a')
  })

  it('returns null when every snapshot is in the future', () => {
    const snapshots: RawSnapshot[] = [{ id: 'a', date_start: '2030-01-01', card_pool_id: 'pool-a' }]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result).toBeNull()
  })

  it('skips a snapshot explicitly marked active: false even if it has the latest past date_start', () => {
    const snapshots: RawSnapshot[] = [
      { id: 'a', date_start: '2020-01-01', card_pool_id: 'pool-a' },
      { id: 'b', date_start: '2020-06-01', card_pool_id: 'pool-b', active: false },
      { id: 'c', date_start: '2020-03-01', card_pool_id: 'pool-c' },
    ]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.id).toBe('c')
  })

  it('does not depend on array order', () => {
    const snapshots: RawSnapshot[] = [
      { id: 'later', date_start: '2026-01-01', card_pool_id: 'pool-later' },
      { id: 'earlier', date_start: '2020-01-01', card_pool_id: 'pool-earlier' },
    ]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.id).toBe('earlier')
  })

  it('carries restriction_id through when present', () => {
    const snapshots: RawSnapshot[] = [
      { id: 'a', date_start: '2020-01-01', card_pool_id: 'pool-a', restriction_id: 'ban-list-1' },
    ]

    const result = resolveCurrentSnapshot(snapshots, new Date('2022-01-01T00:00:00Z'))

    expect(result?.restriction_id).toBe('ban-list-1')
  })
})
