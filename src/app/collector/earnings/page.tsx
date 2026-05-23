import { createClient } from '@/lib/supabase/server'

export default async function EarningsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: earnings } = await supabase
    .from('earnings')
    .select('id, amount, status, created_at, submissions(task_id, tasks(title))')
    .eq('collector_id', user!.id)
    .order('created_at', { ascending: false })

  const total = earnings?.reduce((sum, e) => sum + e.amount, 0) ?? 0
  const pending = earnings?.filter(e => e.status === 'pending').reduce((sum, e) => sum + e.amount, 0) ?? 0

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Earnings</h1>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="text-3xl font-bold text-gray-900">${total.toFixed(2)}</div>
          <div className="text-sm text-gray-500 mt-1">Total earned</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="text-3xl font-bold text-gray-900">${pending.toFixed(2)}</div>
          <div className="text-sm text-gray-500 mt-1">Pending</div>
          {pending > 0 && (
            <button className="mt-3 w-full bg-black text-white rounded-lg py-1.5 text-xs font-medium hover:bg-gray-800 transition-colors">
              Request withdrawal
            </button>
          )}
        </div>
      </div>

      {!earnings?.length ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <div className="text-4xl mb-3">💰</div>
          <p className="text-gray-500">No earnings yet. Complete a task to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {earnings.map(earning => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const submission = earning.submissions as any
            return (
              <div key={earning.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {submission?.tasks?.title ?? 'Task'}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(earning.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-gray-900">${earning.amount.toFixed(2)}</div>
                  <div className={`text-xs mt-0.5 ${earning.status === 'pending' ? 'text-amber-500' : 'text-green-500'}`}>
                    {earning.status}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
