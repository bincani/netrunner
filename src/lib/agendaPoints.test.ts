import { describe, it, expect } from 'vitest'
import { computeAgendaPointRequirement } from './agendaPoints'

describe('computeAgendaPointRequirement', () => {
  it('returns 20-21 for a deck at the standard 45-card minimum', () => {
    expect(computeAgendaPointRequirement(45, 45)).toEqual({ min: 20, max: 21 })
  })

  it('stays in the same bracket for any size within the same 5-card increment', () => {
    expect(computeAgendaPointRequirement(45, 49)).toEqual({ min: 20, max: 21 })
  })

  it('increases by 2 for every full 5-card increment above the minimum', () => {
    expect(computeAgendaPointRequirement(45, 50)).toEqual({ min: 22, max: 23 })
    expect(computeAgendaPointRequirement(45, 54)).toEqual({ min: 22, max: 23 })
    expect(computeAgendaPointRequirement(45, 55)).toEqual({ min: 24, max: 25 })
    expect(computeAgendaPointRequirement(45, 60)).toEqual({ min: 26, max: 27 })
  })

  it('returns null when the deck is below its minimum size', () => {
    expect(computeAgendaPointRequirement(45, 44)).toBeNull()
  })
})
