import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const CAPABILITIES = [
  { value: 'outdoor', label: 'Outdoor environments' },
  { value: 'indoor', label: 'Indoor environments' },
  { value: 'video', label: 'Video recording' },
  { value: 'audio', label: 'Audio recording' },
  { value: 'motion', label: 'Motion / movement' },
]

async function createTask(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const capabilities = formData.getAll('capabilities') as string[]

  const { data, error } = await supabase.from('tasks').insert({
    lab_id: user.id,
    title: formData.get('title') as string,
    description: formData.get('description') as string,
    data_type: formData.get('data_type') as string,
    required_capabilities: capabilities,
    bounty_amount: parseFloat(formData.get('bounty_amount') as string),
    quantity_needed: parseInt(formData.get('quantity_needed') as string),
    deadline: formData.get('deadline') || null,
  }).select('id').single()

  if (error || !data) {
    // In production, handle this more gracefully
    console.error(error)
    return
  }

  redirect(`/lab/tasks/${data.id}`)
}

export default function NewTaskPage() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Create a task</h1>

      <form action={createTask} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Task title</label>
          <input
            name="title"
            required
            placeholder="e.g. Record 30s outdoor walking videos"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            name="description"
            rows={3}
            placeholder="Describe exactly what you need collectors to capture..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Data type</label>
          <select
            name="data_type"
            required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black bg-white"
          >
            <option value="">Select type...</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
            <option value="image">Image</option>
            <option value="sensor">Sensor data</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Required collector capabilities
          </label>
          <div className="space-y-2">
            {CAPABILITIES.map(cap => (
              <label key={cap.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="capabilities"
                  value={cap.value}
                  className="rounded border-gray-300"
                />
                <span className="text-sm text-gray-700">{cap.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bounty per submission ($)
            </label>
            <input
              name="bounty_amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="5.00"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Submissions needed
            </label>
            <input
              name="quantity_needed"
              type="number"
              min="1"
              required
              placeholder="50"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Deadline (optional)
          </label>
          <input
            name="deadline"
            type="datetime-local"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        <button
          type="submit"
          className="w-full bg-black text-white rounded-lg py-2.5 text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          Post task
        </button>
      </form>
    </div>
  )
}
