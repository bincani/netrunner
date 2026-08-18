'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  NAV_STANDALONE_LINKS,
  NAV_GROUPS,
  isNavLinkActive,
  isNavGroupActive,
  type NavGroup,
  type NavItem,
  type NavLinkItem,
} from '@/lib/navStructure'

export function NavTopBar() {
  const pathname = usePathname()

  return (
    <>
      {NAV_STANDALONE_LINKS.map((link) => {
        const isActive = isNavLinkActive(pathname, link)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? 'page' : undefined}
            className={isActive ? 'font-semibold text-accent' : undefined}
          >
            {link.label}
          </Link>
        )
      })}

      {NAV_GROUPS.map((group) => (
        <GroupDropdown key={group.label} group={group} pathname={pathname} />
      ))}
    </>
  )
}

function GroupDropdown({ group, pathname }: { group: NavGroup; pathname: string | null }) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const isActive = isNavGroupActive(pathname, group)

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={`cursor-pointer ${isActive ? 'font-semibold text-accent' : ''}`}
      >
        {group.label} ▾
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-10 mt-2 min-w-48 rounded border border-default bg-surface py-1 shadow-lg"
        >
          {group.items.map((item) => (
            <GroupMenuItem key={item.label} item={item} pathname={pathname} onNavigate={() => setIsOpen(false)} />
          ))}
        </div>
      )}
    </div>
  )
}

function GroupMenuItem({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem
  pathname: string | null
  onNavigate: () => void
}) {
  if (item.type === 'disabled') {
    return (
      <span className="flex items-center gap-1.5 px-3 py-2 text-sm text-faint">
        {item.label}
        <span className="rounded bg-surface-hover px-1 text-[10px] uppercase tracking-wide">Coming soon</span>
      </span>
    )
  }

  if (item.type === 'group') {
    return (
      <div className="pt-1">
        <span className="block px-3 pt-1 text-xs text-faint">{item.label}</span>
        {item.items.map((subItem) => (
          <MenuLink key={subItem.href} item={subItem} pathname={pathname} onNavigate={onNavigate} indent />
        ))}
      </div>
    )
  }

  return <MenuLink item={item} pathname={pathname} onNavigate={onNavigate} />
}

function MenuLink({
  item,
  pathname,
  onNavigate,
  indent,
}: {
  item: NavLinkItem
  pathname: string | null
  onNavigate: () => void
  indent?: boolean
}) {
  const isActive = isNavLinkActive(pathname, item)
  return (
    <Link
      href={item.href}
      role="menuitem"
      aria-current={isActive ? 'page' : undefined}
      onClick={onNavigate}
      className={`block px-3 py-2 text-sm hover:bg-surface-hover ${indent ? 'pl-6' : ''} ${
        isActive ? 'font-semibold text-accent' : ''
      }`}
    >
      {item.label}
    </Link>
  )
}
