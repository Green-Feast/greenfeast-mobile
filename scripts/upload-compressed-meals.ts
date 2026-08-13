/**
 * Upload compressed WebP meal photos to Supabase Storage and update meal_templates.image_url
 *
 * Run with:
 *   $env:SUPABASE_URL="https://amwwjcwoumhbdxaxvexj.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="<key>"
 *   npx tsx scripts/upload-compressed-meals.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// Never hardcode a fallback for either of these — a service key committed to the
// repo grants full RLS-bypassing read/write on the whole database.
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const COMPRESSED_DIR = path.join(__dirname, '..', 'assets', 'food_compressed')
const LOCAL_FOOD_DIR = path.join(__dirname, '..', 'assets', 'food')
const BUCKET = 'meal-images'

// Map meal template ID -> photo filename (without extension)
const PHOTO_MAP: Record<string, string> = {
  'thai-zen-bowl':               'Thai (3)',
  'italian-harvest-bowl':        'italian (1)',
  'mexican-fiesta-bowl':         'Mexican Fiesta',
  'mediterranean-mezze-bowl':    'mediterranean',
  'japanese-umami-bowl':         'Umami Soba ',
  'indian-spice-bowl':           'Jain',
  'korean-bibimbap-bowl':        'buddha',
  'smoky-chipotle-wrap':         'mexican chipotle',
  'bbq-protein-wrap':            'BBQ Protien new',
  'mediterranean-falafel-wrap':  'hummus',
  'thai-peanut-wrap':            'thai (1)',
  'greek-quinoa-salad':          'Quinoa Buddha (1)',
  'asian-sesame-salad':          'cajun fusion',
  'caesar-power-salad':          'Caesar',
  'moroccan-chickpea-salad':     'earthy hummus',
  'avocado-smash-toast':         'Avo Feta',
  'egg-white-toast':             'pesto',
  'green-detox-smoothie':        'chiawatermelon',
  'tropical-protein-smoothie':   'Tropical Fruit',
  'berry-blast-smoothie':        'Blueberry',
}

// Fallback local webp mappings if professional shoot file doesn't exist
const LOCAL_FALLBACK_MAP: Record<string, string> = {
  'thai-zen-bowl':               'thai-zen.webp',
  'italian-harvest-bowl':        'italian-harvest.webp',
  'mexican-fiesta-bowl':         'mexican-fiesta.webp',
  'mediterranean-mezze-bowl':    'mediterranean-bliss.webp',
  'japanese-umami-bowl':         'umami-soba.webp',
  'indian-spice-bowl':           'quinoa-buddha.webp',
  'korean-bibimbap-bowl':        'quinoa-buddha.webp',
  'smoky-chipotle-wrap':         'mexican-fiesta.webp',
  'bbq-protein-wrap':            'burrito-bowl.webp',
  'mediterranean-falafel-wrap':  'mediterranean-bliss.webp',
  'thai-peanut-wrap':            'thai-zen.webp',
  'greek-quinoa-salad':          'quinoa-buddha.webp',
  'asian-sesame-salad':          'thai-zen.webp',
  'caesar-power-salad':          'avo-protein.webp',
  'moroccan-chickpea-salad':     'quinoa-buddha.webp',
  'avocado-smash-toast':         'avo-protein.webp',
  'egg-white-toast':             'avo-protein.webp',
  'green-detox-smoothie':        'avo-protein.webp',
  'tropical-protein-smoothie':   'avo-protein.webp',
  'berry-blast-smoothie':        'avo-protein.webp',
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

  for (const [mealId, baseName] of Object.entries(PHOTO_MAP)) {
    let filePath = path.join(COMPRESSED_DIR, `${baseName}.webp`)
    if (!fs.existsSync(filePath)) {
      const fallbackFile = LOCAL_FALLBACK_MAP[mealId]
      if (fallbackFile) {
        filePath = path.join(LOCAL_FOOD_DIR, fallbackFile)
      }
    }

    if (!fs.existsSync(filePath)) {
      console.warn(`  SKIP  ${mealId} — file not found at ${filePath}`)
      continue
    }

    const storageName = `${mealId}.webp`
    const fileBuffer = fs.readFileSync(filePath)
    const sizeKb = (fileBuffer.length / 1024).toFixed(1)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storageName, fileBuffer, {
        contentType: 'image/webp',
        upsert: true,
        cacheControl: '31536000', // 1 year cache
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
      console.error(`  ERROR updating DB for ${mealId}: ${updateError.message}`)
    } else {
      console.log(`  OK    ${mealId} (${sizeKb} KB) -> ${publicUrl}`)
    }
  }

  console.log('\nAll compressed meal images uploaded and updated successfully!')
}

main().catch(console.error)
