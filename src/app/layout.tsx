import Link from 'next/link'
import Script from 'next/script'
import './globals.css'
import type { Metadata } from 'next'
import { ReportsNavDropdown } from '@/components/ReportsNavDropdown'

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
    <html lang="en">
      <body className="min-h-screen bg-app text-primary">
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <nav className="flex gap-6 border-b border-subtle px-8 py-4">
          <Link href="/" className="font-semibold">
            Dashboard
          </Link>
          <Link href="/builder">Builder</Link>
          <ReportsNavDropdown />
        </nav>
        {children}
      </body>
    </html>
  )
}
