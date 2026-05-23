import { redirect } from 'next/navigation'

// Middleware handles role-based redirect to /lab/dashboard or /collector/tasks
export default function Home() {
  redirect('/login')
}
