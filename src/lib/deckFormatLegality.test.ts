import { describe, it, expect } from 'vitest'
import { computeDeckFormatLegality } from './deckFormatLegality'

const formats = [{ code: 'standard', name: 'Standard', activeRestrictionName: null, currentSnapshotDate: null }]

describe('computeDeckFormatLegality', () => {
  it('is legal when every card is legal in the format', () => {
    const result = computeDeckFormatLegality(
      formats,
      [[{ formatCode: 'standard', status: 'legal' }], [{ formatCode: 'standard', status: 'restricted' }]],
      null
    )

    expect(result).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: true, activeRestrictionName: null, isPreRotation: null },
    ])
  })

  it('is not legal if any card is banned', () => {
    const result = computeDeckFormatLegality(
      formats,
      [[{ formatCode: 'standard', status: 'legal' }], [{ formatCode: 'standard', status: 'banned' }]],
      null
    )

    expect(result).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: false, activeRestrictionName: null, isPreRotation: null },
    ])
  })

  it('is not legal if any card is not_in_pool', () => {
    const result = computeDeckFormatLegality(formats, [[{ formatCode: 'standard', status: 'not_in_pool' }]], null)

    expect(result).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: false, activeRestrictionName: null, isPreRotation: null },
    ])
  })

  it('is unknown (null) if a card has no legality row for the format, and no other card is banned/not_in_pool', () => {
    const result = computeDeckFormatLegality(
      formats,
      [
        [{ formatCode: 'standard', status: 'legal' }],
        [], // this card has no legality data at all
      ],
      null
    )

    expect(result).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: null, activeRestrictionName: null, isPreRotation: null },
    ])
  })

  it('prioritizes a definite banned/not_in_pool verdict over an unknown one from another card', () => {
    const result = computeDeckFormatLegality(
      formats,
      [
        [{ formatCode: 'standard', status: 'banned' }],
        [], // unknown
      ],
      null
    )

    expect(result).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: false, activeRestrictionName: null, isPreRotation: null },
    ])
  })

  it('returns one entry per format, independent of each other', () => {
    const result = computeDeckFormatLegality(
      [
        { code: 'standard', name: 'Standard', activeRestrictionName: null, currentSnapshotDate: null },
        { code: 'startup', name: 'Startup', activeRestrictionName: null, currentSnapshotDate: null },
      ],
      [
        [
          { formatCode: 'standard', status: 'banned' },
          { formatCode: 'startup', status: 'legal' },
        ],
      ],
      null
    )

    expect(result).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: false, activeRestrictionName: null, isPreRotation: null },
      { formatCode: 'startup', formatName: 'Startup', legal: true, activeRestrictionName: null, isPreRotation: null },
    ])
  })

  it('a deck with no cards is legal in every format', () => {
    const result = computeDeckFormatLegality(formats, [], null)

    expect(result).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: true, activeRestrictionName: null, isPreRotation: null },
    ])
  })

  it("passes through the format's active restriction name", () => {
    const result = computeDeckFormatLegality(
      [{ code: 'standard', name: 'Standard', activeRestrictionName: 'Standard Balance Update 26.08', currentSnapshotDate: null }],
      [],
      null
    )

    expect(result[0].activeRestrictionName).toBe('Standard Balance Update 26.08')
  })

  it('flags a deck as pre-rotation when its creation date predates the current snapshot', () => {
    const result = computeDeckFormatLegality(
      [{ code: 'standard', name: 'Standard', activeRestrictionName: null, currentSnapshotDate: '2026-08-01' }],
      [],
      new Date('2020-01-01')
    )

    expect(result[0].isPreRotation).toBe(true)
  })

  it('does not flag a deck as pre-rotation when created on or after the current snapshot start date', () => {
    const result = computeDeckFormatLegality(
      [{ code: 'standard', name: 'Standard', activeRestrictionName: null, currentSnapshotDate: '2026-08-01' }],
      [],
      new Date('2026-08-15')
    )

    expect(result[0].isPreRotation).toBe(false)
  })

  it('reports isPreRotation as null (unknown) when the deck\'s creation date is unknown', () => {
    const result = computeDeckFormatLegality(
      [{ code: 'standard', name: 'Standard', activeRestrictionName: null, currentSnapshotDate: '2026-08-01' }],
      [],
      null
    )

    expect(result[0].isPreRotation).toBeNull()
  })

  it('reports isPreRotation as null when the format has no current snapshot date', () => {
    const result = computeDeckFormatLegality(
      [{ code: 'standard', name: 'Standard', activeRestrictionName: null, currentSnapshotDate: null }],
      [],
      new Date('2020-01-01')
    )

    expect(result[0].isPreRotation).toBeNull()
  })
})
