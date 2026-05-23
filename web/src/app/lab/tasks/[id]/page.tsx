import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import SubmissionsLive from './submissions-live'

const ADDITIONAL_FILES = ['imu.jsonl', 'intrinsics.json', 'metadata.json', 'poses.jsonl'] as const

export default async function LabTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: task, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !task) notFound()

  const { data: rawSubmissions } = await supabase
    .from('submissions')
    .select('id, collector_id, storage_path, status, metadata, created_at')
    .eq('task_id', id)
    .order('created_at', { ascending: false })

  const submissions = await Promise.all(
    (rawSubmissions ?? []).map(async (s) => {
      const folder = (s.storage_path as string | null ?? '').replace(/\/$/, '')
      const [videoResult, ...fileResults] = await Promise.all([
        supabase.storage.from('recordings').createSignedUrl(`${folder}/video.mp4`, 3600),
        ...ADDITIONAL_FILES.map(name =>
          supabase.storage.from('recordings').createSignedUrl(`${folder}/${name}`, 3600)
        ),
      ])

      const additionalFiles = Object.fromEntries(
        ADDITIONAL_FILES.map((name, i) => [name, fileResults[i].data?.signedUrl ?? null])
      ) as Record<typeof ADDITIONAL_FILES[number], string | null>

      return {
        ...s,
        signedUrl: videoResult.data?.signedUrl ?? null,
        additionalFiles,
      }
    })
  )

  const progress = Math.min(100, (task.quantity_filled / task.quantity_needed) * 100)
  const totalPaid = task.quantity_filled * task.bounty_amount

  return (
    <div>
      <Link href="/lab/dashboard" className="mb-6 inline-block text-sm text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)]">
        ← Dashboard
      </Link>

      <div className="surface-panel mb-6 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-[var(--foreground)]">{task.title}</h1>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                task.status === 'open' ? 'bg-[rgba(59,91,219,0.1)] text-[var(--lab)]' : 'bg-[rgba(90,90,90,0.1)] text-[#4b5563]'
              }`}>
                {task.status}
              </span>
            </div>
            {task.description && (
              <p className="mt-1 text-sm text-[var(--foreground-secondary)]">{task.description}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--foreground-secondary)]">
                {task.data_type}
              </span>
              {(task.required_capabilities as string[]).map((cap: string) => (
                <span key={cap} className="rounded-full border border-[rgba(59,91,219,0.28)] bg-[rgba(59,91,219,0.1)] px-2 py-0.5 text-xs text-[var(--lab)]">
                  {cap}
                </span>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold text-[var(--lab)]">${task.bounty_amount}</div>
            <div className="text-xs text-[var(--foreground-secondary)]">per submission</div>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-[var(--foreground-secondary)]">
              {task.quantity_filled} / {task.quantity_needed} collected
            </span>
            <span className="text-[var(--foreground-secondary)]">${totalPaid.toFixed(2)} paid out</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[rgba(0,0,0,0.07)]">
            <div
              className="h-full rounded-full bg-[var(--lab)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {task.deadline && (
          <p className="mt-3 text-xs text-[var(--foreground-secondary)]">
            Deadline: {new Date(task.deadline).toLocaleDateString('en-US', {
              month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
            })}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="h-2 w-2 rounded-full bg-[var(--collector)] animate-pulse" />
        <span className="text-xs text-[var(--foreground-secondary)]">Live — updates automatically when collectors upload</span>
      </div>

      <SubmissionsLive taskId={id} initialSubmissions={submissions} />
    </div>
  )
}
