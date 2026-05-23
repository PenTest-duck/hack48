'use client'

import { useActionState, useState } from 'react'
import { signUp } from '@/app/actions/auth'
import Link from 'next/link'

const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signUp, {
    error: null,
    message: null,
  })
  const [role, setRole] = useState<'lab' | 'collector' | null>(null)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Create account</h1>
          <p className="text-gray-500 text-sm mt-1">Join the data marketplace</p>
        </div>

        <form action={formAction} className="space-y-4">
          {/* Role selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">I am a...</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setRole('lab')}
                className={`border rounded-xl p-4 text-left transition-all ${
                  role === 'lab'
                    ? 'border-black bg-black text-white'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                <div className="text-lg mb-1">🔬</div>
                <div className="font-medium text-sm">Lab / Researcher</div>
                <div className={`text-xs mt-1 ${role === 'lab' ? 'text-gray-300' : 'text-gray-400'}`}>
                  Post data collection tasks
                </div>
              </button>
              <button
                type="button"
                onClick={() => setRole('collector')}
                className={`border rounded-xl p-4 text-left transition-all ${
                  role === 'collector'
                    ? 'border-black bg-black text-white'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                <div className="text-lg mb-1">📱</div>
                <div className="font-medium text-sm">Data Collector</div>
                <div className={`text-xs mt-1 ${role === 'collector' ? 'text-gray-300' : 'text-gray-400'}`}>
                  Earn money collecting data
                </div>
              </button>
            </div>
            {role && <input type="hidden" name="role" value={role} />}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display name</label>
            <input
              name="display_name"
              type="text"
              required
              placeholder={role === 'lab' ? 'e.g. Stanford AI Lab' : 'e.g. Alex Chen'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              name="password"
              type="password"
              required
              minLength={6}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>

          {state.error && (
            <p className="text-red-500 text-sm">{state.error}</p>
          )}

          {state.message && (
            <p className="text-green-600 text-sm">{state.message}</p>
          )}

          {!isSupabaseConfigured && (
            <p className="text-red-500 text-sm">
              Supabase is not configured for this local server.
            </p>
          )}

          <button
            type="submit"
            disabled={pending || !role || !isSupabaseConfigured}
            className="w-full bg-black text-white rounded-lg py-2 text-sm font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {pending ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-black font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
