'use client'

import { useState } from 'react'

type Period = 'week' | 'month' | 'year'

type Entry = {
  rank: number
  username: string
  submissions: number
  approved: number
}

const DATA: Record<Period, Entry[]> = {
  week: [
    { rank: 1, username: 'voidrunner91',   submissions: 47,  approved: 43 },
    { rank: 2, username: 'krypt0n_x',      submissions: 39,  approved: 35 },
    { rank: 3, username: 'zephyr_blitz',   submissions: 31,  approved: 28 },
    { rank: 4, username: 'ryancole2041',   submissions: 28,  approved: 25 },
    { rank: 5, username: 'pixeldrop77',    submissions: 24,  approved: 22 },
    { rank: 6, username: 'solstice_99',    submissions: 21,  approved: 19 },
    { rank: 7, username: 'mattk_1234',     submissions: 19,  approved: 17 },
    { rank: 8, username: 'neonpulse22',    submissions: 16,  approved: 15 },
    { rank: 9, username: 'gr1msh4de',      submissions: 14,  approved: 12 },
    { rank: 10, username: 'turbodrift9',   submissions: 12,  approved: 10 },
  ],
  month: [
    { rank: 1, username: 'zephyr_blitz',   submissions: 183, approved: 171 },
    { rank: 2, username: 'voidrunner91',   submissions: 159, approved: 148 },
    { rank: 3, username: 'chrisyoo12978', submissions: 141, approved: 130 },
    { rank: 4, username: 'neonpulse22',    submissions: 124, approved: 115 },
    { rank: 5, username: 'krypt0n_x',      submissions: 108, approved: 99  },
    { rank: 6, username: 'solstice_99',    submissions: 94,  approved: 88  },
    { rank: 7, username: 'blitzflare7',    submissions: 81,  approved: 74  },
    { rank: 8, username: 'ryancole2041',   submissions: 73,  approved: 67  },
    { rank: 9, username: 'shrynx184',      submissions: 68,  approved: 62  },
    { rank: 10, username: 'darkl1ght_x',   submissions: 59,  approved: 54  },
  ],
  year: [
    { rank: 1, username: 'neonpulse22',    submissions: 1847, approved: 1702 },
    { rank: 2, username: 'chrisyoo12978', submissions: 1621, approved: 1489 },
    { rank: 3, username: 'zephyr_blitz',   submissions: 1508, approved: 1401 },
    { rank: 4, username: 'shrynx184',      submissions: 1344, approved: 1231 },
    { rank: 5, username: 'voidrunner91',   submissions: 1198, approved: 1102 },
    { rank: 6, username: 'turbodrift9',    submissions: 1031, approved: 950  },
    { rank: 7, username: 'krypt0n_x',      submissions: 924,  approved: 847  },
    { rank: 8, username: 'ryancole2041',   submissions: 811,  approved: 743  },
    { rank: 9, username: 'gr1msh4de',      submissions: 702,  approved: 640  },
    { rank: 10, username: 'pixeldrop77',   submissions: 618,  approved: 561  },
  ],
}

const PERIOD_LABELS: Record<Period, string> = {
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
}

const PODIUM_COLORS = ['#f0cb7c', '#c0c8d8', '#c87c4a']
const PODIUM_LABELS = ['1st', '2nd', '3rd']

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>('week')
  const entries = DATA[period]

  return (
    <div className="space-y-8">
      <section className="space-y-6">
        <div>
          <h1 className="text-3xl font-black tracking-[-0.04em] text-white sm:text-4xl">Leaderboard</h1>
          <p className="mt-2 text-sm text-[var(--foreground-secondary)]">
            Top collectors ranked by data submissions. Updated daily.
          </p>
        </div>

        <div className="flex gap-2">
          {(Object.keys(PERIOD_LABELS) as Period[]).map((key) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                period === key
                  ? 'btn-collector'
                  : 'border border-[var(--border)] text-[var(--foreground-secondary)] hover:text-white'
              }`}
            >
              {PERIOD_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {entries.slice(0, 3).map((entry, i) => (
            <div key={entry.username} className="surface-panel p-6">
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-semibold uppercase tracking-[0.16em]"
                  style={{ color: PODIUM_COLORS[i] }}
                >
                  {PODIUM_LABELS[i]}
                </span>
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--foreground-tertiary)]">
                  #{entry.rank}
                </span>
              </div>
              <div className="mt-3 font-mono text-base font-bold text-white">{entry.username}</div>
              <div className="mt-4 text-[clamp(2rem,5vw,3.2rem)] font-black leading-none tracking-[-0.04em] text-[#8ad09a]">
                {entry.submissions.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-[var(--foreground-secondary)]">submissions</div>
              <div className="mt-4 text-sm text-[var(--foreground-secondary)]">
                <span className="font-semibold text-[#8ad09a]">{entry.approved.toLocaleString()}</span> approved
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-4 px-4">
            <span className="w-6 text-center text-xs font-semibold uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">#</span>
            <span className="flex-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">Collector</span>
            <span className="w-28 text-right text-xs font-semibold uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">Submissions</span>
            <span className="w-24 text-right text-xs font-semibold uppercase tracking-[0.16em] text-[var(--foreground-secondary)]">Approved</span>
          </div>

          {entries.map((entry, i) => (
            <div
              key={entry.username}
              className="surface-panel flex items-center gap-4 px-4 py-4 transition-colors hover:border-[rgba(255,255,255,0.2)]"
            >
              <div
                className="w-6 text-center text-sm font-black"
                style={{ color: i < 3 ? PODIUM_COLORS[i] : 'var(--foreground-tertiary)' }}
              >
                {entry.rank}
              </div>
              <div className="flex-1 font-mono text-sm font-medium text-white">{entry.username}</div>
              <div className="w-28 text-right text-sm font-bold text-white">{entry.submissions.toLocaleString()}</div>
              <div className="w-24 text-right text-sm font-semibold text-[#8ad09a]">{entry.approved.toLocaleString()}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
