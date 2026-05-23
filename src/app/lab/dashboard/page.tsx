import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function LabDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, bounty_amount, quantity_needed, quantity_filled, status, created_at')
    .eq('lab_id', user!.id)
    .order('created_at', { ascending: false })

  const totalSpend = tasks?.reduce((sum, t) => sum + (t.bounty_amount * t.quantity_filled), 0) ?? 0

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Your Tasks</h1>
        <Link
          href="/lab/tasks/new"
          className="bg-black text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          + New Task
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-2xl font-bold">{tasks?.length ?? 0}</div>
          <div className="text-sm text-gray-500 mt-1">Total tasks</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-2xl font-bold">
            {tasks?.reduce((sum, t) => sum + t.quantity_filled, 0) ?? 0}
          </div>
          <div className="text-sm text-gray-500 mt-1">Submissions received</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <div className="text-2xl font-bold">${totalSpend.toFixed(2)}</div>
          <div className="text-sm text-gray-500 mt-1">Total spent</div>
        </div>
      </div>

      {/* Task list */}
      {!tasks?.length ? (
        <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-gray-500">No tasks yet. Create your first one.</p>
          <Link
            href="/lab/tasks/new"
            className="inline-block mt-4 bg-black text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Create task
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => (
            <Link
              key={task.id}
              href={`/lab/tasks/${task.id}`}
              className="block bg-white rounded-xl border border-gray-100 p-5 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{task.title}</h3>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-sm text-gray-500">
                      ${task.bounty_amount} / submission
                    </span>
                    <span className="text-sm text-gray-400">·</span>
                    <span className="text-sm text-gray-500">
                      {task.quantity_filled} / {task.quantity_needed} collected
                    </span>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  task.status === 'open'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {task.status}
                </span>
              </div>
              {/* Progress bar */}
              <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-black rounded-full"
                  style={{ width: `${Math.min(100, (task.quantity_filled / task.quantity_needed) * 100)}%` }}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
