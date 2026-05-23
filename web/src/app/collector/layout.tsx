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
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="border-b border-[var(--border)] bg-[rgba(15,15,15,0.92)] px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4 sm:gap-6">
            <span className="font-semibold tracking-[0.08em] text-white">DataMarket</span>
            <span className="role-pill-collector rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">Collector</span>
            <Link href="/collector/tasks" className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white">Tasks</Link>
            <Link href="/collector/earnings" className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white">Earnings</Link>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="hidden text-sm text-[var(--foreground-secondary)] sm:inline">{profile?.display_name}</span>
            <form action={signOut}>
              <button className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-white">Sign out</button>
            </form>
          </div>
        </div>
      </nav>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
