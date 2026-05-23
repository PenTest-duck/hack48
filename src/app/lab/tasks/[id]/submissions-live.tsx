'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { approveSubmission, rejectSubmission } from '@/app/actions/submissions'

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
          // Generate signed URL client-side immediately — no extra round-trip
          const { data } = await supabase.storage
            .from('submissions')
            .createSignedUrl(payload.new.storage_path, 3600)

          const newSubmission: Submission = {
            ...(payload.new as Submission),
            signedUrl: data?.signedUrl ?? null,
          }

          setSubmissions(prev => [newSubmission, ...prev])
          setNewCount(n => n + 1)
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
      <div className="text-center py-20 bg-white rounded-xl border border-gray-100">
        <div className="text-4xl mb-3">📡</div>
        <p className="text-gray-500 font-medium">Waiting for submissions</p>
        <p className="text-gray-400 text-sm mt-1">This page updates live when collectors upload data</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-gray-400">Listening for uploads</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900">
          Submissions <span className="text-gray-400 font-normal">({submissions.length})</span>
        </h2>
        {newCount > 0 && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
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
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-600',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Video player */}
      {submission.signedUrl ? (
        <video
          src={submission.signedUrl}
          controls
          className="w-full max-h-64 bg-black"
          preload="metadata"
        />
      ) : (
        <div className="w-full h-40 bg-gray-100 flex items-center justify-center">
          <span className="text-gray-400 text-sm">Video preview unavailable</span>
        </div>
      )}

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyles[submission.status]}`}>
                {submission.status}
              </span>
              <span className="text-xs text-gray-400">
                {new Date(submission.created_at).toLocaleString()}
              </span>
            </div>

            {/* Metadata */}
            {meta && (
              <div className="flex flex-wrap gap-3 mt-2">
                {meta.duration_s && (
                  <span className="text-xs text-gray-500">{meta.duration_s}s</span>
                )}
                {meta.file_size_bytes && (
                  <span className="text-xs text-gray-500">
                    {(meta.file_size_bytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                )}
                {meta.device_model && (
                  <span className="text-xs text-gray-500">{meta.device_model}</span>
                )}
                {meta.gps_lat && meta.gps_lng && (
                  <span className="text-xs text-gray-500">
                    {meta.gps_lat.toFixed(4)}, {meta.gps_lng.toFixed(4)}
                  </span>
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
                className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Reject
              </button>
              <button
                onClick={onApprove}
                disabled={isPending}
                className="px-3 py-1.5 text-xs bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors"
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
