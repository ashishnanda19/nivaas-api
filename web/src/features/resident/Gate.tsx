import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Copy } from 'lucide-react'
import { api } from '@/lib/api'
import type { Visitor } from '@/lib/api'
import { fmtDate, fmtTime, isoDay } from '@/lib/format'
import { Async, Avatar, Button, EmptyState, Input, Skeleton, StatusPill, Tabs, toast } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useResident } from './hooks'

function VisitorRow({ v, actions }: { v: Visitor; actions?: boolean }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const decide = useMutation({
    mutationFn: (d: 'approved' | 'denied') => api.decideVisitor(v.id, d),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['visitors'] }),
  })
  return (
    <li
      className={`rounded-card border p-4 ${v.status === 'waiting' ? 'border-warning bg-warning-tint' : 'border-line'}`}
    >
      <div className="flex items-center gap-3">
        <Avatar name={v.name} src={v.photo} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{v.name}</p>
          <p className="truncate text-xs text-muted">
            {v.purpose} · {fmtDate(v.createdAt, i18n.language, false)}, {fmtTime(v.createdAt, i18n.language)}
          </p>
        </div>
        <StatusPill status={v.status} label={t(`gate.${v.status}`)} />
      </div>
      {actions && v.status === 'waiting' && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            loading={decide.isPending && decide.variables === 'denied'}
            onClick={() => decide.mutate('denied')}
          >
            {t('gate.deny')}
          </Button>
          <Button
            loading={decide.isPending && decide.variables === 'approved'}
            onClick={() => decide.mutate('approved')}
          >
            {t('gate.approve')}
          </Button>
        </div>
      )}
    </li>
  )
}

function Guests({ flatId }: { flatId: string }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [date, setDate] = useState(isoDay(new Date()))
  const q = useQuery({ queryKey: ['preapprovals', flatId], queryFn: () => api.listPreApprovals(flatId) })
  const create = useMutation({
    mutationFn: () => api.preApprove({ flatId, name: name.trim(), date }),
    onSuccess: () => {
      setName('')
      void qc.invalidateQueries({ queryKey: ['preapprovals'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('common.errorTitle')),
  })
  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast.success(t('gate.copied'))
    } catch {
      toast.info(code)
    }
  }
  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
        className="space-y-3 rounded-card border border-line p-4"
      >
        <p className="font-medium">{t('gate.preapprove')}</p>
        <Input label={t('gate.guestName')} value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label={t('gate.date')}
          type="date"
          min={isoDay(new Date())}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Button type="submit" block loading={create.isPending} disabled={!name.trim()}>
          {t('gate.createCode')}
        </Button>
      </form>
      <Async
        query={q}
        skeleton={<Skeleton className="h-24" />}
        isEmpty={(d) => !d.length}
        empty={<EmptyState title={t('gate.noGuests')} body={t('gate.noGuestsBody')} />}
      >
        {(list) => (
          <ul className="space-y-3">
            {list.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-card border border-line p-4"
              >
                <div>
                  <p className="text-sm text-muted">
                    {t('gate.codeFor', { name: p.name })} · {fmtDate(p.date, i18n.language, false)}
                  </p>
                  <p className="text-2xl font-semibold tracking-[0.2em] tabular-nums">{p.code}</p>
                  <p className="text-xs text-muted">{p.used ? t('gate.used') : t('gate.shareCode')}</p>
                </div>
                <Button
                  variant="secondary"
                  disabled={p.used}
                  onClick={() => void copy(p.code)}
                  aria-label={t('gate.share')}
                >
                  <Copy className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </div>
  )
}

export default function Gate() {
  const { t } = useTranslation()
  const { flatId } = useResident()
  const [tab, setTab] = useState<'today' | 'guests' | 'history'>('today')
  const q = useQuery({
    queryKey: ['visitors', flatId, 'all'],
    queryFn: () => api.listVisitors({ flatId }),
    refetchInterval: 5000,
  })
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return (
    <>
      <PageHeader title={t('gate.title')} />
      <div className="mb-4">
        <Tabs
          label={t('gate.title')}
          value={tab}
          onChange={setTab}
          tabs={[
            {
              id: 'today',
              label: t('gate.today'),
              badge: q.data?.filter((v) => v.status === 'waiting').length,
            },
            { id: 'guests', label: t('gate.guests') },
            { id: 'history', label: t('gate.history') },
          ]}
        />
      </div>
      {tab === 'guests' ? (
        <Guests flatId={flatId} />
      ) : (
        <Async
          query={q}
          skeleton={
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          }
        >
          {(all) => {
            const list = all.filter((v) => +new Date(v.createdAt) >= +start === (tab === 'today'))
            return list.length === 0 ? (
              <EmptyState title={t('gate.empty')} body={t('gate.emptyBody')} />
            ) : (
              <ul className="space-y-3">
                {list.map((v) => (
                  <VisitorRow key={v.id} v={v} actions={tab === 'today'} />
                ))}
              </ul>
            )
          }}
        </Async>
      )}
    </>
  )
}
