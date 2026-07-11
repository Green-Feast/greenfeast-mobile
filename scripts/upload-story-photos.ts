/**
 * Upload the Home screen story-carousel photos (farm/kitchen/door/you) to
 * Supabase Storage, with a long cache lifetime so expo-image's disk cache
 * actually sticks between app sessions (see upload-meal-photos.ts for the
 * same fix applied to meal photos — default cacheControl is 1 hour, which
 * forces a full re-download almost every time the app is reopened).
 *
 * Run with:
 *   npx tsx scripts/upload-story-photos.ts
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PHOTOS_DIR = path.join(__dirname, '..', 'assets', 'images')
const BUCKET = 'story-images'

// Filenames must match src/constants/homeContent.ts's STORY_SLIDES order.
const FILES = ['farm.png', 'kitchen.png', 'door.png', 'you.png']

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

  // Ensure bucket exists (public) — separate from meal-images since these
  // are marketing/story content, not dish photos.
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

  for (const filename of FILES) {
    const filePath = path.join(PHOTOS_DIR, filename)
    if (!fs.existsSync(filePath)) {
      console.warn(`  SKIP  ${filename} — file not found at ${filePath}`)
      continue
    }

    const fileBuffer = fs.readFileSync(filePath)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filename, fileBuffer, {
        contentType: 'image/png',
        upsert: true,
        cacheControl: '31536000', // 1 year — these rarely change
      })

    if (uploadError) {
      console.error(`  ERROR ${filename}: ${uploadError.message}`)
      continue
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filename)
    console.log(`  OK    ${filename} → ${urlData.publicUrl}`)
  }

  console.log('\nDone. src/constants/homeContent.ts is already wired to these exact URLs.')
}

main()
