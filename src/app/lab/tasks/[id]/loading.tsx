function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-lg ${className}`} />
}

export default function TaskLoading() {
  return (
    <div>
      <Skeleton className="h-4 w-24 mb-6" />
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <Skeleton className="h-7 w-64 mb-2" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>
          <div className="text-right">
            <Skeleton className="h-8 w-16 mb-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-4 w-full mb-1.5" />
        <Skeleton className="h-2 w-full mt-3" />
      </div>
      <div className="space-y-4">
        {[0, 1].map(i => (
          <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <Skeleton className="h-48 w-full rounded-none" />
            <div className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <Skeleton className="h-5 w-20 mb-2" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-8 w-20" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
