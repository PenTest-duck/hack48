export default function LogoMark({ className }: { className?: string }) {
  return (
    <div className={`grid grid-cols-2 gap-1 ${className ?? ''}`}>
      <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--foreground)]" />
      <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--lab)]" />
      <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--collector)]" />
      <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--foreground)]/20" />
    </div>
  )
}
