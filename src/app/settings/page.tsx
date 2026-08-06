import { prisma } from '@/lib/db'
import { getHiddenBuilderPackCodes } from '@/actions/settingsMutations'
import { SettingsForm } from './SettingsForm'

// Reflects live DB state (every pack, and which ones are currently
// hidden) — not something to freeze into a build-time snapshot. See the
// dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const [packs, hiddenPackCodes] = await Promise.all([
    prisma.pack.findMany({ orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }] }),
    getHiddenBuilderPackCodes(prisma),
  ])

  return (
    <main className="p-8 max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsForm
        packs={packs.map((pack) => ({ code: pack.code, name: pack.name }))}
        initialHiddenPackCodes={hiddenPackCodes}
      />
    </main>
  )
}
