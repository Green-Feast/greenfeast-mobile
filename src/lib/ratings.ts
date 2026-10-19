import { Platform } from 'react-native'
import { supabase } from '@/lib/supabase'
import { istToday, addDaysISO } from '@/lib/ist'
import { APP_VERSION_STRING } from '@/constants/version'

// Meal ratings and app feedback (migration 064). Every write goes through a
// database function that checks it's the customer's own delivered meal from
// the last 7 days; the office sees it all in admin → Feedback.

export type Slot = 'lunch' | 'dinner'
export type RatingSource = 'app' | 'push' | 'history'

export type RatingPrompt = {
  date: string
  slot: Slot
  dishNames: string
  image: string | null
}

export type MealRating = { stars: number; tags: string[]; comment: string | null }

export const RATE_WINDOW_DAYS = 7
export const STAR_COLOR = '#E5A50A'
export const STAR_WORDS = ['', 'Terrible', 'Bad', 'Okay', 'Good', 'Loved it']

// Chip keys are fixed in the database (rating_tag_keys()).
export const BAD_TAGS = [
  { key: 'taste', label: 'Taste' },
  { key: 'portion', label: 'Portion size' },
  { key: 'cold', label: 'Cold' },
  { key: 'late', label: 'Late' },
  { key: 'packaging', label: 'Spilled / packaging' },
  { key: 'wrong_item', label: 'Wrong or missing item' },
  { key: 'oily_spicy', label: 'Too oily / spicy' },
  { key: 'not_fresh', label: 'Not fresh' },
]
export const GOOD_TAGS = [
  { key: 'taste', label: 'Taste' },
  { key: 'portion', label: 'Portion size' },
  { key: 'fresh', label: 'Fresh' },
  { key: 'on_time', label: 'On time' },
  { key: 'packaging', label: 'Packaging' },
  { key: 'healthy', label: 'Healthy' },
  { key: 'value', label: 'Value for money' },
]

export function tagsFor(stars: number) {
  return stars >= 4 ? GOOD_TAGS : BAD_TAGS
}

export function canStillRate(date: string) {
  return date >= addDaysISO(istToday(), -RATE_WINDOW_DAYS)
}

// "How was your lunch?" / "How was yesterday's dinner?" / "How was your lunch on Fri, 17 Oct?"
export function mealQuestion(date: string, slot: Slot) {
  const today = istToday()
  if (date === today) return `How was your ${slot}?`
  if (date === addDaysISO(today, -1)) return `How was yesterday's ${slot}?`
  const day = new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `How was your ${slot} on ${day}?`
}

// "Not now" on the Home card: no card again for a while this session, so the
// next meal's card doesn't pop up straight after.
let snoozedUntil = 0
export function snoozePrompt(hours = 3) {
  snoozedUntil = Date.now() + hours * 3600_000
}
export function promptSnoozed() {
  return Date.now() < snoozedUntil
}

type PromptRpc = { date: string; slot: Slot; dish_names: string; dishes: { id: string; name: string; image: string | null }[] } | null

// The meal Home should ask about (records that it was asked), or null.
export async function fetchRatingPrompt(): Promise<RatingPrompt | null> {
  const { data, error } = await supabase.rpc('my_rating_prompt')
  if (error) throw error
  return toPrompt(data as PromptRpc)
}

export function toPrompt(p: PromptRpc): RatingPrompt | null {
  if (!p) return null
  return {
    date: p.date,
    slot: p.slot,
    dishNames: p.dish_names || p.dishes.map((d) => d.name).join(' + ') || 'Your meal',
    image: p.dishes.find((d) => d.image)?.image ?? null,
  }
}

// What was delivered for a date + slot, and any rating already given — for a
// rating opened from a push.
export async function fetchMealForRating(userId: string, date: string, slot: Slot): Promise<{ meal: RatingPrompt | null; existing: MealRating | null }> {
  const [{ data: orders }, { data: rating }] = await Promise.all([
    supabase
      .from('orders')
      .select('meal_templates ( name, image_url, thumb_url )')
      .eq('user_id', userId)
      .eq('delivery_date', date)
      .eq('meal_slot', slot)
      .eq('status', 'delivered'),
    supabase
      .from('meal_ratings')
      .select('stars, tags, comment')
      .eq('user_id', userId)
      .eq('delivery_date', date)
      .eq('meal_slot', slot)
      .maybeSingle(),
  ])
  const dishes = ((orders ?? []) as unknown as { meal_templates: { name: string; image_url: string | null; thumb_url: string | null } | null }[])
    .map((o) => o.meal_templates)
    .filter((m): m is NonNullable<typeof m> => !!m)
  const meal = dishes.length
    ? {
        date,
        slot,
        dishNames: [...new Set(dishes.map((d) => d.name))].join(' + '),
        image: dishes.map((d) => d.thumb_url ?? d.image_url).find(Boolean) ?? null,
      }
    : null
  const r = rating as { stars: number | null; tags: string[] | null; comment: string | null } | null
  return { meal, existing: r?.stars ? { stars: r.stars, tags: r.tags ?? [], comment: r.comment } : null }
}

// Own ratings for Order history: "date|slot" → rating.
export async function fetchMyRatings(userId: string, fromDate: string): Promise<Map<string, MealRating>> {
  const { data } = await supabase
    .from('meal_ratings')
    .select('delivery_date, meal_slot, stars, tags, comment')
    .eq('user_id', userId)
    .gte('delivery_date', fromDate)
    .not('stars', 'is', null)
  const map = new Map<string, MealRating>()
  for (const r of (data ?? []) as { delivery_date: string; meal_slot: Slot; stars: number; tags: string[] | null; comment: string | null }[]) {
    map.set(`${r.delivery_date}|${r.meal_slot}`, { stars: r.stars, tags: r.tags ?? [], comment: r.comment })
  }
  return map
}

export async function rateMeal(input: { date: string; slot: Slot; stars: number; tags: string[]; comment: string; source: RatingSource }) {
  const { error } = await supabase.rpc('rate_meal', {
    p_date: input.date,
    p_slot: input.slot,
    p_stars: input.stars,
    p_tags: input.tags,
    p_comment: input.comment.trim() || null,
    p_source: input.source,
  })
  if (error) throw new Error(error.message || 'Could not save your rating. Please try again.')
}

export async function dismissRatingPrompt(date: string, slot: Slot) {
  await supabase.rpc('dismiss_rating_prompt', { p_date: date, p_slot: slot })
}

export type FeedbackKind = 'idea' | 'problem' | 'praise' | 'other'

export async function sendFeedback(kind: FeedbackKind, message: string) {
  const { error } = await supabase.rpc('send_app_feedback', {
    p_kind: kind,
    p_message: message.trim(),
    p_app_version: APP_VERSION_STRING,
    p_platform: Platform.OS,
  })
  if (error) throw new Error(error.message || 'Could not send your feedback. Please try again.')
}
