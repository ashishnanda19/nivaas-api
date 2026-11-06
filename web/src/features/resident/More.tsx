import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell, CalendarDays, ChevronRight, LogOut, ShieldCheck, Users } from 'lucide-react'
import clsx from 'clsx'
import { useSession, type Theme } from '@/app/store'
import { Avatar, LanguageSwitcher } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'

export default function More() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { user, consent, theme, setTheme, logout } = useSession()
  const rows = [
    { to: '/app/notices', icon: Bell, label: t('more.notices') },
    { to: '/app/family', icon: Users, label: t('more.family') },
    { to: '/app/amenities', icon: CalendarDays, label: t('more.amenities') },
  ]
  return (
    <>
      <PageHeader title={t('more.title')} />
      <div className="mb-5 flex items-center gap-3">
        <Avatar name={user!.name} size={48} />
        <div>
          <p className="font-medium">{user!.name}</p>
          <p className="text-sm text-muted">
            {user!.flatId} · {t(`family.roles.${user!.memberRole ?? 'owner'}`)}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-line rounded-card border border-line">
        {rows.map(({ to, icon: Icon, label }) => (
          <li key={to}>
            <Link to={to} className="flex min-h-[56px] items-center gap-3 px-4 transition hover:bg-sunken">
              <Icon className="h-5 w-5 text-muted" aria-hidden />
              <span className="flex-1 text-sm font-medium">{label}</span>
              <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>

      <section className="mt-6 space-y-3">
        <h2 className="text-sm font-medium">{t('more.language')}</h2>
        <LanguageSwitcher />
        <h2 className="pt-2 text-sm font-medium">{t('more.theme')}</h2>
        <div role="radiogroup" aria-label={t('more.theme')} className="inline-flex rounded-ctl bg-sunken p-1">
          {(['light', 'dark', 'system'] as Theme[]).map((v) => (
            <button
              key={v}
              role="radio"
              aria-checked={theme === v}
              onClick={() => setTheme(v)}
              className={clsx(
                'min-h-[40px] rounded-md px-4 text-sm font-medium',
                theme === v ? 'bg-surface shadow-sm' : 'text-muted',
              )}
            >
              {t(`common.${v}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-card border border-line p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="h-4 w-4 text-ink" aria-hidden />
          {t('more.privacy')}
        </h2>
        <p className="text-sm text-muted">{t('more.privacyBody')}</p>
        {consent && <p className="mt-2 text-xs text-success">{t('more.consentGiven')}</p>}
      </section>

      <button
        onClick={() => {
          logout()
          nav('/login')
        }}
        className="mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctl border border-line text-sm font-medium text-danger hover:bg-sunken"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {t('common.logout')}
      </button>
    </>
  )
}
