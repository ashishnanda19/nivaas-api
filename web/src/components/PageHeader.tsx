import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function PageHeader({ title, back, action }: { title: string; back?: boolean; action?: ReactNode }) {
  const nav = useNavigate()
  const { t } = useTranslation()
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1">
        {back && (
          <button
            onClick={() => nav(-1)}
            aria-label={t('common.back')}
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl text-muted hover:bg-sunken"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <h1 className="truncate text-2xl font-semibold">{title}</h1>
      </div>
      {action}
    </div>
  )
}
