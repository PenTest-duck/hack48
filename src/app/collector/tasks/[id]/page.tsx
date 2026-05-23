import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import CopyButton from './copy-button'

export default async function CollectorTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: task, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !task) notFound()

  // Check if this collector already submitted
  const { data: existingSubmission } = await supabase
    .from('submissions')
    .select('id, status, created_at')
    .eq('task_id', id)
    .eq('collector_id', user!.id)
    .single()

  const spotsLeft = task.quantity_needed - task.quantity_filled
  const deepLink = `datamarket://task/${id}`

  return (
    <div className="max-w-lg">
      <Link href="/collector/tasks" className="text-sm text-gray-400 hover:text-gray-600 mb-6 inline-block">
        ← Browse tasks
      </Link>

      {/* Task card */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{task.title}</h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {task.data_type}
              </span>
              <span className="text-xs text-gray-400">{spotsLeft} spots left</span>
              {task.deadline && (
                <span className="text-xs text-gray-400">
                  Due {new Date(task.deadline).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold text-gray-900">${task.bounty_amount}</div>
            <div className="text-xs text-gray-400">per submission</div>
          </div>
        </div>

        {task.description && (
          <p className="text-sm text-gray-600 leading-relaxed">{task.description}</p>
        )}

        {/* Required capabilities */}
        {(task.required_capabilities as string[]).length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-gray-500 mb-2">REQUIRES</p>
            <div className="flex flex-wrap gap-2">
              {(task.required_capabilities as string[]).map((cap: string) => (
                <span key={cap} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                  {cap}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Submission status or iOS handoff */}
      {existingSubmission ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
              existingSubmission.status === 'approved'
                ? 'bg-green-100'
                : existingSubmission.status === 'rejected'
                ? 'bg-red-100'
                : 'bg-amber-100'
            }`}>
              {existingSubmission.status === 'approved' ? '✓' : existingSubmission.status === 'rejected' ? '✗' : '⏳'}
            </div>
            <div>
              <p className="font-medium text-gray-900 text-sm">
                {existingSubmission.status === 'approved'
                  ? 'Submission approved!'
                  : existingSubmission.status === 'rejected'
                  ? 'Submission rejected'
                  : 'Submission under review'}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                Submitted {new Date(existingSubmission.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          {existingSubmission.status === 'approved' && (
            <p className="text-sm text-green-600 mt-3 font-medium">
              ${task.bounty_amount} has been added to your earnings.
            </p>
          )}
        </div>
      ) : spotsLeft <= 0 ? (
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-6 text-center">
          <p className="text-gray-500 text-sm">This task is full. Check back for new tasks.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="font-semibold text-gray-900 mb-1">How to submit</h2>
          <p className="text-sm text-gray-500 mb-5">
            Open the DataMarket app on your iPhone, find this task by ID, record your data, and upload.
          </p>

          {/* Deep link */}
          <a
            href={deepLink}
            className="block w-full bg-black text-white text-center rounded-xl py-3 text-sm font-medium hover:bg-gray-800 transition-colors mb-4"
          >
            Open in DataMarket App
          </a>

          {/* Fallback — copy task ID */}
          <div className="border border-gray-100 rounded-xl p-4 bg-gray-50">
            <p className="text-xs text-gray-500 mb-2 font-medium">Or enter this Task ID manually in the app:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-gray-700 bg-white border border-gray-200 rounded-lg px-3 py-2 truncate">
                {id}
              </code>
              <CopyButton text={id} />
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-4 text-center">
            Your submission will appear here once uploaded from the app.
          </p>
        </div>
      )}
    </div>
  )
}
