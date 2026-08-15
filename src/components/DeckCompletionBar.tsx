export function DeckCompletionBar({
  ownedCount,
  totalCount,
  percentOwned,
}: {
  ownedCount: number
  totalCount: number
  percentOwned: number
}) {
  return (
    <>
      <p className="text-sm text-muted">
        {ownedCount}/{totalCount} owned ({percentOwned}%)
      </p>
      <div className="h-2 rounded bg-subtle">
        <div className="h-2 rounded bg-blue-600" style={{ width: `${percentOwned}%` }} />
      </div>
    </>
  )
}
