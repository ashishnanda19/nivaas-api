import { useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlaskConical } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api, resetDemoData } from '@/lib/api'
import { getSettings, setSettings, subscribeSettings } from '@/lib/api/settings'
import { homeFor, useSession } from '@/app/store'

/** Dev-only: jump between roles, flip simulated failures, reset data. Not rendered in production builds. */
export function DevMenu() {
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const qc = useQueryClient()
  const { user, login } = useSession()
  const s = useSyncExternalStore(subscribeSettings, getSettings)
  const toggle = (k: 'flaky' | 'autoRespond' | 'offline') => (
    <label key={k} className="flex min-h-[36px] items-center justify-between gap-6 text-sm">
      {
        {
          flaky: 'Random read errors',
          autoRespond: 'Auto-answer visitors (12 s)',
          offline: 'Simulate offline',
        }[k]
      }
      <input
        type="checkbox"
        checked={s[k]}
        onChange={(e) => setSettings({ [k]: e.target.checked })}
        className="h-4 w-4 accent-indigo-600"
      />
    </label>
  )
  return (
    <div className="fixed bottom-24 left-3 z-[70] md:bottom-4">
      {open && (
        <div className="mb-2 w-72 rounded-card border border-line bg-surface p-3 shadow-float">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Switch role</p>
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            {api.demoUsers().map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  void (async () => {
                    await api.requestOtp(u.phone)
                    const real = await api.verifyOtp(u.phone, '123456')
                    if (real.consent === false) await api.recordConsent()
                    login(real)
                    qc.clear()
                    nav(homeFor(real))
                    setOpen(false)
                  })()
                }}
                className={`rounded-ctl border px-2 py-1.5 text-left text-xs ${user?.id === u.id ? 'border-accent bg-accent-tint text-ink' : 'border-line hover:bg-sunken'}`}
              >
                <span className="block font-medium">{u.name}</span>
                <span className="text-muted">{u.role}</span>
              </button>
            ))}
          </div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Simulation</p>
          {(['flaky', 'autoRespond', 'offline'] as const).map(toggle)}
          <button
            onClick={() => {
              resetDemoData()
              qc.clear()
              setOpen(false)
              nav(0)
            }}
            className="mt-2 min-h-[36px] w-full rounded-ctl border border-line text-sm hover:bg-sunken"
          >
            Reset demo data
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Developer menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-float hover:text-fg"
      >
        <FlaskConical className="h-5 w-5" />
      </button>
    </div>
  )
}
