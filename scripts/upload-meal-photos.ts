/**
 * Upload meal photos to Supabase Storage and update meal_templates.image_url
 *
 * Run with:
 *   npx ts-node --esm scripts/upload-meal-photos.ts
 * or:
 *   npx tsx scripts/upload-meal-photos.ts
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Set them in a .env.local file or export before running.
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PHOTOS_DIR = 'C:\\Users\\rudra\\Documents\\Greenfeast\\Assets\\Green Feast Salad Pics Professional shoot'
const BUCKET = 'meal-images'

// Map meal template ID → best matching photo filename in PHOTOS_DIR
// Update this mapping to swap to a better photo if needed.
const PHOTO_MAP: Record<string, string> = {
  'thai-zen-bowl':               'Thai (3).jpg',
  'italian-harvest-bowl':        'italian (1).jpg',
  'mexican-fiesta-bowl':         'Mexican Fiesta.jpg',
  'mediterranean-mezze-bowl':    'mediterranean.jpg',
  'japanese-umami-bowl':         'Umami Soba .jpg',
  'indian-spice-bowl':           'Jain.jpg',
  'korean-bibimbap-bowl':        'buddha.jpg',           // closest available
  'smoky-chipotle-wrap':         'mexican chipotle.jpg',
  'bbq-protein-wrap':            'BBQ Protien new.jpg',
  'mediterranean-falafel-wrap':  'hummus.jpg',
  'thai-peanut-wrap':            'thai (1).jpg',
  'greek-quinoa-salad':          'Quinoa Buddha (1).jpg',
  'asian-sesame-salad':          'cajun fusion.jpg',     // closest available
  'caesar-power-salad':          'Caesar.jpg',
  'moroccan-chickpea-salad':     'earthy hummus.jpg',    // closest available
  'avocado-smash-toast':         'Avo Feta.jpg',
  'egg-white-toast':             'pesto.jpg',            // closest available
  'green-detox-smoothie':        'chiawatermelon.jpg',
  'tropical-protein-smoothie':   'Tropical Fruit.jpg',
  'berry-blast-smoothie':        'Blueberry.png',
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Ensure bucket exists (public)
  const { data: buckets } = await supabase.storage.listBuckets()
  const exists = buckets?.some((b: any) => b.name === BUCKET)
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
    if (error) {
      console.error('Failed to create bucket:', error.message)
      process.exit(1)
    }
    console.log(`Created bucket: ${BUCKET}`)
  }

  for (const [mealId, filename] of Object.entries(PHOTO_MAP)) {
    const filePath = path.join(PHOTOS_DIR, filename)
    if (!fs.existsSync(filePath)) {
      console.warn(`  SKIP  ${mealId} — file not found: ${filename}`)
      continue
    }

    const ext = path.extname(filename).toLowerCase()
    const contentType = ext === '.png' ? 'image/png' : 'image/jpeg'
    const storageName = `${mealId}${ext}`

    const fileBuffer = fs.readFileSync(filePath)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storageName, fileBuffer, {
        contentType,
        upsert: true,
        // Default is 3600s (1 hour) — meal photos are effectively permanent,
        // so a short TTL just means every app re-open past the first hour
        // re-fetches the full image over the network instead of using the
        // disk cache expo-image already keeps client-side.
        cacheControl: '31536000',
      })

    if (uploadError) {
      console.error(`  ERROR ${mealId}: ${uploadError.message}`)
      continue
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storageName)
    const publicUrl = urlData.publicUrl

    const { error: updateError } = await supabase
      .from('meal_templates')
      .update({ image_url: publicUrl })
      .eq('id', mealId)

    if (updateError) {
      console.error(`  ERROR updating ${mealId}: ${updateError.message}`)
    } else {
      console.log(`  OK    ${mealId} → ${storageName}`)
    }
  }

  console.log('\nDone.')
}

main().catch(console.error)
