import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { ageLabel } from '@/lib/format'
import { Async, Badge, Button, EmptyState, Skeleton, StatusPill, Tabs } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useResident } from './hooks'

export default function Complaints() {
  const { t } = useTranslation()
  const { flatId } = useResident()
  const [f, setF] = useState<'all' | 'open' | 'closed'>('all')
  const q = useQuery({ queryKey: ['complaints', flatId], queryFn: () => api.listComplaints({ flatId }) })
  return (
    <>
      <PageHeader
        title={t('complaints.title')}
        action={
          <Link to="/app/complaints/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden />
              {t('complaints.new')}
            </Button>
          </Link>
        }
      />
      <div className="mb-4">
        <Tabs
          label={t('complaints.title')}
          value={f}
          onChange={setF}
          tabs={[
            { id: 'all', label: t('complaints.all') },
            { id: 'open', label: t('complaints.open') },
            { id: 'closed', label: t('complaints.closed') },
          ]}
        />
      </div>
      <Async
        query={q}
        skeleton={
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        }
        isEmpty={(d) => !d.length}
        empty={
          <EmptyState
            title={t('complaints.empty')}
            body={t('complaints.emptyBody')}
            action={
              <Link to="/app/complaints/new">
                <Button>{t('complaints.new')}</Button>
              </Link>
            }
          />
        }
      >
        {(all) => {
          const list = all.filter((c) =>
            f === 'all' ? true : f === 'open' ? c.status !== 'resolved' : c.status === 'resolved',
          )
          return list.length === 0 ? (
            <EmptyState title={t('complaints.empty')} />
          ) : (
            <ul className="space-y-3">
              {list.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/app/complaints/${c.id}`}
                    className="block rounded-card border border-line p-4 transition hover:border-line-strong"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-2 text-sm font-medium">{c.text}</p>
                      <StatusPill status={c.status} label={t(`complaints.status.${c.status}`)} />
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                      <span>{t(`complaints.cats.${c.category}`)}</span>·<span>{c.id}</span>·
                      <span className="tabular-nums">{ageLabel(Date.now() - +new Date(c.createdAt))}</span>
                      {c.escalated && <Badge tone="danger">{t('complaints.escalated')}</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }}
      </Async>
    </>
  )
}
