'use client'
import { useTheme } from './theme-provider'

export default function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      role="switch"
      aria-checked={isDark}
      onClick={toggle}
      aria-label="Toggle dark mode"
      className={`relative flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 ${
        isDark
          ? 'border-[var(--lab)] bg-[var(--lab)]'
          : 'border-[var(--border)] bg-[var(--surface-muted)]'
      }`}
    >
      <span
        className={`absolute h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          isDark ? 'translate-x-[22px]' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
