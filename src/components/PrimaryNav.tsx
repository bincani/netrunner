'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Dashboard', exact: true },
  { href: '/builder', label: 'Builder', exact: false },
  { href: '/decks', label: 'Decks', exact: false },
  { href: '/discover', label: 'Discover', exact: false },
]

export function PrimaryNav() {
  const pathname = usePathname()

  return (
    <>
      {LINKS.map((link) => {
        const isActive = link.exact ? pathname === link.href : pathname === link.href || pathname?.startsWith(`${link.href}/`)
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
    </>
  )
}
