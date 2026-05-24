'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { approveSubmission, rejectSubmission } from '@/app/actions/submissions'
import { triggerToast } from '@/components/toast'

export type AnalysisJobKind =
  | 'gemini_eval'
  | 'mediapipe_hands'
  | 'yolo_objects'
  | 'sam_segments'
  | 'temporal_actions'

export type AnalysisJobStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export type AnalysisJob = {
  recording_id: string
  kind: AnalysisJobKind
  status: AnalysisJobStatus
  artifact_path: string | null
  summary: Record<string, unknown> | null
  error: string | null
  started_at: string | null
  finished_at: string | null
}

export type RecordingAnalysis = {
  id: string
  status: 'uploaded' | 'analyzing' | 'analyzed' | 'analysis_failed'
  is_scoring: boolean
  summary: string | null
  success: boolean | null
  success_reasoning: string | null
  score: number | null
  score_reasoning: string | null
  detected_objects: unknown
  analysis_artifacts: unknown
}

type Submission = {
  id: string
  collector_id: string
  storage_path: string
  status: 'pending' | 'approved' | 'rejected'
  metadata: Record<string, unknown> | null
  created_at: string
  signedUrl: string | null
  recording: RecordingAnalysis | null
  analysisJobs: AnalysisJob[]
}

type IndexStatus = 'none' | 'indexing' | 'indexed' | 'error'

type Props = {
  taskId: string
  initialSubmissions: Submission[]
}

