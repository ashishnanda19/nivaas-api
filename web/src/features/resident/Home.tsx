import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import { Amount, Async, Button, Card, EmptyState, Skeleton, StatusPill } from '@/components/ui'
import { useResident } from './hooks'

const CardSkeleton = () => <Skeleton className="h-[116px] w-full rounded-card" />

export default function Home() {
  const { t, i18n } = useTranslation()
  const { user, flatId } = useResident()
  const bill = useQuery({ queryKey: ['bill', flatId], queryFn: () => api.getBill(flatId) })
  const complaints = useQuery({
    queryKey: ['complaints', flatId],
    queryFn: () => api.listComplaints({ flatId }),
  })
  const visitors = useQuery({
    queryKey: ['visitors', flatId, 'today'],
    queryFn: () => api.listVisitors({ flatId, today: true }),
    refetchInterval: 5000,
  })
  const notices = useQuery({ queryKey: ['notices'], queryFn: () => api.listNotices() })

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted">{t('complaints.flatLabel', { flat: flatId })}</p>
        <h1 className="text-2xl font-semibold">{t('home.greeting', { name: user.name.split(' ')[0] })}</h1>
      </div>

      <Async query={bill} skeleton={<CardSkeleton />}>
        {(b) => (
          <Card className="space-y-3 p-5">
            <div className="flex items-start justify-between">
              <p className="text-sm text-muted">{t('home.dues')}</p>
              {b.status !== 'paid' && (
                <StatusPill
                  status={b.status}
                  label={
                    b.daysOverdue > 0
                      ? t('home.overdueBy', { count: b.daysOverdue })
                      : t('home.dueOn', { date: fmtDate(b.dueDate, i18n.language, false) })
                  }
                />
              )}
            </div>
            {b.total > 0 ? (
              <div className="flex items-end justify-between gap-3">
                <Amount value={b.total} className="text-3xl font-semibold tracking-tight" />
                <Link to="/app/pay">
                  <Button>{t('home.payNow')}</Button>
                </Link>
              </div>
            ) : (
              <p className="text-lg font-medium text-success">{t('home.allClear')}</p>
            )}
          </Card>
        )}
      </Async>

      <Async query={complaints} skeleton={<CardSkeleton />}>
        {(list) => {
          const open = list.filter((c) => c.status !== 'resolved')
          const latest = open[0]
          return (
            <Link to="/app/complaints" className="block">
              <Card className="space-y-2 p-5 transition hover:border-line-strong">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted">{t('home.openComplaints')}</p>
                  <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                </div>
                <p className="text-3xl font-semibold tabular-nums tracking-tight">{open.length}</p>
                {latest ? (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted">{latest.text}</span>
                    <StatusPill status={latest.status} label={t(`complaints.status.${latest.status}`)} />
                  </div>
                ) : (
                  <p className="text-sm text-muted">{t('home.noOpen')}</p>
                )}
              </Card>
            </Link>
          )
        }}
      </Async>

      <Async query={visitors} skeleton={<CardSkeleton />}>
        {(list) => {
          const waiting = list.filter((v) => v.status === 'waiting').length
          return (
            <Link to="/app/gate" className="block">
              <Card
                className={`space-y-2 p-5 transition ${waiting ? 'border-warning bg-warning-tint' : 'hover:border-line-strong'}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted">{t('home.visitorsToday')}</p>
                  <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                </div>
                <p className="text-3xl font-semibold tabular-nums tracking-tight">{list.length}</p>
                <p className={`text-sm ${waiting ? 'font-medium text-warning' : 'text-muted'}`}>
                  {waiting ? t('home.pending', { count: waiting }) : t('home.noVisitors')}
                </p>
              </Card>
            </Link>
          )
        }}
      </Async>

      <section className="pt-2">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('home.notices')}</h2>
          <Link to="/app/notices" className="flex min-h-[44px] items-center text-sm text-ink">
            {t('common.see_all')}
          </Link>
        </div>
        <Async
          query={notices}
          skeleton={<Skeleton className="h-24" />}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState title={t('more.noNotices')} />}
        >
          {(list) => (
            <ul className="divide-y divide-line rounded-card border border-line">
              {list.slice(0, 3).map((n) => (
                <li key={n.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-muted">{fmtDate(n.at, i18n.language)}</p>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </section>
    </div>
  )
}
