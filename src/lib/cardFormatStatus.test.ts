import { describe, it, expect } from 'vitest'
import { computeCardFormatStatus, type CardPoolMembership } from './cardFormatStatus'

const cardInPoolByPack = { packCode: 'core', cycleCode: 'core', cardId: 'sure_gamble' }
const cardInPoolByCycle = { packCode: 'some-pack', cycleCode: 'genesis', cardId: 'sure_gamble' }
const cardOutOfPool = { packCode: 'rotated-pack', cycleCode: 'rotated-cycle', cardId: 'sure_gamble' }

const emptyPool: CardPoolMembership = { legalPackCodes: new Set(['core']), legalCycleCodes: new Set(['genesis']) }

describe('computeCardFormatStatus', () => {
  it('is not_in_pool when neither the pack nor the cycle is legal', () => {
    const result = computeCardFormatStatus(cardOutOfPool, emptyPool, null)
    expect(result).toEqual({ status: 'not_in_pool', detail: null })
  })

  it('is legal when in pool via pack membership and there is no restriction data', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, null)
    expect(result).toEqual({ status: 'legal', detail: null })
  })

  it('is legal when in pool via cycle membership alone', () => {
    const result = computeCardFormatStatus(cardInPoolByCycle, emptyPool, null)
    expect(result).toEqual({ status: 'legal', detail: null })
  })

  it('is legal when in pool and a restriction exists but does not mention this card', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, { banned: ['some_other_card'] })
    expect(result).toEqual({ status: 'legal', detail: null })
  })

  it('is banned when the card_id is in the restriction\'s banned list', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, { banned: ['sure_gamble'] })
    expect(result).toEqual({ status: 'banned', detail: null })
  })

  it('is restricted when the card_id is in the restriction\'s restricted list', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, { restricted: ['sure_gamble'] })
    expect(result).toEqual({ status: 'restricted', detail: null })
  })

  it('is universal_influence_penalty with a "+N influence" detail from global_penalty', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, {
      global_penalty: { '2': ['sure_gamble'] },
    })
    expect(result).toEqual({ status: 'universal_influence_penalty', detail: '+2 influence' })
  })

  it('is points with a "N pts (limit M)" detail from points/point_limit', () => {
    const result = computeCardFormatStatus(cardInPoolByPack, emptyPool, {
      points: { '3': ['sure_gamble'] },
      point_limit: 7,
    })
    expect(result).toEqual({ status: 'points', detail: '3 pts (limit 7)' })
  })

  it('a not_in_pool card is not_in_pool even if it also appears in a restriction bucket', () => {
    const result = computeCardFormatStatus(cardOutOfPool, emptyPool, { banned: ['sure_gamble'] })
    expect(result).toEqual({ status: 'not_in_pool', detail: null })
  })
})
