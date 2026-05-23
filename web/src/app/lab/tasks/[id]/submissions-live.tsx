'use client'

import { useEffect, useState, useTransition } from 'react'
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
}

type Props = {
  taskId: string
  initialSubmissions: Submission[]
}

export default function SubmissionsLive({ taskId, initialSubmissions }: Props) {
  const [submissions, setSubmissions] = useState<Submission[]>(initialSubmissions)
  const [newCount, setNewCount] = useState(0)
  const [isPending, startTransition] = useTransition()

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
            .from('submissions')
            .createSignedUrl(payload.new.storage_path, 3600)

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
        <p className="font-medium text-[var(--foreground)]">Waiting for submissions</p>
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
        <h2 className="font-semibold text-[var(--foreground)]">
          Submissions <span className="font-normal text-[var(--foreground-secondary)]">({submissions.length})</span>
        </h2>
        {newCount > 0 && (
          <span className="rounded-full bg-[rgba(47,158,68,0.12)] px-2 py-1 text-xs font-medium text-[#1f7a30]">
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
            isPending={isPending}
          />
        ))}
      </div>
    </div>
  )
}

function SubmissionCard({
  submission,
  onApprove,
  onReject,
  isPending,
}: {
  submission: Submission
  onApprove: () => void
  onReject: () => void
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
    pending: 'bg-[rgba(180,83,9,0.1)] text-[#b45309]',
    approved: 'bg-[rgba(47,158,68,0.12)] text-[#1f7a30]',
    rejected: 'bg-[rgba(210,100,100,0.1)] text-[#c0392b]',
  }

  return (
    <div className="surface-panel overflow-hidden">
      {submission.signedUrl ? (
        <video
          src={submission.signedUrl}
          controls
          className="w-full max-h-64 bg-[var(--surface-muted)]"
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
