import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import { Async, EmptyState, Skeleton } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'

export default function Notices() {
  const { t, i18n } = useTranslation()
  const q = useQuery({ queryKey: ['notices'], queryFn: () => api.listNotices() })
  return (
    <>
      <PageHeader title={t('more.notices')} back />
      <Async
        query={q}
        skeleton={<Skeleton className="h-64" />}
        isEmpty={(d) => !d.length}
        empty={<EmptyState title={t('more.noNotices')} />}
      >
        {(list) => (
          <ul className="space-y-3">
            {list.map((n) => (
              <li key={n.id} className="rounded-card border border-line p-4">
                <p className="font-medium">{n.title}</p>
                <p className="mt-1 text-sm text-muted">{n.body}</p>
                <p className="mt-2 text-xs text-muted">{fmtDate(n.at, i18n.language)}</p>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </>
  )
}
