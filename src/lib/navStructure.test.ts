import { describe, it, expect } from 'vitest'
import { isNavLinkActive, isNavGroupActive, type NavGroup } from './navStructure'

describe('isNavLinkActive', () => {
  it('matches an exact-only link only on the exact path', () => {
    const item = { type: 'link' as const, href: '/', label: 'Dashboard', exact: true }

    expect(isNavLinkActive('/', item)).toBe(true)
    expect(isNavLinkActive('/decks', item)).toBe(false)
    expect(isNavLinkActive('/builder', item)).toBe(false)
  })

  it('matches a non-exact link on its own path and any sub-path', () => {
    const item = { type: 'link' as const, href: '/builder', label: 'Builder' }

    expect(isNavLinkActive('/builder', item)).toBe(true)
    expect(isNavLinkActive('/builder/batches', item)).toBe(true)
    expect(isNavLinkActive('/decks', item)).toBe(false)
  })

  it('returns false when pathname is null or undefined', () => {
    const item = { type: 'link' as const, href: '/builder', label: 'Builder' }

    expect(isNavLinkActive(null, item)).toBe(false)
    expect(isNavLinkActive(undefined, item)).toBe(false)
  })
})

describe('isNavGroupActive', () => {
  const group: NavGroup = {
    label: 'Cards',
    items: [
      { type: 'disabled', label: 'Finder' },
      {
        type: 'group',
        label: 'Reports',
        items: [{ type: 'link', href: '/reports/under-owned-cards', label: 'Under-Owned Cards' }],
      },
    ],
  }

  it('is active when the path matches a direct link item', () => {
    const directGroup: NavGroup = {
      label: 'Deck',
      items: [{ type: 'link', href: '/decks', label: 'My Decks' }],
    }

    expect(isNavGroupActive('/decks', directGroup)).toBe(true)
  })

  it('is active when the path matches a link nested inside a sub-group', () => {
    expect(isNavGroupActive('/reports/under-owned-cards', group)).toBe(true)
  })

  it('ignores disabled items and is inactive on an unrelated path', () => {
    expect(isNavGroupActive('/builder', group)).toBe(false)
  })
})
