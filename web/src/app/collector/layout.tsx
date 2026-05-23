import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { signOut } from '@/app/actions/auth'
import Link from 'next/link'

export default async function CollectorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'collector') redirect('/lab/dashboard')

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4 sm:gap-6">
          <span className="font-bold text-gray-900">DataMarket</span>
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Collector</span>
          <Link href="/collector/tasks" className="text-sm text-gray-600 hover:text-gray-900">Tasks</Link>
          <Link href="/collector/earnings" className="text-sm text-gray-600 hover:text-gray-900">Earnings</Link>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="text-sm text-gray-500 hidden sm:inline">{profile?.display_name}</span>
          <form action={signOut}>
            <button className="text-sm text-gray-500 hover:text-gray-900">Sign out</button>
          </form>
        </div>
      </nav>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  )
}
