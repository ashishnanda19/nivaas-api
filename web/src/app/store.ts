import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, setAuthLostHandler } from '@/lib/api'
import type { User } from '@/lib/api'
import i18n, { type Lang } from '@/lib/i18n'

export type Theme = 'light' | 'dark' | 'system'

interface SessionState {
  user: User | null
  consent: boolean
  lang: Lang
  theme: Theme
  login: (u: User) => void
  logout: () => void
  giveConsent: () => void
  setLang: (l: Lang) => void
  setTheme: (t: Theme) => void
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      consent: false,
      lang: 'en',
      theme: 'light',
      login: (user) => set({ user }),
      logout: () => {
        void api.logout().catch(() => undefined)
        set({ user: null })
      },
      giveConsent: () => set({ consent: true }),
      setLang: (lang) => {
        void i18n.changeLanguage(lang)
        document.documentElement.lang = lang
        void api.setLanguage(lang).catch(() => undefined) // best effort: the choice also lives on this device
        set({ lang })
      },
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'nivaas.session',
      onRehydrateStorage: () => (s) => {
        if (s) {
          void i18n.changeLanguage(s.lang)
          document.documentElement.lang = s.lang
        }
      },
    },
  ),
)

export const homeFor = (u: User) =>
  u.role === 'resident'
    ? '/app'
    : u.role === 'guard'
      ? '/guard'
      : u.role === 'committee'
        ? '/console/dashboard'
        : '/console/complaints'

// A refresh that fails means the session is over: drop to the login screen.
setAuthLostHandler(() => useSession.setState({ user: null }))
