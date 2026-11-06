import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Layers, Star } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/lib/api'
import type { TimelineStep } from '@/lib/api'
import { fmtDate, fmtTime } from '@/lib/format'
import { Async, Badge, Button, Input, Skeleton, StatusPill, Timeline, toast } from '@/components/ui'
import { Countdown } from '@/components/Countdown'
import { PageHeader } from '@/components/PageHeader'
import { useResident } from './hooks'

const STEPS: TimelineStep[] = ['raised', 'assigned', 'in_progress', 'resolved']

export default function ComplaintDetail() {
  const { id = '' } = useParams()
  const { t, i18n } = useTranslation()
  const { user } = useResident()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [hover, setHover] = useState(0)
  const q = useQuery({ queryKey: ['complaint', id], queryFn: () => api.getComplaint(id) })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['complaint', id] })
    void qc.invalidateQueries({ queryKey: ['complaints'] })
  }
  const comment = useMutation({
    mutationFn: () => api.addComment(id, user.name, false, note.trim()),
    onSuccess: () => {
      setNote('')
      refresh()
    },
  })
  const rate = useMutation({
    mutationFn: (n: number) => api.rate(id, n),
    onSuccess: () => {
      toast.success(t('complaints.thanks'))
      refresh()
    },
  })
  const reopen = useMutation({ mutationFn: () => api.reopen(id, user.name), onSuccess: refresh })

  return (
    <>
      <PageHeader title={id} back />
      <Async
        query={q}
        skeleton={
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        }
      >
        {(c) => {
          const reached = new Set(c.timeline.map((x) => x.step))
          const done = STEPS.filter((s) => reached.has(s)).length
          const at = (s: TimelineStep) => {
            const e = [...c.timeline].reverse().find((x) => x.step === s)
            return e ? `${fmtDate(e.at, i18n.language, false)}, ${fmtTime(e.at, i18n.language)}` : undefined
          }
          return (
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <StatusPill status={c.status} label={t(`complaints.status.${c.status}`)} />
                  <span className="text-sm text-muted">{t(`complaints.cats.${c.category}`)}</span>
                  {c.escalated && <Badge tone="danger">{t('complaints.escalated')}</Badge>}
                </div>
                <p className="text-base">{c.text}</p>
                {c.photo && (
                  <img
                    src={c.photo}
                    alt=""
                    className="h-32 w-32 rounded-card border border-line object-cover"
                  />
                )}
              </div>

              {c.clusterFlats > 1 && (
                <div className="flex items-start gap-2 rounded-card bg-accent-tint p-3 text-sm text-ink">
                  <Layers className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {t('complaints.clusterBanner', { count: c.clusterFlats })}
                </div>
              )}

              <section className="rounded-card border border-line p-4">
                <Timeline
                  doneCount={done}
                  steps={STEPS.map((s) => ({ key: s, label: t(`complaints.step.${s}`), at: at(s) }))}
                />
              </section>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-card border border-line p-3">
                  <dt className="text-xs text-muted">{t('complaints.assignee')}</dt>
                  <dd className="mt-0.5 font-medium">{c.assignee ?? t('complaints.unassigned')}</dd>
                </div>
                <div className="rounded-card border border-line p-3">
                  <dt className="text-xs text-muted">{t('complaints.responseBy')}</dt>
                  <dd className="mt-1">
                    {c.status === 'resolved' ? (
                      <StatusPill status="resolved" label={t('complaints.status.resolved')} />
                    ) : (
                      <Countdown createdAt={c.createdAt} dueAt={c.dueAt} />
                    )}
                  </dd>
                </div>
              </dl>

              {c.status === 'resolved' && (
                <section className="space-y-3 rounded-card border border-line p-4">
                  <p className="text-sm font-medium">{t('complaints.rateTitle')}</p>
                  <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        aria-label={`${n} / 5`}
                        onMouseEnter={() => setHover(n)}
                        onClick={() => rate.mutate(n)}
                        className="flex h-11 w-11 items-center justify-center"
                      >
                        <Star
                          className={clsx(
                            'h-7 w-7 transition',
                            n <= (hover || c.rating || 0) ? 'fill-warning text-warning' : 'text-line-strong',
                          )}
                        />
                      </button>
                    ))}
                  </div>
                  <Button variant="secondary" loading={reopen.isPending} onClick={() => reopen.mutate()}>
                    {t('complaints.reopen')}
                  </Button>
                </section>
              )}

              <section className="space-y-3">
                <h2 className="text-base font-semibold">{t('complaints.comments')}</h2>
                {c.comments.map((m) => (
                  <div
                    key={m.id}
                    className={clsx(
                      'max-w-[90%] rounded-card px-3 py-2 text-sm',
                      m.staff ? 'bg-sunken' : 'ml-auto bg-accent-tint text-ink',
                    )}
                  >
                    <p className="text-xs text-muted">
                      {m.by} · {fmtTime(m.at, i18n.language)}
                    </p>
                    <p>{m.text}</p>
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (note.trim()) comment.mutate()
                  }}
                  className="flex items-end gap-2"
                >
                  <Input
                    label={t('complaints.addComment')}
                    wrapperClassName="flex-1"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Button type="submit" loading={comment.isPending} disabled={!note.trim()}>
                    {t('common.send')}
                  </Button>
                </form>
              </section>
            </div>
          )
        }}
      </Async>
    </>
  )
}
