import Link from 'next/link'
import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Netrunner Collection Tracker',
  description: 'Track your Android: Netrunner card collection',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <nav className="flex gap-6 border-b border-neutral-800 px-8 py-4">
          <Link href="/" className="font-semibold">
            Dashboard
          </Link>
          <Link href="/builder">Builder</Link>
        </nav>
        {children}
      </body>
    </html>
  )
}
