import { Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useSession } from './store'
import { LanguageSwitcher } from '@/components/ui'
import { useGuardSync } from '@/lib/guardQueue'

/** Full screen, dark by default (see useThemeClass), very large touch targets. */
export function GuardLayout() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { user, logout } = useSession()
  useGuardSync()
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex items-center justify-between gap-4 px-6 py-4">
        <p className="text-lg font-semibold">{user?.title ?? t('guard.gate')}</p>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <button
            onClick={() => {
              logout()
              nav('/login')
            }}
            aria-label={t('common.logout')}
            className="flex h-16 w-16 items-center justify-center rounded-card border border-line text-muted"
          >
            <LogOut className="h-6 w-6" />
          </button>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pb-8">
        <Outlet />
      </main>
    </div>
  )
}
