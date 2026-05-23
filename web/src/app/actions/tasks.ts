'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export type CreateTaskState = {
  error: string | null
}

function parseDeadline(value: FormDataEntryValue | null) {
  if (!value || typeof value !== 'string' || value.trim().length === 0) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export async function createTask(
  _prevState: CreateTaskState,
  formData: FormData,
): Promise<CreateTaskState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const title = (formData.get('title') as string | null)?.trim() ?? ''
  const description = (formData.get('description') as string | null)?.trim() ?? ''
  const requirements = formData.getAll('requirements').map((value) => String(value).trim()).filter(Boolean)
  const specifics = formData.getAll('specifics').map((value) => String(value).trim()).filter(Boolean)
  const referenceAssets = formData.getAll('reference_assets') as File[]
  const firstAsset = referenceAssets.find((asset) => asset.size > 0)
  const bountyRaw = formData.get('bounty_amount') as string | null
  const quantityRaw = formData.get('quantity_needed') as string | null
  const bountyAmount = Number.parseFloat(bountyRaw ?? '')
  const quantityNeeded = Number.parseInt(quantityRaw ?? '', 10)

  if (!title) return { error: 'Add a task title.' }
  if (!description) return { error: 'Add a description.' }
  if (requirements.length === 0) return { error: 'Select or add at least one requirement.' }
  if (!Number.isFinite(bountyAmount) || bountyAmount <= 0) {
    return { error: 'Set a bounty greater than $0.' }
  }
  if (!Number.isFinite(quantityNeeded) || quantityNeeded < 1) {
    return { error: 'Set how many submissions you need.' }
  }

  const dataType = firstAsset?.type.startsWith('video/')
    ? 'video'
    : firstAsset?.type.startsWith('image/')
      ? 'image'
      : 'image'

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      lab_id: user.id,
      title,
      description,
      data_type: dataType,
      required_capabilities: requirements,
      bounty_amount: bountyAmount,
      quantity_needed: quantityNeeded,
      deadline: parseDeadline(formData.get('deadline')),
    })
    .select('id')
    .single()

  if (error || !data) {
    return { error: error?.message ?? 'Could not create this task. Try again.' }
  }

  if (specifics.length > 0) {
    const { error: metadataError } = await supabase
      .from('tasks')
      .update({ metadata: { specifics } })
      .eq('id', data.id)

    if (metadataError) {
      console.error('Failed to save task specifics:', metadataError)
    }
  }

  redirect(`/lab/tasks/${data.id}`)
}
