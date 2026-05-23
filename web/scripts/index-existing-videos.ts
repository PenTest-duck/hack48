#!/usr/bin/env npx ts-node --esm
/**
 * One-time script: indexes all existing submissions into TwelveLabs.
 * Run from the web/ directory:
 *   npx ts-node --esm scripts/index-existing-videos.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceKey)
const indexVideoUrl = `${supabaseUrl}/functions/v1/index-video`

async function main() {
  console.log('Fetching all submissions…')
  const { data: submissions, error } = await admin
    .from('submissions')
    .select('id, storage_path, metadata')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Failed to fetch submissions:', error.message)
    process.exit(1)
  }

  if (!submissions?.length) {
    console.log('No submissions found.')
    return
  }

  console.log(`Found ${submissions.length} submission(s). Starting indexing…\n`)

  let succeeded = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < submissions.length; i++) {
    const sub = submissions[i]
    const meta = sub.metadata as Record<string, unknown> | null
    const prefix = `[${i + 1}/${submissions.length}] ${sub.id}`

    // Skip if already indexed
    if (meta?.twelvelabs_task_id) {
      console.log(`${prefix} — skipped (already indexed: ${meta.twelvelabs_task_id})`)
      skipped++
      continue
    }

    try {
      const res = await fetch(indexVideoUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ submission_id: sub.id, storage_path: sub.storage_path }),
      })

      if (res.ok) {
        const body = await res.json()
        console.log(`${prefix} — indexed (task: ${body.twelvelabs_task_id})`)
        succeeded++
      } else {
        const text = await res.text()
        console.error(`${prefix} — FAILED (${res.status}): ${text}`)
        failed++
      }
    } catch (err) {
      console.error(`${prefix} — ERROR: ${(err as Error).message}`)
      failed++
    }
  }

  console.log(`\nDone. ${succeeded} indexed, ${skipped} skipped, ${failed} failed.`)
}

main()
