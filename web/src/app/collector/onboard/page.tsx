import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const CAPABILITY_QUESTIONS = [
  {
    question: 'What environments can you record in?',
    options: [
      { value: 'outdoor', label: 'Outdoors (streets, parks, nature)' },
      { value: 'indoor', label: 'Indoors (home, office, public spaces)' },
    ],
  },
  {
    question: 'What can you capture?',
    options: [
      { value: 'video', label: 'Video (I have a working camera)' },
      { value: 'audio', label: 'Audio (I have a good microphone)' },
      { value: 'motion', label: 'Motion / movement (I can walk, run, exercise on camera)' },
    ],
  },
]

async function submitQuestionnaire(formData: FormData) {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const capabilities = formData.getAll('capabilities') as string[]
  const locationCity = formData.get('location_city') as string

  // Derive capabilities from answers — both arrays are capability values
  await supabase.from('collector_profiles').upsert({
    user_id: user.id,
    capabilities,
    location_city: locationCity,
    questionnaire_data: { capabilities, location_city: locationCity },
  })

  redirect('/collector/tasks')
}

export default async function OnboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Skip onboarding if already completed
  const { data: existing } = await supabase
    .from('collector_profiles')
    .select('user_id')
    .eq('user_id', user!.id)
    .single()

  if (existing) redirect('/collector/tasks')

  return (
    <div className="max-w-lg">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Tell us about yourself</h1>
        <p className="text-gray-500 text-sm mt-1">
          We use this to match you with the right data collection tasks.
        </p>
      </div>

      <form action={submitQuestionnaire} className="space-y-8">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Your city</label>
          <input
            name="location_city"
            type="text"
            placeholder="e.g. San Francisco"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        {CAPABILITY_QUESTIONS.map((q, i) => (
          <div key={i}>
            <p className="text-sm font-medium text-gray-700 mb-3">{q.question}</p>
            <div className="space-y-2">
              {q.options.map(opt => (
                <label key={opt.value} className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    name="capabilities"
                    value={opt.value}
                    className="mt-0.5 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <button
          type="submit"
          className="w-full bg-black text-white rounded-lg py-2.5 text-sm font-medium hover:bg-gray-800 transition-colors"
        >
          Start earning →
        </button>
      </form>
    </div>
  )
}
