import Link from 'next/link'
import './globals.css'
import type { Metadata } from 'next'
import { ReportsNavDropdown } from '@/components/ReportsNavDropdown'
import { SettingsMenu } from '@/components/SettingsMenu'

export const metadata: Metadata = {
  title: 'Netrunner Collection Tracker',
  description: 'Track your Android: Netrunner card collection',
}

const THEME_INIT_SCRIPT = `
try {
  var theme = localStorage.getItem('netrunner-theme');
  if (theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
} catch (e) {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-app text-primary">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <nav className="flex items-center justify-between border-b border-subtle px-8 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold">
              Dashboard
            </Link>
            <Link href="/builder">Builder</Link>
            <Link href="/decks">Decks</Link>
            <ReportsNavDropdown />
          </div>
          <SettingsMenu />
        </nav>
        {children}
      </body>
    </html>
  )
}
