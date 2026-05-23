'use client'

import { useEffect, useState } from 'react'

type Toast = { id: number; message: string }

let addToast: ((message: string) => void) | null = null

export function triggerToast(message: string) {
  addToast?.(message)
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    addToast = (message: string) => {
      const id = Date.now()
      setToasts(prev => [...prev, { id, message }])
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, 4000)
    }
    return () => { addToast = null }
  }, [])

  if (!toasts.length) return null

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2"
        >
          <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
          {toast.message}
        </div>
      ))}
    </div>
  )
}
