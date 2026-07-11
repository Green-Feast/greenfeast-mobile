// External links used by the Menu screen's "craving it right now?" footer
// and Home's referral card. Swap the TODO placeholders for the real URLs —
// each button hides itself until its own link is configured, so nothing
// broken ships in the meantime.

export const SWIGGY_URL = 'https://www.swiggy.com/menu/1073025?source=sharing'
export const ZOMATO_URL = 'https://zomato.onelink.me/xqzv/2vb7t8lf'
export const KITCHEN_MAPS_URL = 'TODO'

export function isConfigured(url: string): boolean {
  return !!url && !url.includes('TODO')
}

export const REFERRAL_MESSAGE =
  "I've been getting my meals from GreenFeast — fresh, macro-balanced food delivered daily in Jaipur. Thought you'd like it too: https://greenfeast.in"
