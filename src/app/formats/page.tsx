import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Formats — Netrunner Collection Tracker',
}

const FORMATS = [
  {
    code: 'standard',
    name: 'Standard',
    description:
      'The flagship competitive format of Netrunner Organized Play. Rotates regularly to keep the meta fresh, and currently has a ban list (no restricted-list cards at the moment).',
  },
  {
    code: 'startup',
    name: 'Startup',
    description:
      "A limited-cardpool format for newcomers to organized play and players who want a smaller deckbuilding space. Includes System Gateway, Elevation, the most recent complete cycle, and the current in-progress cycle, plus restrictions on a handful of high-value Corp agendas.",
  },
  {
    code: 'eternal',
    name: 'Eternal',
    description:
      'The largest format — nearly every card ever printed, with no rotation. A small number of cards are banned outright; a wider list is assigned a points value (0–4), and each deck has a 7-point budget to spend on them.',
  },
  {
    code: 'core',
    name: 'Core',
    description:
      "System Gateway plus Elevation, combined — the current non-rotating starter card pool and the shared foundation Standard and Startup build on. No ban list.",
  },
  {
    code: 'system_gateway',
    name: 'System Gateway',
    description:
      "The original 2021 System Gateway starter box on its own, before Elevation existed — a narrower format for players who only own that first box.",
  },
  {
    code: 'snapshot',
    name: 'Snapshot',
    description:
      'A frozen snapshot of the competitive meta as of Magnum Opus 2018, the last Fantasy Flight Games organized-play event, with its own ban/restricted list. Rarely changes.',
  },
  {
    code: 'ram',
    name: 'Random Access Memories (RAM)',
    description:
      'A special format with a randomly-drawn card pool, decided by a livestreamed draw before each tournament. Regularly-scheduled RAM tournaments are currently on hiatus.',
  },
]

const STATUSES = [
  { code: 'legal', label: 'Legal', description: 'Allowed in this format, with no restriction.' },
  {
    code: 'not_in_pool',
    label: 'Not in pool',
    description:
      "Not part of this format's current card pool — not banned, just not included (for example, a card from a set the format doesn't cover).",
  },
  { code: 'banned', label: 'Banned', description: 'Not allowed in this format at all.' },
  {
    code: 'restricted',
    label: 'Restricted',
    description: "Allowed, but named on a format's restricted list rather than an outright ban.",
  },
  {
    code: 'universal_influence_penalty',
    label: 'Universal influence penalty',
    description: 'Allowed, but costs extra influence in every deck that includes it, regardless of faction.',
  },
  {
    code: 'points',
    label: 'Points',
    description: "Allowed, but costs points against Eternal's shared per-deck points budget.",
  },
]

export default function FormatsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Formats</h1>
        <p className="text-sm text-muted">
          Card and deck pages in this app show which of these formats a card or deck is
          currently legal in. That data comes from Null Signal Games and is computed each time
          you run the card import — it only checks card-pool and ban/restriction membership, not
          a full deck-construction check (no influence budget, deck size, or agenda point
          validation).
        </p>
      </div>

      <div className="space-y-3">
        {FORMATS.map((format) => (
          <div key={format.code} className="rounded border border-subtle p-4">
            <h2 className="font-semibold text-primary">{format.name}</h2>
            <p className="mt-1 text-sm text-muted">{format.description}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold text-primary">What the statuses mean</h2>
        <dl className="space-y-3">
          {STATUSES.map((status) => (
            <div key={status.code}>
              <dt className="text-sm font-semibold text-muted">{status.label}</dt>
              <dd className="text-sm text-muted">{status.description}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-sm text-muted">
        For the full, up-to-date official rules, see Null Signal Games&rsquo;{' '}
        <a
          href="https://nullsignal.games/players/supported-formats/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-primary"
        >
          Supported Formats
        </a>{' '}
        page.
      </p>
    </main>
  )
}
