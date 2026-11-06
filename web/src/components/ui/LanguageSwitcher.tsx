import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { LANGS } from '@/lib/i18n'
import { useSession } from '@/app/store'

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { lang, setLang } = useSession()
  return (
    <div
      role="radiogroup"
      aria-label={t('common.language')}
      className={clsx('inline-flex rounded-ctl bg-sunken p-1', className)}
    >
      {LANGS.map((l) => (
        <button
          key={l.code}
          role="radio"
          aria-checked={lang === l.code}
          onClick={() => setLang(l.code)}
          className={clsx(
            'min-h-[40px] rounded-md px-3 text-sm font-medium transition',
            lang === l.code ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}
