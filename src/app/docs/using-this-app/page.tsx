import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'How to Use This App — Netrunner Collection Tracker',
}

const SECTIONS = [
  {
    title: 'Dashboard',
    body: (
      <>
        <p>
          The home page shows your overall completion percentage and a per-set, per-cycle
          breakdown of what you own. If you have more than one collection, use the switcher next
          to the title to change which one is active.
        </p>
        <p>
          Click a set&rsquo;s name to open its Set Browser. If you know you own a set completely
          (or almost completely), use the small add-icon next to it to quick-add the whole set in
          one step instead of searching for each card — it warns you before overwriting anything
          you&rsquo;ve already logged, and can be undone right after.
        </p>
        <p>&ldquo;Export CSV&rdquo; downloads your current collection as a spreadsheet.</p>
      </>
    ),
  },
  {
    title: 'Collection Builder',
    body: (
      <>
        <p>
          Search for a card and add copies you own. There are two modes, set on{' '}
          <Link href="/settings" className="underline hover:text-primary">
            Settings
          </Link>
          :
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-primary">Simple</strong> — search, pick a quantity (1&ndash;4),
            and Add immediately increments what you own of that printing.
          </li>
          <li>
            <strong className="text-primary">Batch</strong> — stage a sorting session: add cards
            to the batch as you go through a physical pile, then Review it when you&rsquo;re done
            to Approve everything into your collection at once, or Discard the whole batch. Handy
            for logging a big pickup without committing card-by-card. An in-progress batch always
            takes over the Builder page, regardless of which mode is set.
          </li>
        </ul>
      </>
    ),
  },
  {
    title: 'Set Browser',
    body: (
      <p>
        Shows every card in a set, with what you own vs. what&rsquo;s missing. Quantities here can
        be corrected directly — typing a number overwrites the count rather than adding to it, and
        isn&rsquo;t capped at 4, since physical ownership can exceed a normal playset.
      </p>
    ),
  },
  {
    title: 'Decks',
    body: (
      <p>
        Paste a NetrunnerDB decklist URL or ID to import it and track how much of it you own, card
        by card and overall. Each imported deck also shows a per-format legality badge row — see{' '}
        <Link href="/docs/formats" className="underline hover:text-primary">
          Formats & Rules
        </Link>{' '}
        for what those mean.
      </p>
    ),
  },
  {
    title: 'Discover',
    body: (
      <p>
        Browse a large pool of real tournament decklists to find what you could build with your
        current collection. Filter by name, faction, and ownership, sort by how close a deck is to
        complete, and save any deck you like to My Decks.
      </p>
    ),
  },
  {
    title: 'Card details',
    body: (
      <p>
        Click any card&rsquo;s thumbnail or name anywhere in the app to open its detail popup. The{' '}
        <strong className="text-primary">Card Info</strong> tab has its full text, stats, owned
        quantity, and other printings; the{' '}
        <strong className="text-primary">Format</strong> tab shows its legality in every tracked
        format.
      </p>
    ),
  },
  {
    title: 'Settings',
    body: (
      <p>
        Switch between light/dark theme and Nav Style (top bar or sidebar), set your default
        Builder mode, and hide specific sets from Builder search results (e.g. ones you&rsquo;ll
        never own or don&rsquo;t want to log yet).
      </p>
    ),
  },
  {
    title: 'Collections',
    body: (
      <p>
        Manage multiple named collections and choose which one is active, from the Collection
        group in the nav. Useful if you track more than one physical collection separately.
      </p>
    ),
  },
  {
    title: 'Reports',
    body: (
      <p>
        Reports lives under Cards in the nav. It currently has one report: cards you own fewer
        than a full playset of.
      </p>
    ),
  },
]

export default function UsingThisAppPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">
          <Link href="/docs" className="text-muted hover:text-primary hover:underline">
            Docs
          </Link>
          <span className="text-faint"> {'>'} </span>
          How to Use This App
        </h1>
        <p className="text-sm text-muted">
          This is a personal, local tool for tracking a physical Android: Netrunner collection —
          no login, no cloud sync, just this browser talking to a database on this machine.
        </p>
      </div>

      <div className="space-y-6">
        {SECTIONS.map((section) => (
          <section key={section.title} className="space-y-2">
            <h2 className="text-lg font-semibold text-primary">{section.title}</h2>
            <div className="space-y-2 text-sm text-muted">{section.body}</div>
          </section>
        ))}
      </div>
    </main>
  )
}
