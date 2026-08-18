export interface NavLinkItem {
  type: 'link'
  href: string
  label: string
  exact?: boolean
}

export interface NavDisabledItem {
  type: 'disabled'
  label: string
}

export interface NavSubGroup {
  type: 'group'
  label: string
  items: NavLinkItem[]
}

export type NavItem = NavLinkItem | NavDisabledItem | NavSubGroup

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** Links that stand alone in the nav, outside the Collection/Deck/Cards groups. */
export const NAV_STANDALONE_LINKS: NavLinkItem[] = [
  { type: 'link', href: '/', label: 'Dashboard', exact: true },
  { type: 'link', href: '/docs', label: 'Docs' },
]

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Collection',
    items: [
      { type: 'link', href: '/collections', label: 'My Collections' },
      { type: 'link', href: '/builder/batches', label: 'Batch History' },
      { type: 'link', href: '/builder', label: 'Builder', exact: true },
    ],
  },
  {
    label: 'Deck',
    items: [
      { type: 'link', href: '/decks', label: 'My Decks' },
      { type: 'disabled', label: 'Builder' },
      { type: 'link', href: '/discover', label: 'Discover' },
    ],
  },
  {
    label: 'Cards',
    items: [
      { type: 'disabled', label: 'Finder' },
      { type: 'disabled', label: 'Creator' },
      {
        type: 'group',
        label: 'Reports',
        items: [{ type: 'link', href: '/reports/under-owned-cards', label: 'Under-Owned Cards' }],
      },
    ],
  },
]

export function isNavLinkActive(pathname: string | null | undefined, item: NavLinkItem): boolean {
  if (!pathname) return false
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
}

/** True if the current path matches any link inside this group, including nested sub-groups (e.g. Reports under Cards). */
export function isNavGroupActive(pathname: string | null | undefined, group: NavGroup): boolean {
  return group.items.some((item) => {
    if (item.type === 'link') return isNavLinkActive(pathname, item)
    if (item.type === 'group') return item.items.some((subItem) => isNavLinkActive(pathname, subItem))
    return false
  })
}
