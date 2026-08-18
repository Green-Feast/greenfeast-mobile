/**
 * Upload the Home screen category-row icons (bowl/wrap/salad/toast/smoothie)
 * to Supabase Storage — square, transparent WebP, converted locally first by
 * scripts/compress_category_images.py.
 *
 * Run with:
 *   npx tsx scripts/upload-category-images.ts
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PHOTOS_DIR = path.join(__dirname, '..', 'assets', 'category_images')
const BUCKET = 'category-images'

// category key (matches CATEGORY_EMOJIS in src/constants/categories.ts) -> file
const FILES: Record<string, string> = {
  bowl: 'bowl_category.webp',
  wrap: 'wrap_category.webp',
  salad: 'salad_category.webp',
  toast: 'toast_category.webp',
  smoothie: 'smoothie_category.webp',
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

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

  const urls: Record<string, string> = {}

  for (const [category, filename] of Object.entries(FILES)) {
    const filePath = path.join(PHOTOS_DIR, filename)
    if (!fs.existsSync(filePath)) {
      console.warn(`  SKIP  ${filename} — file not found at ${filePath}`)
      continue
    }

    const fileBuffer = fs.readFileSync(filePath)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filename, fileBuffer, {
        contentType: 'image/webp',
        upsert: true,
        cacheControl: '31536000', // 1 year — icons rarely change
      })

    if (uploadError) {
      console.error(`  ERROR ${filename}: ${uploadError.message}`)
      continue
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filename)
    urls[category] = urlData.publicUrl
    console.log(`  OK    ${filename} -> ${urlData.publicUrl}`)
  }

  console.log('\nCATEGORY_IMAGES map for src/constants/categories.ts:\n')
  console.log(JSON.stringify(urls, null, 2))
}

main()
