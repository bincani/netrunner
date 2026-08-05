import { prisma } from '@/lib/db'
import { listPacksMissingImage, releaseYear } from '@/lib/reports'

// Depends on live DB state (which packs exist) and reflects source-file
// changes to setImages.ts — not something to freeze into a build-time
// snapshot. See the dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function SetsMissingImageReportPage() {
  const packs = await listPacksMissingImage(prisma)

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Sets Missing Image</h1>
        <p className="text-neutral-400">
          {packs.length === 0
            ? 'Every set has a cover image.'
            : `${packs.length} set${packs.length === 1 ? '' : 's'} with no cover image yet — names below are selectable to copy/paste into a search.`}
        </p>
      </div>

      {packs.length > 0 && (
        <ul className="space-y-1 font-mono text-sm">
          {packs.map((pack) => {
            const year = releaseYear(pack.dateRelease)
            return (
              <li
                key={pack.packCode}
                className="flex items-center justify-between gap-4 rounded border border-neutral-800 px-3 py-2"
              >
                <span>
                  {pack.packName}
                  {year && <span className="text-neutral-500"> ({year})</span>}
                </span>
                <span className="shrink-0 text-neutral-600">{pack.cycleName}</span>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
