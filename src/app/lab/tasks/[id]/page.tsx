import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import SubmissionsLive from './submissions-live'

export default async function LabTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  // Load task
  const { data: task, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !task) notFound()

  // Load initial submissions
  const { data: rawSubmissions } = await supabase
    .from('submissions')
    .select('id, collector_id, storage_path, status, metadata, created_at')
    .eq('task_id', id)
    .order('created_at', { ascending: false })

  // Generate signed URLs server-side for initial load
  const submissions = await Promise.all(
    (rawSubmissions ?? []).map(async (s) => {
      const { data } = await supabase.storage
        .from('submissions')
        .createSignedUrl(s.storage_path, 3600)
      return { ...s, signedUrl: data?.signedUrl ?? null }
    })
  )

  const progress = Math.min(100, (task.quantity_filled / task.quantity_needed) * 100)
  const totalPaid = task.quantity_filled * task.bounty_amount

  return (
    <div>
      {/* Back */}
      <Link href="/lab/dashboard" className="text-sm text-gray-400 hover:text-gray-600 mb-6 inline-block">
        ← Dashboard
      </Link>

      {/* Task header */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-gray-900">{task.title}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                task.status === 'open' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {task.status}
              </span>
            </div>
            {task.description && (
              <p className="text-sm text-gray-500 mt-1">{task.description}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {task.data_type}
              </span>
              {(task.required_capabilities as string[]).map((cap: string) => (
                <span key={cap} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                  {cap}
                </span>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold">${task.bounty_amount}</div>
            <div className="text-xs text-gray-400">per submission</div>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-5">
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-gray-600">
              {task.quantity_filled} / {task.quantity_needed} collected
            </span>
            <span className="text-gray-400">${totalPaid.toFixed(2)} paid out</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-black rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {task.deadline && (
          <p className="text-xs text-gray-400 mt-3">
            Deadline: {new Date(task.deadline).toLocaleDateString('en-US', {
              month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
            })}
          </p>
        )}
      </div>

      {/* Live submissions — client component owns Realtime */}
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-xs text-gray-400">Live — updates automatically when collectors upload</span>
      </div>

      <SubmissionsLive taskId={id} initialSubmissions={submissions} />
    </div>
  )
}
