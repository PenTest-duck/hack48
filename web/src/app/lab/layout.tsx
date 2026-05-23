import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { signOut } from '@/app/actions/auth'
import ToastContainer from '@/components/toast'
import Link from 'next/link'
import LogoMark from '@/components/logo-mark'
import ThemeToggle from '@/components/theme-toggle'

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, display_name')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'lab') redirect('/collector/tasks')

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="border-b border-[var(--border)] bg-[var(--surface-elevated)]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4 sm:gap-6">
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark />
              <span className="font-semibold tracking-[0.08em] text-[var(--foreground)]">DataMarket</span>
            </Link>
            <span className="role-pill-lab rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">Lab</span>
            <Link href="/lab/dashboard" className="hidden text-sm text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)] sm:inline">Dashboard</Link>
            <Link href="/lab/tasks/new" className="hidden text-sm text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)] sm:inline">New Task</Link>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="hidden text-sm text-[var(--foreground-secondary)] sm:inline">{profile?.display_name}</span>
            <ThemeToggle />
            <form action={signOut}>
              <button className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)]">Sign out</button>
            </form>
          </div>
        </div>
      </nav>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{children}</main>
      <ToastContainer />
    </div>
  )
}
