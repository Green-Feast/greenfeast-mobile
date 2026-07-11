// Editable Home-screen content. Swap in real farm/kitchen/delivery photography
// here whenever it's available — nothing else needs to change.

export type StorySlide = {
  image: any
  eyebrow: string
  title: string
  body: string
}

export const STORY_SLIDES: StorySlide[] = [
  {
    image: require('@/assets/food/italian-harvest.jpg'),
    eyebrow: 'FARM',
    title: 'It starts in the fields.',
    body: 'Vegetables and grains sourced from growers around Jaipur, picked for what\'s actually in season — not what\'s convenient.',
  },
  {
    image: require('@/assets/food/mexican-fiesta.jpg'),
    eyebrow: 'KITCHEN',
    title: 'Cooked this morning.',
    body: "Every meal is prepared fresh in our Jaipur kitchen the same day it's delivered — no cold storage, no shortcuts.",
  },
  {
    image: require('@/assets/food/thai-zen.jpg'),
    eyebrow: 'DOOR',
    title: 'Straight to you, still warm.',
    body: 'Packed and out for delivery within hours of leaving the kitchen — before 1 PM for lunch, every weekday.',
  },
  {
    image: require('@/assets/food/umami-soba.jpg'),
    eyebrow: 'YOU',
    title: 'Nutrition, considered.',
    body: 'Every bowl is built around real macros — fuel for your goals, not just another meal to get through the day.',
  },
]

// Short rotating notes, picked by day-of-year so they change daily without
// any backend. Caveat script font, small card — a lightweight "someone's
// actually running this kitchen" touch.
export const CHEF_NOTES: string[] = [
  "Today's spinach came in from Chomu this morning — went straight into the saag bowls.",
  "We're testing a new peanut-lime dressing this week. Tell us what you think!",
  'Fun fact: our quinoa is soaked overnight, never boiled straight from dry.',
  "The tomatoes this week are unusually good — local, vine-ripened, worth the wait.",
  'Every batch of paneer is made in-house, twice a week.',
  "If your bowl tastes different today, it's because the season changed — not a mistake.",
  'We hand-toast our spice mixes every morning. No pre-mixed masalas here.',
  "Coriander's having a moment this week — it's in almost everything, sorry not sorry.",
  'Our rotation avoids repeating a dish for 12+ days straight. Boredom is not on the menu.',
  'Someone asked for more heat in the Thai bowl — done. Try it this week.',
]
