'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const REPORTS = [{ href: '/reports/sets-missing-image', label: 'Sets Missing Image' }]

export function ReportsNavDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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
        className="cursor-pointer"
      >
        Reports ▾
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-10 mt-2 min-w-48 rounded border border-neutral-700 bg-neutral-900 py-1 shadow-lg"
        >
          {REPORTS.map((report) => (
            <Link
              key={report.href}
              href={report.href}
              role="menuitem"
              onClick={() => setIsOpen(false)}
              className="block px-3 py-2 text-sm hover:bg-neutral-800"
            >
              {report.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
