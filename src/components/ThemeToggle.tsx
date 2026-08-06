'use client'

import { useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'netrunner-theme'

type Theme = 'light' | 'dark'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(THEME_STORAGE_KEY, theme)
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  }, [])

  function selectTheme(next: Theme) {
    setTheme(next)
    applyTheme(next)
  }

  return (
    <div className="flex gap-2">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => selectTheme(option.value)}
          className={`cursor-pointer rounded border px-3 py-1 text-sm ${
            theme === option.value
              ? 'border-blue-600 bg-blue-600/20 text-blue-400'
              : 'border-default hover:bg-surface-hover'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
