'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const REPORTS = [
  { href: '/reports/sets-missing-image', label: 'Sets Missing Image' },
  { href: '/reports/under-owned-cards', label: 'Under-Owned Cards' },
]

export function ReportsNavDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const isActive = REPORTS.some((report) => report.href === pathname)

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
        Reports ▾
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-10 mt-2 min-w-48 rounded border border-default bg-surface py-1 shadow-lg"
        >
          {REPORTS.map((report) => {
            const itemActive = report.href === pathname
            return (
              <Link
                key={report.href}
                href={report.href}
                role="menuitem"
                aria-current={itemActive ? 'page' : undefined}
                onClick={() => setIsOpen(false)}
                className={`block px-3 py-2 text-sm hover:bg-surface-hover ${itemActive ? 'font-semibold text-accent' : ''}`}
              >
                {report.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
