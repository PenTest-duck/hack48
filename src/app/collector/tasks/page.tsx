import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function CollectorTasksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Redirect to onboarding if not complete
  const { data: profile } = await supabase
    .from('collector_profiles')
    .select('capabilities')
    .eq('user_id', user!.id)
    .single()

  if (!profile) redirect('/collector/onboard')

  // RLS filters tasks to only those matching this collector's capabilities
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, description, data_type, bounty_amount, quantity_needed, quantity_filled, deadline')
    .eq('status', 'open')
    .order('bounty_amount', { ascending: false })

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Available tasks</h1>
        <p className="text-gray-500 text-sm mt-1">
          Tasks matched to your capabilities. Earn money for each approved submission.
        </p>
      </div>

      {!tasks?.length ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-gray-500">No matching tasks right now. Check back soon.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {tasks.map(task => {
            const progress = Math.min(100, (task.quantity_filled / task.quantity_needed) * 100)
            const spotsLeft = task.quantity_needed - task.quantity_filled

            return (
              <Link
                key={task.id}
                href={`/collector/tasks/${task.id}`}
                className="block bg-white rounded-xl border border-gray-100 p-5 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{task.title}</h3>
                    {task.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-3">
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
                    <div className="text-lg font-bold text-gray-900">${task.bounty_amount}</div>
                    <div className="text-xs text-gray-400">per submission</div>
                  </div>
                </div>
                <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
