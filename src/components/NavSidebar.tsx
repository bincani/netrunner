'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  NAV_STANDALONE_LINKS,
  NAV_GROUPS,
  isNavLinkActive,
  isNavGroupActive,
  type NavItem,
  type NavLinkItem,
} from '@/lib/navStructure'

export function NavSidebar() {
  const pathname = usePathname()

  return (
    <nav aria-label="Primary" className="flex w-56 shrink-0 flex-col gap-6 border-r border-subtle p-4">
      <div className="flex flex-col gap-1">
        {NAV_STANDALONE_LINKS.map((link) => (
          <NavLinkRow key={link.href} item={link} pathname={pathname} />
        ))}
      </div>

      {NAV_GROUPS.map((group) => {
        const groupActive = isNavGroupActive(pathname, group)
        return (
          <div key={group.label} className="flex flex-col gap-1">
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${groupActive ? 'text-accent' : 'text-faint'}`}
            >
              {group.label}
            </span>
            {group.items.map((item) => (
              <NavGroupItemRow key={item.label} item={item} pathname={pathname} />
            ))}
          </div>
        )
      })}
    </nav>
  )
}

function NavGroupItemRow({ item, pathname }: { item: NavItem; pathname: string | null }) {
  if (item.type === 'disabled') {
    return <DisabledRow label={item.label} />
  }

  if (item.type === 'group') {
    return (
      <div className="flex flex-col gap-1 pl-2">
        <span className="text-xs text-faint">{item.label}</span>
        {item.items.map((subItem) => (
          <NavLinkRow key={subItem.href} item={subItem} pathname={pathname} indent />
        ))}
      </div>
    )
  }

  return <NavLinkRow item={item} pathname={pathname} indent />
}

function NavLinkRow({ item, pathname, indent }: { item: NavLinkItem; pathname: string | null; indent?: boolean }) {
  const isActive = isNavLinkActive(pathname, item)
  return (
    <Link
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={`text-sm ${indent ? 'pl-2' : ''} ${isActive ? 'font-semibold text-accent' : ''}`}
    >
      {item.label}
    </Link>
  )
}

function DisabledRow({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 pl-2 text-sm text-faint">
      {label}
      <span className="rounded bg-surface-hover px-1 text-[10px] uppercase tracking-wide">Coming soon</span>
    </span>
  )
}
