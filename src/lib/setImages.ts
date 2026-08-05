// Official box-art images, downloaded locally rather than hotlinked (no
// single stable CDN covers every set — sources vary per pack, see the
// comments below) into public/set-images/.
//
// Coverage is partial. Most FFG-era sets (Core Set through the
// pre-System Gateway cycles) have no entry here yet and fall back to a
// placeholder in <SetThumbnail> — more are added as sources are found.
const SET_IMAGE_EXTENSIONS: Record<string, string> = {
  // nullsignal.games/products/
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

  // BoardGameGeek (cf.geekdo-images.com)
  dc: 'png', // Daedalus Complex
}

export function setImagePath(packCode: string): string | null {
  const ext = SET_IMAGE_EXTENSIONS[packCode]
  return ext ? `/set-images/${packCode}.${ext}` : null
}
