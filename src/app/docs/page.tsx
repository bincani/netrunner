import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Docs — Netrunner Collection Tracker',
}

const DOCS = [
  {
    href: '/docs/using-this-app',
    title: 'How to Use This App',
    description: 'A walkthrough of every page — building your collection, tracking decks, and finding what to build next.',
  },
  {
    href: '/docs/formats',
    title: 'Formats & Rules',
    description: "What each of Null Signal Games' 7 supported formats is, and what each card/deck legality status means.",
  },
]

export default function DocsIndexPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">Docs</h1>

      <div className="space-y-3">
        {DOCS.map((doc) => (
          <Link
            key={doc.href}
            href={doc.href}
            className="block rounded border border-subtle p-4 hover:border-accent hover:bg-surface-hover"
          >
            <h2 className="font-semibold text-primary">{doc.title}</h2>
            <p className="mt-1 text-sm text-muted">{doc.description}</p>
          </Link>
        ))}
      </div>
    </main>
  )
}
