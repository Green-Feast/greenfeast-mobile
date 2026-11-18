import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { withTimeout } from '@/lib/withTimeout'

// One shape for every address form in the app (onboarding, Plan settings →
// address book). Saving never depends on Google: the city is always Jaipur
// (the server sets it from the pincode, migration 093) and the pincode is
// checked against `service_pincodes`, the one list of pincodes we deliver to.
//
// Google is only used to help fill the fields (Places pick, map pin, current
// location) and for the coordinates a delivery partner navigates to. Every
// field stays editable after a fill, because Google often has no house number.

export const SERVICE_CITY = 'Jaipur'
export const JAIPUR_CENTER = { lat: 26.9124, lng: 75.7873 }

export type LocationSource = 'places' | 'map' | 'gps' | 'manual'
export type AddressType = 'home' | 'office' | 'other'

export type AddressDraft = {
  line1: string
  line2: string
  landmark: string
  pincode: string
  lat: number | null
  lng: number | null
  placeId: string | null
  source: LocationSource | null
  type: AddressType
  label: string
}

export const EMPTY_ADDRESS: AddressDraft = {
  line1: '', line2: '', landmark: '', pincode: '',
  lat: null, lng: null, placeId: null, source: null,
  type: 'home', label: 'Home',
}

// Columns for an insert / update (city is set by the server from the pincode;
// it is sent too so an older server never sees a NULL).
export function addressRow(d: AddressDraft) {
  return {
    line1: d.line1.replace(/\s+/g, ' ').trim(),
    line2: d.line2.replace(/\s+/g, ' ').trim() || null,
    landmark: d.landmark.trim() || null,
    pincode: d.pincode,
    city: SERVICE_CITY,
    lat: d.lat,
    lng: d.lng,
    place_id: d.placeId,
    location_source: d.lat != null && d.lng != null ? (d.source ?? 'manual') : null,
    type: d.type,
    label: d.label.trim() || d.type.charAt(0).toUpperCase() + d.type.slice(1),
  }
}

export const ADDRESS_SELECT = 'id, line1, line2, landmark, city, pincode, label, type, is_default, lat, lng, place_id, location_source'

export type AddressRecord = {
  id: string
  line1: string
  line2: string | null
  landmark: string | null
  city: string
  pincode: string
  label: string
  type: AddressType
  is_default: boolean
  lat: number | null
  lng: number | null
  place_id: string | null
  location_source: LocationSource | 'admin' | null
}

export function draftFromRecord(a: AddressRecord): AddressDraft {
  return {
    line1: a.line1 ?? '',
    line2: a.line2 ?? '',
    landmark: a.landmark ?? '',
    pincode: (a.pincode ?? '').trim(),
    lat: a.lat, lng: a.lng,
    placeId: a.place_id,
    source: a.location_source === 'admin' ? 'manual' : a.location_source,
    type: a.type ?? 'home',
    label: a.label ?? 'Home',
  }
}

// Display: "12 Gandhi Path, Vaishali Nagar".
export function addressText(a: { line1?: string | null; line2?: string | null }) {
  return [a.line1, a.line2].map((s) => s?.trim()).filter(Boolean).join(', ')
}

/**
 * Onboarding: the customer's one default address, updated in place when it
 * exists (the address step and payment both call this, so a retry never makes
 * a second default). Returns the address id; throws the Supabase error.
 */
export async function saveDefaultAddress(userId: string, d: AddressDraft): Promise<string> {
  const { data: existing, error: findErr } = await supabase
    .from('addresses').select('id')
    .eq('user_id', userId).eq('is_default', true).is('archived_at', null)
    .maybeSingle()
  if (findErr) throw findErr
  const row = { ...addressRow(d), user_id: userId, is_default: true }
  if (existing) {
    const { error } = await supabase.from('addresses').update(row).eq('id', existing.id)
    if (error) throw error
    return existing.id
  }
  const { data, error } = await supabase.from('addresses').insert(row).select('id').single()
  if (error) throw error
  return data.id
}

// ── Pincodes we deliver to ────────────────────────────────────────────────

export type ServicePincode = { pincode: string; area: string }
let pincodeCache: Map<string, string> | null = null
let pincodeLoad: Promise<Map<string, string> | null> | null = null

function loadPincodes(): Promise<Map<string, string> | null> {
  if (pincodeCache) return Promise.resolve(pincodeCache)
  if (!pincodeLoad) {
    pincodeLoad = (async () => {
      try {
        const { data, error } = await withTimeout(
          supabase.from('service_pincodes').select('pincode, area').eq('is_active', true),
          10000, 'Pincodes')
        if (error || !data || data.length === 0) return null
        pincodeCache = new Map((data as ServicePincode[]).map((p) => [p.pincode, p.area]))
        return pincodeCache
      } catch {
        return null
      } finally {
        pincodeLoad = null
      }
    })()
  }
  return pincodeLoad
}

