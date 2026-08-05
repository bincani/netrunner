// Official box-art images, downloaded locally from nullsignal.games/products/
// into public/set-images/ rather than hotlinked (unlike card images, this
// isn't a stable CDN with a predictable per-item URL — it's a WordPress
// media library, so we keep our own copy).
//
// Coverage is partial: only sets published by Null Signal Games (2020+)
// have official cover art available from that source. The ~60 older
// FFG-era sets (Core Set through the pre-System Gateway cycles) have no
// entry here and fall back to a placeholder in <SetThumbnail> — a better
// source for those is still being tracked down.
const SET_IMAGE_EXTENSIONS: Record<string, string> = {
  sg: 'png', // System Gateway
  elev: 'jpg', // Elevation
  vp: 'png', // Vantage Point
  rwr: 'png', // Rebellion Without Rehearsal
  tai: 'webp', // The Automata Initiative
  ph: 'png', // Parhelion
  ms: 'png', // Midnight Sun
  ur: 'png', // Uprising
  df: 'jpg', // Downfall
  su21: 'png', // System Update 2021
  mor: 'png', // Magnum Opus Reprint
  msbp: 'png', // Midnight Sun Booster Pack
  sc19: 'png', // System Core 2019
}

export function setImagePath(packCode: string): string | null {
  const ext = SET_IMAGE_EXTENSIONS[packCode]
  return ext ? `/set-images/${packCode}.${ext}` : null
}
