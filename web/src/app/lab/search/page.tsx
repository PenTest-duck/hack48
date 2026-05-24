'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'

interface SearchClip {
  video_id: string
  start: number
  end: number
  rank: number
  score?: number
  confidence?: string
  thumbnail_url?: string
  submissionId: string | null
  taskId: string | null
  signedUrl: string | null
}

export default function LabSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchClip[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [lastQuery, setLastQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Search failed. Check your TwelveLabs configuration.')
        setResults([])
        setSearched(true)
        return
      }

      setResults(data.clips ?? [])
      setLastQuery(q)
      setSearched(true)
    } catch {
      setError('Network error. Please try again.')
      setResults([])
      setSearched(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Search Videos</h1>
        <p className="text-sm text-[var(--foreground-secondary)]">
          Find specific moments across all indexed submissions using natural language.
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-8">
        <input
          ref={inputRef}
          type="text"
          className="input-dark flex-1 text-base"
          placeholder='e.g. "bottle on a table" or "person walking outside"'
          value={query}
          onChange={e => setQuery(e.target.value)}
          disabled={loading}
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="btn-lab rounded-lg px-5 py-2 text-sm font-medium transition-colors disabled:opacity-40 shrink-0"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Searching
            </span>
          ) : 'Search'}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {searched && !loading && results.length === 0 && !error && (
        <div className="surface-panel py-16 text-center">
          <div className="text-3xl mb-3">🔍</div>
          <p className="font-medium text-white">No results found</p>
          <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
            Try different search terms, or make sure your videos are indexed for search.
          </p>
          <p className="mt-3 text-xs text-[var(--foreground-secondary)]">
            Open a task and use the &quot;Index for Search&quot; button on each submission card.
          </p>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-[var(--foreground-secondary)]">
              <span className="text-white font-medium">{results.length}</span> result{results.length !== 1 ? 's' : ''}{' '}
              for &ldquo;{lastQuery}&rdquo;
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((clip, i) => (
              <ClipCard key={`${clip.video_id}-${i}`} clip={clip} />
            ))}
          </div>
        </>
      )}

      {!searched && !loading && (
        <div className="surface-panel py-20 text-center">
          <div className="text-4xl mb-3">🎬</div>
          <p className="font-medium text-white">Search your video library</p>
          <p className="mt-2 text-sm text-[var(--foreground-secondary)] max-w-sm mx-auto">
            Describe what you&apos;re looking for — objects, actions, scenes, or spoken words.
            TwelveLabs will find the exact moments across all indexed submissions.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 justify-center">
            {['bottle on a table', 'person running', 'outdoor scene', 'hand gesture'].map(example => (
              <button
                key={example}
                onClick={() => {
                  setQuery(example)
                  inputRef.current?.focus()
                }}
                className="btn-neutral rounded-full px-3 py-1 text-xs transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
          <p className="mt-6 text-xs text-[var(--foreground-secondary)]">
            Videos must be indexed before they appear here.{' '}
            <span className="text-[#aebeff]">Go to a task → submission → &quot;Index for Search&quot;</span>
          </p>
        </div>
      )}
    </div>
  )
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`
}

function ClipCard({ clip }: { clip: SearchClip }) {
  const confidenceStyle =
    clip.confidence === 'high'
      ? 'bg-[rgba(47,158,68,0.16)] text-[#99ddaa]'
      : clip.confidence === 'medium'
      ? 'bg-[rgba(216,163,71,0.16)] text-[#f0cb7c]'
      : 'bg-[rgba(115,120,131,0.18)] text-[#d3d7de]'

  return (
    <div className="surface-panel overflow-hidden flex flex-col">
      {/* Video / thumbnail */}
      {clip.signedUrl ? (
        <video
          src={`${clip.signedUrl}#t=${Math.floor(clip.start)}`}
          controls
          className="w-full aspect-video bg-black object-contain"
          preload="metadata"
        />
      ) : clip.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={clip.thumbnail_url}
          alt="Video clip thumbnail"
          className="w-full aspect-video object-cover"
        />
      ) : (
        <div className="w-full aspect-video bg-[var(--surface-muted)] flex flex-col items-center justify-center gap-1">
          <span className="text-2xl">🎥</span>
          <span className="text-xs text-[var(--foreground-secondary)]">Not yet indexed in your library</span>
        </div>
      )}

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#aebeff]">Rank #{clip.rank}</span>
          <span className="text-xs font-mono text-[var(--foreground-secondary)]">
            {formatTime(clip.start)} – {formatTime(clip.end)}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {clip.confidence && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${confidenceStyle}`}>
              {clip.confidence}
            </span>
          )}
          {clip.score != null && (
            <span className="text-[10px] text-[var(--foreground-secondary)]">
              score {clip.score.toFixed(1)}
            </span>
          )}
        </div>

        {clip.taskId ? (
          <Link
            href={`/lab/tasks/${clip.taskId}`}
            className="mt-auto text-xs text-[var(--foreground-secondary)] hover:text-white transition-colors"
          >
            View submission →
          </Link>
        ) : (
          <p className="mt-auto text-xs text-[var(--foreground-secondary)]">
            Video ID: {clip.video_id.slice(0, 12)}…
          </p>
        )}
      </div>
    </div>
  )
}
