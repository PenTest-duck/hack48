'use client'

import { useEffect, useState, useTransition, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { approveSubmission, rejectSubmission } from '@/app/actions/submissions'
import { triggerToast } from '@/components/toast'

type Submission = {
  id: string
  collector_id: string
  storage_path: string
  status: 'pending' | 'approved' | 'rejected'
  metadata: Record<string, unknown> | null
  created_at: string
  signedUrl: string | null
  score?: number
}

type IndexStatus = {
  status: 'pending' | 'indexing' | 'ready' | 'failed' | string
  video_id: string | null
  created_at: string | null
}

type Props = {
  taskId: string
  initialSubmissions: Submission[]
}

export default function SubmissionsLive({ taskId, initialSubmissions }: Props) {
  const [submissions, setSubmissions] = useState<Submission[]>(initialSubmissions)
  const [newCount, setNewCount] = useState(0)
  const [isPending, startTransition] = useTransition()
  const [showIndexing, setShowIndexing] = useState(false)

  // Search state
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Submission[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`submissions:${taskId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'submissions',
          filter: `task_id=eq.${taskId}`,
        },
        async (payload) => {
          const { data } = await supabase.storage
            .from('recordings')
            .createSignedUrl(payload.new.storage_path.replace(/\/$/, '') + '/video.mp4', 3600)

          const newSubmission: Submission = {
            ...(payload.new as Submission),
            signedUrl: data?.signedUrl ?? null,
          }

          setSubmissions(prev => [newSubmission, ...prev])
          setNewCount(n => n + 1)
          triggerToast('New submission received!')
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [taskId])

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setSearchResults(null)
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/search-videos`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({ query: q, task_id: taskId }),
        }
      )
      if (res.ok) {
        const body = await res.json()
        setSearchResults(body.results ?? [])
      } else {
        setSearchResults([])
      }
    } catch {
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [taskId])

  function handleQueryChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setSearchResults(null)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    debounceRef.current = setTimeout(() => runSearch(value), 300)
  }

  function handleApprove(submissionId: string) {
    startTransition(async () => {
      await approveSubmission(submissionId, taskId)
      const update = (s: Submission) => s.id === submissionId ? { ...s, status: 'approved' as const } : s
      setSubmissions(prev => prev.map(update))
      setSearchResults(prev => prev ? prev.map(update) : prev)
    })
  }

  function handleReject(submissionId: string) {
    startTransition(async () => {
      await rejectSubmission(submissionId, taskId)
      const update = (s: Submission) => s.id === submissionId ? { ...s, status: 'rejected' as const } : s
      setSubmissions(prev => prev.map(update))
      setSearchResults(prev => prev ? prev.map(update) : prev)
    })
  }

  const displayed = searchResults !== null ? searchResults : submissions
  const isFiltered = searchResults !== null

  return (
    <div>
      {/* Search bar */}
      <div className="mb-4">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--foreground-secondary)] pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            placeholder='Search submissions by content… (e.g. "person walking" or "outdoor scene")'
            className="input-dark w-full rounded-lg pl-10 pr-10 py-2.5 text-sm"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <span className="h-4 w-4 rounded-full border-2 border-[var(--foreground-secondary)] border-t-transparent animate-spin block" />
            </div>
          )}
          {!isSearching && query && (
            <button
              onClick={() => { setQuery(''); setSearchResults(null) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--foreground-secondary)] hover:text-white transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {isFiltered && !isSearching && (
          <p className="mt-1.5 text-xs text-[var(--foreground-secondary)]">
            {searchResults!.length} result{searchResults!.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
          </p>
        )}
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-white">
          {isFiltered ? 'Search Results' : 'Submissions'}{' '}
          <span className="font-normal text-[var(--foreground-secondary)]">({displayed.length})</span>
        </h2>
        <div className="flex items-center gap-3">
          {!isFiltered && newCount > 0 && (
            <span className="rounded-full bg-[rgba(47,158,68,0.16)] px-2 py-1 text-xs font-medium text-[#99ddaa]">
              +{newCount} new this session
            </span>
          )}
          {/* Indexing toggle */}
          <button
            onClick={() => setShowIndexing(v => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
              showIndexing
                ? 'border-[rgba(59,91,219,0.4)] bg-[rgba(59,91,219,0.12)] text-[#aebeff]'
                : 'border-[var(--border)] text-[var(--foreground-secondary)] hover:text-white'
            }`}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
            Indexing
          </button>
        </div>
      </div>

      {/* Empty states */}
      {!isSearching && displayed.length === 0 && !isFiltered && (
        <div className="surface-panel py-20 text-center">
          <div className="text-4xl mb-3">📡</div>
          <p className="font-medium text-white">Waiting for submissions</p>
          <p className="mt-1 text-sm text-[var(--foreground-secondary)]">This page updates live when collectors upload data</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#2f9e44] animate-pulse" />
            <span className="text-xs text-[var(--foreground-secondary)]">Listening for uploads</span>
          </div>
        </div>
      )}

      {!isSearching && displayed.length === 0 && isFiltered && (
        <div className="surface-panel py-16 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <p className="font-medium text-white">No matching submissions</p>
          <p className="mt-1 text-sm text-[var(--foreground-secondary)]">Try a different search term</p>
        </div>
      )}

      {/* Loading skeleton while searching */}
      {isSearching && (
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div key={i} className="surface-panel overflow-hidden animate-pulse">
              <div className="h-40 bg-[var(--surface-muted)]" />
              <div className="p-4 space-y-2">
                <div className="h-3 w-24 rounded bg-[rgba(255,255,255,0.06)]" />
                <div className="h-3 w-40 rounded bg-[rgba(255,255,255,0.04)]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cards */}
      {!isSearching && displayed.length > 0 && (
        <div className="space-y-4">
          {displayed.map(submission => (
            <SubmissionCard
              key={submission.id}
              submission={submission}
              onApprove={() => handleApprove(submission.id)}
              onReject={() => handleReject(submission.id)}
              isPending={isPending}
              showIndexing={showIndexing}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SubmissionCard({
  submission,
  onApprove,
  onReject,
  isPending,
  showIndexing,
}: {
  submission: Submission
  onApprove: () => void
  onReject: () => void
  isPending: boolean
  showIndexing: boolean
}) {
  const meta = submission.metadata as {
    duration_s?: number
    file_size_bytes?: number
    device_model?: string
    gps_lat?: number
    gps_lng?: number
    twelvelabs_task_id?: string
  } | null

  const tlTaskId = meta?.twelvelabs_task_id ?? null

  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [description, setDescription] = useState<string | null>(null)
  const [loadingDesc, setLoadingDesc] = useState(false)

  const fetchStatus = useCallback(async () => {
    if (!tlTaskId) return
    setLoadingStatus(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/task-status`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({ task_id: tlTaskId }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        setIndexStatus(data)
      }
    } finally {
      setLoadingStatus(false)
    }
  }, [tlTaskId])

  const fetchDescription = useCallback(async (videoId: string) => {
    setLoadingDesc(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/describe-video`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({ video_id: videoId }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        setDescription(data.description ?? null)
      }
    } finally {
      setLoadingDesc(false)
    }
  }, [])

  // Auto-fetch when indexing panel opens
  useEffect(() => {
    if (showIndexing && tlTaskId && !indexStatus) {
      fetchStatus()
    }
  }, [showIndexing, tlTaskId, indexStatus, fetchStatus])

  const statusStyles = {
    pending: 'bg-[rgba(216,163,71,0.16)] text-[#f0cb7c]',
    approved: 'bg-[rgba(47,158,68,0.16)] text-[#99ddaa]',
    rejected: 'bg-[rgba(210,100,100,0.16)] text-[#f3a8a8]',
  }

  const indexStatusStyles: Record<string, string> = {
    ready: 'bg-[rgba(47,158,68,0.16)] text-[#99ddaa]',
    indexing: 'bg-[rgba(216,163,71,0.16)] text-[#f0cb7c]',
    pending: 'bg-[rgba(216,163,71,0.16)] text-[#f0cb7c]',
    failed: 'bg-[rgba(210,100,100,0.16)] text-[#f3a8a8]',
  }

  return (
    <div className="surface-panel overflow-hidden">
      {/* Video player */}
      {submission.signedUrl ? (
        <video
          src={submission.signedUrl}
          controls
          className="w-full max-h-64 bg-black"
          preload="metadata"
        />
      ) : (
        <div className="flex h-40 w-full items-center justify-center bg-[var(--surface-muted)]">
          <span className="text-sm text-[var(--foreground-secondary)]">Video preview unavailable</span>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyles[submission.status]}`}>
                {submission.status}
              </span>
              {submission.score !== undefined && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[rgba(59,91,219,0.16)] text-[#aebeff]">
                  {Math.round(submission.score * 100)}% match
                </span>
              )}
              <span className="text-xs text-[var(--foreground-secondary)]">
                {new Date(submission.created_at).toLocaleString()}
              </span>
            </div>

            {/* Metadata */}
            {meta && (
              <div className="flex flex-wrap gap-3 mt-2">
                {meta.duration_s && (
                  <span className="text-xs text-[var(--foreground-secondary)]">{meta.duration_s}s</span>
                )}
                {meta.file_size_bytes && (
                  <span className="text-xs text-[var(--foreground-secondary)]">
                    {(meta.file_size_bytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                )}
                {meta.device_model && (
                  <span className="text-xs text-[var(--foreground-secondary)]">{meta.device_model}</span>
                )}
                {meta.gps_lat && meta.gps_lng && (
                  <span className="text-xs text-[var(--foreground-secondary)]">
                    {meta.gps_lat.toFixed(4)}, {meta.gps_lng.toFixed(4)}
                  </span>
                )}
              </div>
            )}

            {/* Indexing panel */}
            {showIndexing && (
              <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-medium text-[var(--foreground-secondary)] uppercase tracking-wide">TwelveLabs Indexing</span>
                  {tlTaskId && (
                    <button
                      onClick={fetchStatus}
                      disabled={loadingStatus}
                      className="flex items-center gap-1 text-xs text-[var(--foreground-secondary)] hover:text-white transition-colors disabled:opacity-40"
                    >
                      <svg className={`h-3 w-3 ${loadingStatus ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Refresh
                    </button>
                  )}
                </div>

                {!tlTaskId ? (
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--foreground-secondary)]" />
                    <span className="text-xs text-[var(--foreground-secondary)]">Not indexed</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {loadingStatus && !indexStatus ? (
                        <span className="text-xs text-[var(--foreground-secondary)]">Fetching status…</span>
                      ) : indexStatus ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${indexStatusStyles[indexStatus.status] ?? 'bg-[rgba(255,255,255,0.06)] text-[var(--foreground-secondary)]'}`}>
                          {indexStatus.status}
                        </span>
                      ) : null}
                      {indexStatus?.video_id && (
                        <span className="text-xs text-[var(--foreground-secondary)] font-mono truncate max-w-[160px]">
                          {indexStatus.video_id}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--foreground-secondary)] font-mono truncate">
                      task: {tlTaskId}
                    </p>

                    {/* Describe button — only when ready */}
                    {indexStatus?.status === 'ready' && indexStatus.video_id && (
                      <div className="mt-1">
                        {!description && !loadingDesc && (
                          <button
                            onClick={() => fetchDescription(indexStatus.video_id!)}
                            className="flex items-center gap-1.5 text-xs text-[#aebeff] hover:text-white transition-colors"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            What did TwelveLabs see in this video?
                          </button>
                        )}
                        {loadingDesc && (
                          <div className="flex items-center gap-1.5 text-xs text-[var(--foreground-secondary)]">
                            <span className="h-3 w-3 rounded-full border-2 border-[var(--foreground-secondary)] border-t-transparent animate-spin block" />
                            Generating description…
                          </div>
                        )}
                        {description && (
                          <div className="mt-1.5 rounded-md border border-[rgba(59,91,219,0.2)] bg-[rgba(59,91,219,0.06)] p-2.5">
                            <p className="text-xs leading-relaxed text-[var(--foreground-secondary)]">{description}</p>
                            <button
                              onClick={() => { setDescription(null) }}
                              className="mt-1.5 text-[0.65rem] text-[var(--foreground-secondary)] hover:text-white transition-colors"
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          {submission.status === 'pending' && (
            <div className="flex gap-2 shrink-0">
              <button
                onClick={onReject}
                disabled={isPending}
                className="btn-neutral rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
              >
                Reject
              </button>
              <button
                onClick={onApprove}
                disabled={isPending}
                className="btn-lab rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
              >
                Approve
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
