// Corp vs runner, colored to match the real cards' backs (blue for Corp,
// red for Runner) so it reads at a glance in card listings/search results
// where the side isn't otherwise visually obvious.
export interface SideTypeInfo {
  label: string
  className: string
  /** Solid border color only, for elements (like a set-view card row) that need a stronger border rather than a small badge. */
  borderClassName: string
  /** Solid text color only, for elements (like a currentColor-filled icon) that need just the color, not a full badge. */
  textClassName: string
}

export const SIDE_TYPES: Record<string, SideTypeInfo> = {
  corp: {
    label: 'Corp',
    className: 'border-blue-700 bg-blue-600/20 text-blue-400',
    borderClassName: 'border-blue-600',
    textClassName: 'text-blue-600',
  },
  runner: {
    label: 'Runner',
    className: 'border-red-700 bg-red-600/20 text-red-400',
    borderClassName: 'border-red-600',
    textClassName: 'text-red-600',
  },
}

export function sideTypeInfo(sideCode: string | null): SideTypeInfo | null {
  if (!sideCode) return null
  return SIDE_TYPES[sideCode] ?? null
}
