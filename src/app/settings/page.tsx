import { prisma } from '@/lib/db'
import { getHiddenBuilderPackCodes, getBuilderMode, getNavStyle } from '@/actions/settingsMutations'
import { SettingsForm } from './SettingsForm'

// Reflects live DB state (every pack, which ones are hidden, and the
// current Builder Mode / Nav Style) — not something to freeze into a
// build-time snapshot. See the dashboard's identical rationale.
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const [packs, hiddenPackCodes, builderMode, navStyle] = await Promise.all([
    prisma.pack.findMany({ orderBy: [{ cycle: { position: 'asc' } }, { position: 'asc' }] }),
    getHiddenBuilderPackCodes(prisma),
    getBuilderMode(prisma),
    getNavStyle(prisma),
  ])

  return (
    <main className="p-8 max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsForm
        packs={packs.map((pack) => ({ code: pack.code, name: pack.name }))}
        initialHiddenPackCodes={hiddenPackCodes}
        initialBuilderMode={builderMode}
        initialNavStyle={navStyle}
      />
    </main>
  )
}
