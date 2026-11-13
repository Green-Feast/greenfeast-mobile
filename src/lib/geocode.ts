import { withTimeout } from '@/lib/withTimeout'

// Shared Google Geocoding helpers. addresses.city is NOT NULL and GreenFeast is
// expanding beyond Jaipur, so the city is never hardcoded — it comes from the
// map pin, the Places autocomplete pick, or (last resort) the pincode, via the
// functions below. Plain REST like PlacesAutocomplete; the key comes from
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, which for OTA bundles is sourced from the
// EAS environment (see AGENTS.md gotchas). The Geocoding API must be enabled
// on that key.

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY

export type AddressComponent = {
  long_name: string
  short_name?: string
  types: string[]
}

// Google's address_components: `locality` is the city; in places where it is
// missing (some Indian towns / rural pincodes) the next administrative level
// down is the closest thing to one.
const CITY_TYPES = ['locality', 'administrative_area_level_3', 'administrative_area_level_2'] as const

export function cityFromAddressComponents(components: AddressComponent[] | null | undefined): string | null {
  if (!components) return null
  for (const type of CITY_TYPES) {
    const name = components.find((c) => c.types?.includes(type))?.long_name?.trim()
    if (name) return name
  }
  return null
}

// Looks up the city for an Indian 6-digit pincode. Returns null when it can't
// be worked out (bad pincode, no key, unknown pincode, API disabled / denied,
// network failure or timeout) — callers then ask the user to pin their
// location on the map instead.
export async function cityForPincode(pincode: string): Promise<string | null> {
  if (!/^\d{6}$/.test(pincode)) return null
  if (!KEY) {
    console.error('Geocoding skipped: EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set')
    return null
  }
  try {
    const components = encodeURIComponent(`postal_code:${pincode}|country:IN`)
    const url = `https://maps.googleapis.com/maps/api/geocode/json?components=${components}&key=${KEY}`
    const data = await withTimeout(fetch(url).then((res) => res.json()), 8000, 'Geocoding')
    if (data.status === 'ZERO_RESULTS') return null
    if (data.status !== 'OK') {
      // Most common cause: key missing "Geocoding API" or restricted to other APIs.
      console.error('Geocoding error:', data.status, data.error_message)
      return null
    }
    for (const result of data.results ?? []) {
      const city = cityFromAddressComponents(result.address_components)
      if (city) return city
    }
    return null
  } catch (e) {
    console.error('Geocoding request failed:', e)
    return null
  }
}
