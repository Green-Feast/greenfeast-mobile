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

import { APP_VERSION_STRING } from '@/constants/version'

export const SUPPORT_WHATSAPP_NUMBER = '918829040566'
export const SUPPORT_PHONE_DISPLAY = '+91 88290 40566'
export const SUPPORT_EMAIL = 'greenfeast.tech@gmail.com'
export const OPS_EMAIL = 'greenfeast.ops@gmail.com'
export const BUSINESS_NAME = 'Green Feast'
export const BUSINESS_OPERATOR = 'Vinayak Rawat (proprietor)'
export const BUSINESS_ADDRESS = '3 NA 22, Jawahar Nagar, Jaipur, Rajasthan 302004'
export const BUSINESS_GSTIN = '08EGCPR0910Q1Z0'
// FSSAI rules require the licence number wherever food is sold online. Shown
// on the Contact Us page once filled in.
export const FSSAI_LICENSE = 'TODO'

// Every WhatsApp support entry point goes through here so the team can tell
// at a glance that the chat started inside the app. `topic` says which screen
// or action it came from.
export function supportWhatsAppUrl(topic = 'General support'): string {
  const text =
    `Hi GreenFeast! I'm messaging from the GreenFeast app (v${APP_VERSION_STRING}).\n` +
    `Topic: ${topic}\n\n` +
    `Please describe your question below:\n`
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`
}

export const REFERRAL_MESSAGE =
  "I've been getting my meals from GreenFeast — fresh, macro-balanced food delivered daily in Jaipur. Thought you'd like it too: https://greenfeast.in"
