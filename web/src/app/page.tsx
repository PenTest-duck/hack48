import Link from 'next/link'
import LogoMark from '@/components/logo-mark'
import ThemeToggle from '@/components/theme-toggle'

export default function Home() {
  return (
    <div className="h-[100svh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex h-full max-w-7xl flex-col px-4 py-4 sm:px-6 sm:py-6">
        <header className="flex items-center justify-between border-b border-[var(--border)] pb-4">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark />
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--foreground)]">
              DataMarket
            </span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm text-[var(--foreground-secondary)] md:flex">
            <Link href="/signup" className="transition-colors hover:text-[var(--foreground)]">Labs</Link>
            <Link href="/signup" className="transition-colors hover:text-[var(--foreground)]">Collectors</Link>
            <Link href="/login" className="transition-colors hover:text-[var(--foreground)]">Login</Link>
            <ThemeToggle />
            <Link
              href="/signup"
              className="rounded-lg bg-[var(--foreground)] px-4 py-2 font-medium text-white transition-colors hover:bg-[#333]"
            >
              Get started
            </Link>
          </nav>
        </header>

        <main className="grid flex-1 grid-cols-1 gap-12 py-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-center lg:gap-16 lg:py-12">
          <section className="flex max-w-3xl flex-col justify-center">
            <p className="mb-6 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--foreground-secondary)]">
              The physical data layer for AI
            </p>

            <h1 className="max-w-4xl text-[clamp(3rem,8vw,6.5rem)] font-black leading-[0.92] tracking-[-0.04em] text-[var(--foreground)]">
              Let researchers{' '}
              <span className="italic font-normal [font-family:Georgia,serif]">
                collect anything
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-[var(--foreground-secondary)] sm:text-lg">
              Labs define tasks. Collectors capture the world. AI gets better data.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="btn-lab inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition-colors"
              >
                Post a task →
              </Link>
              <Link
                href="/signup"
                className="btn-collector inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold transition-colors"
              >
                Start collecting →
              </Link>
            </div>
          </section>

          <aside className="flex items-center lg:justify-end">
            <div className="flex w-full max-w-sm flex-col justify-center border-l border-[var(--border)] pl-0 lg:pl-10">
              <div className="text-[clamp(4rem,9vw,7rem)] font-black leading-none tracking-[-0.05em] text-[var(--lab)]">
                2,400
              </div>
              <p className="mt-3 max-w-[14rem] text-sm uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">
                Active tasks available
              </p>

              <div className="mt-12 border-t border-[var(--border)] pt-6">
                <p className="text-sm font-medium text-[var(--foreground)]">Are you a lab?</p>
                <Link
                  href="/signup"
                  className="mt-2 inline-flex items-center text-sm font-medium text-[var(--lab)] transition-colors hover:text-[var(--foreground)]"
                >
                  Set up in 2 minutes →
                </Link>
              </div>
            </div>
          </aside>
        </main>
      </div>
    </div>
  )
}
