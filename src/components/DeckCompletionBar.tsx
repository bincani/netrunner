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
      <div className="h-2 rounded bg-default">
        <div
          className="h-2 rounded bg-success"
          style={{
            width: `${percentOwned}%`,
            ...(percentOwned < 100 && {
              backgroundImage:
                'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(0,0,0,0.3) 3px, rgba(0,0,0,0.3) 6px)',
            }),
          }}
        />
      </div>
    </>
  )
}