export default function SubmissionsLive({ taskId, initialSubmissions }: Props) {
  const [submissions, setSubmissions] = useState<Submission[]>(initialSubmissions)
  const [newCount, setNewCount] = useState(0)
  const [isPending, startTransition] = useTransition()
  const [indexStatuses, setIndexStatuses] = useState<Record<string, IndexStatus>>(() => {
    const init: Record<string, IndexStatus> = {}
    for (const s of initialSubmissions) {
      init[s.id] = s.metadata?.['twelvelabs_video_id'] ? 'indexed' : 'none'
    }
    return init
  })

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
          // Generate signed URL client-side immediately — no extra round-trip
          const { data } = await supabase.storage
            .from('recordings')
            .createSignedUrl(payload.new.storage_path.replace(/\/$/, '') + '/video.mp4', 3600)

          const newSubmission: Submission = {
            ...(payload.new as Omit<Submission, 'signedUrl' | 'recording' | 'analysisJobs'>),
            signedUrl: data?.signedUrl ?? null,
            recording: null,
            analysisJobs: [],
          }

          setSubmissions(prev => [newSubmission, ...prev])
          setIndexStatuses(prev => ({ ...prev, [newSubmission.id]: 'none' }))
          setNewCount(n => n + 1)
          triggerToast('New submission received!')
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [taskId])

  async function handleIndex(submissionId: string, force = false) {
    setIndexStatuses(prev => ({ ...prev, [submissionId]: 'indexing' }))
    try {
      const res = await fetch('/api/index-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, force }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Indexing failed')
      setIndexStatuses(prev => ({ ...prev, [submissionId]: 'indexed' }))
      if (data.videoId) {
        setSubmissions(prev =>
          prev.map(s =>
            s.id === submissionId
              ? { ...s, metadata: { ...(s.metadata ?? {}), twelvelabs_video_id: data.videoId } }
              : s
          )
        )
      }
      if (data.alreadyIndexed) {
        triggerToast('Already indexed for search')
      } else {
        triggerToast('Video indexed — searchable now')
      }
    } catch (err) {
      setIndexStatuses(prev => ({ ...prev, [submissionId]: 'error' }))
      triggerToast(`Index error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  function handleApprove(submissionId: string) {
    startTransition(async () => {
      await approveSubmission(submissionId, taskId)
      setSubmissions(prev =>
        prev.map(s => s.id === submissionId ? { ...s, status: 'approved' } : s)
      )
    })
  }

  function handleReject(submissionId: string) {
    startTransition(async () => {
      await rejectSubmission(submissionId, taskId)
      setSubmissions(prev =>
        prev.map(s => s.id === submissionId ? { ...s, status: 'rejected' } : s)
      )
    })
  }

  if (!submissions.length) {
    return (
      <div className="surface-panel py-20 text-center">
        <div className="text-4xl mb-3">📡</div>
        <p className="font-medium text-white">Waiting for submissions</p>
        <p className="mt-1 text-sm text-[var(--foreground-secondary)]">This page updates live when collectors upload data</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#2f9e44] animate-pulse" />
          <span className="text-xs text-[var(--foreground-secondary)]">Listening for uploads</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-white">
          Submissions <span className="font-normal text-[var(--foreground-secondary)]">({submissions.length})</span>
        </h2>
        {newCount > 0 && (
          <span className="rounded-full bg-[rgba(47,158,68,0.16)] px-2 py-1 text-xs font-medium text-[#99ddaa]">
            +{newCount} new this session
          </span>
        )}
      </div>

      <div className="space-y-4">
        {submissions.map(submission => (
          <SubmissionCard
            key={submission.id}
            submission={submission}
            onApprove={() => handleApprove(submission.id)}
            onReject={() => handleReject(submission.id)}
            onIndex={(force) => handleIndex(submission.id, force)}
            indexStatus={indexStatuses[submission.id] ?? 'none'}
            isPending={isPending}
          />
        ))}
      </div>
    </div>
  )
}

const RECORDING_STATUS_STYLES: Record<RecordingAnalysis['status'], string> = {
  uploaded: 'bg-[rgba(115,120,131,0.18)] text-[#d3d7de]',
  analyzing: 'bg-[rgba(216,163,71,0.16)] text-[#f0cb7c]',
  analyzed: 'bg-[rgba(47,158,68,0.16)] text-[#99ddaa]',
  analysis_failed: 'bg-[rgba(210,100,100,0.16)] text-[#f3a8a8]',
}

const JOB_STATUS_STYLES: Record<AnalysisJobStatus, string> = {
  pending: 'border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--foreground-secondary)]',
  running: 'bg-[rgba(216,163,71,0.16)] text-[#f0cb7c]',
  succeeded: 'bg-[rgba(47,158,68,0.16)] text-[#99ddaa]',
  failed: 'bg-[rgba(210,100,100,0.16)] text-[#f3a8a8]',
}

function SubmissionCard({
  submission,
  onApprove,
  onReject,
  onIndex,
  indexStatus,
  isPending,
}: {
  submission: Submission
  onApprove: () => void
  onReject: () => void
  onIndex: (force?: boolean) => void
  indexStatus: IndexStatus
  isPending: boolean
}) {
  const meta = submission.metadata as {
    duration_s?: number
    file_size_bytes?: number
    device_model?: string
    gps_lat?: number
    gps_lng?: number
  } | null

  const statusStyles = {
    pending: 'bg-[rgba(216,163,71,0.16)] text-[#f0cb7c]',
    approved: 'bg-[rgba(47,158,68,0.16)] text-[#99ddaa]',
    rejected: 'bg-[rgba(210,100,100,0.16)] text-[#f3a8a8]',
  }

  const recording = submission.recording

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
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyles[submission.status]}`}>
                {submission.status}
              </span>
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
          </div>

          {/* Actions */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            {submission.status === 'pending' && (
              <div className="flex gap-2">
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
            {/* Index for TwelveLabs search */}
            {indexStatus === 'indexed' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs px-2 py-1 rounded-full bg-[rgba(59,91,219,0.16)] text-[#aebeff] font-medium">
                  Indexed for search
                </span>
                <button
                  onClick={() => onIndex(true)}
                  className="text-[10px] text-[var(--foreground-secondary)] hover:text-white transition-colors"
                  title="Force re-index"
                >
                  ↻
                </button>
              </div>
            ) : indexStatus === 'indexing' ? (
              <span className="flex items-center gap-1.5 text-xs text-[var(--foreground-secondary)]">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-[var(--foreground-secondary)]/30 border-t-[var(--foreground-secondary)] animate-spin" />
                Indexing…
              </span>
            ) : indexStatus === 'error' ? (
              <button
                onClick={() => onIndex()}
                className="text-xs px-2 py-1 rounded-full bg-[rgba(210,100,100,0.16)] text-[#f3a8a8] hover:bg-[rgba(210,100,100,0.24)] transition-colors"
              >
                Retry index
              </button>
            ) : (
              <button
                onClick={() => onIndex()}
                disabled={!submission.signedUrl}
                className="text-xs px-2 py-1 rounded-full btn-neutral transition-colors disabled:opacity-40"
                title={submission.signedUrl ? 'Index this video in TwelveLabs for AI search' : 'No video URL available'}
              >
                Index for Search
              </button>
            )}
          </div>
        </div>

        {recording && (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--foreground-secondary)]">
                Analysis
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RECORDING_STATUS_STYLES[recording.status]}`}>
                {recording.status}
              </span>
              {recording.is_scoring ? (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[rgba(216,163,71,0.16)] text-[#f0cb7c]">
                  Scoring
                </span>
              ) : recording.score !== null ? (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-[rgba(47,158,68,0.16)] text-[#99ddaa]">
                  Score ready
                </span>
              ) : (
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--foreground-secondary)]">
                  Not scored
                </span>
              )}
              <Link
                href={`/lab/recordings/${recording.id}`}
                className="ml-auto text-xs text-[#aebeff] hover:text-white transition-colors"
              >
                View artifacts →
              </Link>
            </div>

            {recording.score !== null && (
              <div className="mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)]">
                <div className="flex flex-col items-start rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
                  <span className="text-xs uppercase tracking-[0.14em] text-[var(--foreground-secondary)]">Score</span>
                  <span className="text-2xl font-black tracking-[-0.03em] text-white">{recording.score}/10</span>
                </div>
                <div className="space-y-2 text-sm">
                  {recording.summary && (
                    <p className="text-white">{recording.summary}</p>
                  )}
                  {recording.score_reasoning && (
                    <p className="text-[var(--foreground-secondary)]">{recording.score_reasoning}</p>
                  )}
                </div>
              </div>
            )}

            {submission.analysisJobs.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {submission.analysisJobs.map((job) => (
                  <span
                    key={`${job.recording_id}-${job.kind}`}
                    title={job.error ?? job.artifact_path ?? undefined}
                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${JOB_STATUS_STYLES[job.status]}`}
                  >
                    {job.kind}: {job.status}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
