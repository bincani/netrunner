import { describe, it, expect } from 'vitest'
import { groupFactionsBySide } from './factionGroups'

describe('groupFactionsBySide', () => {
  it('groups factions under their side, Corp before Runner', () => {
    const groups = groupFactionsBySide([
      { code: 'anarch', name: 'Anarch', sideCode: 'runner' },
      { code: 'jinteki', name: 'Jinteki', sideCode: 'corp' },
      { code: 'nbn', name: 'NBN', sideCode: 'corp' },
      { code: 'shaper', name: 'Shaper', sideCode: 'runner' },
    ])

    expect(groups).toEqual([
      {
        sideCode: 'corp',
        label: 'Corp',
        options: [
          { code: 'jinteki', name: 'Jinteki', sideCode: 'corp' },
          { code: 'nbn', name: 'NBN', sideCode: 'corp' },
        ],
      },
      {
        sideCode: 'runner',
        label: 'Runner',
        options: [
          { code: 'anarch', name: 'Anarch', sideCode: 'runner' },
          { code: 'shaper', name: 'Shaper', sideCode: 'runner' },
        ],
      },
    ])
  })

  it('preserves the input order of options within each side', () => {
    const groups = groupFactionsBySide([
      { code: 'shaper', name: 'Shaper', sideCode: 'runner' },
      { code: 'anarch', name: 'Anarch', sideCode: 'runner' },
    ])

    expect(groups[0].options.map((option) => option.code)).toEqual(['shaper', 'anarch'])
  })

  it('omits a side entirely when no factions belong to it', () => {
    const groups = groupFactionsBySide([{ code: 'jinteki', name: 'Jinteki', sideCode: 'corp' }])

    expect(groups.map((group) => group.sideCode)).toEqual(['corp'])
  })

  it('returns an empty array for an empty input', () => {
    expect(groupFactionsBySide([])).toEqual([])
  })

  it('appends an unrecognized side after the known ones, using its raw code as the label', () => {
    const groups = groupFactionsBySide([
      { code: 'anarch', name: 'Anarch', sideCode: 'runner' },
      { code: 'mystery', name: 'Mystery', sideCode: 'other' },
      { code: 'jinteki', name: 'Jinteki', sideCode: 'corp' },
    ])

    expect(groups.map((group) => group.sideCode)).toEqual(['corp', 'runner', 'other'])
    expect(groups[2]).toEqual({
      sideCode: 'other',
      label: 'other',
      options: [{ code: 'mystery', name: 'Mystery', sideCode: 'other' }],
    })
  })
})
