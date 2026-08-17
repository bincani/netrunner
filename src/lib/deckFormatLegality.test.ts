import { describe, it, expect } from 'vitest'
import { computeDeckFormatLegality } from './deckFormatLegality'

const formats = [{ code: 'standard', name: 'Standard' }]

describe('computeDeckFormatLegality', () => {
  it('is legal when every card is legal in the format', () => {
    const result = computeDeckFormatLegality(formats, [
      [{ formatCode: 'standard', status: 'legal' }],
      [{ formatCode: 'standard', status: 'restricted' }],
    ])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: true }])
  })

  it('is not legal if any card is banned', () => {
    const result = computeDeckFormatLegality(formats, [
      [{ formatCode: 'standard', status: 'legal' }],
      [{ formatCode: 'standard', status: 'banned' }],
    ])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: false }])
  })

  it('is not legal if any card is not_in_pool', () => {
    const result = computeDeckFormatLegality(formats, [[{ formatCode: 'standard', status: 'not_in_pool' }]])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: false }])
  })

  it('is unknown (null) if a card has no legality row for the format, and no other card is banned/not_in_pool', () => {
    const result = computeDeckFormatLegality(formats, [
      [{ formatCode: 'standard', status: 'legal' }],
      [], // this card has no legality data at all
    ])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: null }])
  })

  it('prioritizes a definite banned/not_in_pool verdict over an unknown one from another card', () => {
    const result = computeDeckFormatLegality(formats, [
      [{ formatCode: 'standard', status: 'banned' }],
      [], // unknown
    ])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: false }])
  })

  it('returns one entry per format, independent of each other', () => {
    const result = computeDeckFormatLegality(
      [
        { code: 'standard', name: 'Standard' },
        { code: 'startup', name: 'Startup' },
      ],
      [
        [
          { formatCode: 'standard', status: 'banned' },
          { formatCode: 'startup', status: 'legal' },
        ],
      ]
    )

    expect(result).toEqual([
      { formatCode: 'standard', formatName: 'Standard', legal: false },
      { formatCode: 'startup', formatName: 'Startup', legal: true },
    ])
  })

  it('a deck with no cards is legal in every format', () => {
    const result = computeDeckFormatLegality(formats, [])

    expect(result).toEqual([{ formatCode: 'standard', formatName: 'Standard', legal: true }])
  })
})