// The served pincodes (pincode → area), or null while loading / when they
// couldn't be fetched — then only the 6-digit format is checked here and the
// server has the last word.
export function useServicePincodes() {
  const [map, setMap] = useState<Map<string, string> | null>(pincodeCache)
  useEffect(() => {
    let live = true
    if (!pincodeCache) loadPincodes().then((m) => { if (live && m) setMap(m) })
    return () => { live = false }
  }, [])
  return map
}

export const PINCODE_OUTSIDE = 'We deliver only in Jaipur for now — this pincode is outside our area.'

export function pincodeError(pincode: string, served: Map<string, string> | null): string | null {
  if (!/^\d{6}$/.test(pincode)) return 'Enter your 6-digit pincode'
  if (served && !served.has(pincode)) return PINCODE_OUTSIDE
  return null
}

export function validateAddress(d: AddressDraft, served: Map<string, string> | null) {
  const e: Record<string, string> = {}
  if (d.line1.trim().length < 5) e.line1 = 'Enter your house / flat number and street'
  const pe = pincodeError(d.pincode, served)
  if (pe) e.pincode = pe
  return e
}

// True when line 1 seems to have a house / flat / plot number in it.
export function hasHouseNumber(line1: string) {
  return /\d/.test(line1)
}

// Roughly the Jaipur area (≈ 45 km around the city centre). A pin outside it
// is almost always a mis-tap or a phone that isn't at the address.
export function nearJaipur(lat: number, lng: number) {
  return Math.abs(lat - JAIPUR_CENTER.lat) < 0.4 && Math.abs(lng - JAIPUR_CENTER.lng) < 0.45
}

// ── Google address components → our fields ────────────────────────────────

export type AddressComponent = { long_name: string; short_name?: string; types: string[] }
export type ParsedAddress = { line1: string; line2: string; pincode: string | null; houseNumber: boolean }

const pick = (cs: AddressComponent[], type: string) => cs.find((c) => c.types?.includes(type))?.long_name?.trim() || ''
const uniq = (parts: string[]) => {
  const seen = new Set<string>()
  return parts.filter((p) => {
    const k = p.toLowerCase()
    if (!p || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Line 1 = house / flat (subpremise, premise, street number), the building or
 * place name, and the street. Line 2 = the area (neighbourhood, sub-localities).
 * Works for both Place Details and Geocoding results.
 */
export function parseComponents(
  components: AddressComponent[] | null | undefined,
  placeName?: string | null,
): ParsedAddress {
  const cs = components ?? []
  const subpremise = pick(cs, 'subpremise')
  const premise = pick(cs, 'premise')
  const streetNo = pick(cs, 'street_number')
  const route = pick(cs, 'route')
  const area = uniq([
    pick(cs, 'neighborhood'),
    pick(cs, 'sublocality_level_3'),
    pick(cs, 'sublocality_level_2'),
    pick(cs, 'sublocality_level_1'),
  ])
  const name = placeName?.trim() ?? ''
  // A place name that is just the area or the street adds nothing to line 1.
  const nameIsArea = !!name && [...area, route, pick(cs, 'locality')].some((a) => a && a.toLowerCase() === name.toLowerCase())
  const line1 = uniq([subpremise, premise, streetNo, nameIsArea ? '' : name, route]).join(', ')
  const postal = pick(cs, 'postal_code')
  return {
    line1,
    line2: area.filter((a) => !line1.toLowerCase().includes(a.toLowerCase())).join(', '),
    pincode: /^\d{6}$/.test(postal) ? postal : null,
    houseNumber: !!(subpremise || streetNo || /\d/.test(premise)),
  }
}

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY

/** Google reverse geocode of a map pin / current location. null when unknown. */
export async function reverseGeocode(lat: number, lng: number): Promise<ParsedAddress | null> {
  if (!KEY) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=en&key=${KEY}`
    const data = await withTimeout(fetch(url).then((r) => r.json()), 8000, 'Reverse geocoding')
    if (data.status !== 'OK') {
      if (data.status !== 'ZERO_RESULTS') console.warn('Reverse geocoding error:', data.status, data.error_message)
      return null
    }
    const results: { types: string[]; address_components: AddressComponent[] }[] = data.results ?? []
    // The most precise result first: a building, then a street address.
    const best =
      results.find((r) => r.types.some((t) => t === 'premise' || t === 'subpremise' || t === 'street_address'))
      ?? results.find((r) => r.types.includes('route'))
      ?? results[0]
    if (!best) return null
    const parsed = parseComponents(best.address_components)
    // Pincode: any result that has one (the precise one sometimes doesn't).
    if (!parsed.pincode) {
      for (const r of results) {
        const p = pick(r.address_components, 'postal_code')
        if (/^\d{6}$/.test(p)) { parsed.pincode = p; break }
      }
    }
    return parsed
  } catch (e) {
    console.warn('Reverse geocoding failed:', e)
    return null
  }
}
