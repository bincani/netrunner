import './globals.css'
import type { Metadata } from 'next'
import { prisma } from '@/lib/db'
import { getDefaultCollection } from '@/lib/collections'
import { getNavStyle } from '@/actions/settingsMutations'
import { SettingsMenu } from '@/components/SettingsMenu'
import { NavTopBar } from '@/components/NavTopBar'
import { NavSidebar } from '@/components/NavSidebar'

export const metadata: Metadata = {
  title: 'Netrunner Collection Tracker',
  description: 'Track your Android: Netrunner card collection',
}

// Reflects the current default collection and Nav Style setting, both of
// which can change at runtime — not something to freeze into a build-time
// snapshot. See the dashboard's identical rationale. Applies to the whole
// app since every page shares this layout's nav.
export const dynamic = 'force-dynamic'

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [collection, navStyle] = await Promise.all([getDefaultCollection(prisma), getNavStyle(prisma)])

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-app text-primary">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {navStyle === 'sidebar' ? (
          <div className="flex min-h-screen">
            <NavSidebar />
            <div className="flex flex-1 flex-col">
              <div className="flex items-center justify-end gap-3 border-b border-subtle px-8 py-4">
                <span className="text-sm text-muted">{collection.name}</span>
                <SettingsMenu />
              </div>
              {children}
            </div>
          </div>
        ) : (
          <>
            <nav className="flex items-center justify-between border-b border-subtle px-8 py-4">
              <div className="flex items-center gap-6">
                <NavTopBar />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted">{collection.name}</span>
                <SettingsMenu />
              </div>
            </nav>
            {children}
          </>
        )}
      </body>
    </html>
  )
}
