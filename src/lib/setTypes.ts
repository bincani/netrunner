// Official set-type classification, sourced from NetrunnerDB's v2 data
// (card_set_types.json) during import — see src/lib/importData.ts. Not
// guessed from pack size: e.g. Vantage Point (66 cards) and Data and
// Destiny (55 cards) are both "deluxe" despite the size difference, and
// most modern NSG releases (Downfall, Uprising, Midnight Sun, ...) are
// officially "data_pack" even though they're much larger than the old
// 20-card FFG data packs.
export interface SetTypeInfo {
  label: string
  className: string
}

export const SET_TYPES: Record<string, SetTypeInfo> = {
  core: { label: 'Core', className: 'border-blue-700 bg-blue-600/20 text-blue-400' },
  data_pack: { label: 'Data Pack', className: 'border-neutral-500 bg-neutral-600/20 text-neutral-300' },
  deluxe: { label: 'Deluxe', className: 'border-purple-700 bg-purple-600/20 text-purple-400' },
  expansion: { label: 'Expansion', className: 'border-teal-700 bg-teal-600/20 text-teal-400' },
  booster_pack: { label: 'Booster Pack', className: 'border-amber-700 bg-amber-600/20 text-amber-400' },
  campaign: { label: 'Campaign', className: 'border-orange-700 bg-orange-600/20 text-orange-400' },
  draft: { label: 'Draft', className: 'border-neutral-600 bg-neutral-700/40 text-neutral-500' },
  promo: { label: 'Promo', className: 'border-pink-700 bg-pink-600/20 text-pink-400' },
}

export function setTypeInfo(setType: string | null): SetTypeInfo | null {
  if (!setType) return null
  return SET_TYPES[setType] ?? null
}
