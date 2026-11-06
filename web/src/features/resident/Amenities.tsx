import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/lib/api'
import type { Amenity } from '@/lib/api'
import { fmtDate, inr, isoDay, nextDays } from '@/lib/format'
import { Async, Button, EmptyState, Sheet, Skeleton, Tabs, toast } from '@/components/ui'
import { PageHeader } from '@/components/PageHeader'
import { useResident } from './hooks'

function BookSheet({ amenity, onClose }: { amenity: Amenity | null; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const { flatId } = useResident()
  const qc = useQueryClient()
  const [days] = useState(() => nextDays(7))
  const [day, setDay] = useState(isoDay(days[0]))
  const [slot, setSlot] = useState('')
  const [done, setDone] = useState(false)
  const booked = useQuery({
    queryKey: ['bookings', amenity?.id],
    queryFn: () => api.listBookings({ amenityId: amenity!.id }),
    enabled: !!amenity,
  })
  const book = useMutation({
    mutationFn: () => api.book({ amenityId: amenity!.id, flatId, date: day, slot }),
    onSuccess: () => {
      setDone(true)
      void qc.invalidateQueries({ queryKey: ['bookings'] })
      toast.success(t('amenities.done'))
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : t('common.errorTitle'))
      void booked.refetch()
      setSlot('')
    },
  })
  const close = () => {
    onClose()
    setTimeout(() => {
      setDone(false)
      setSlot('')
    }, 250)
  }
  const taken = (s: string) => booked.data?.some((b) => b.date === day && b.slot === s)
  return (
    <Sheet
      open={!!amenity}
      onClose={close}
      title={amenity?.name ?? ''}
      closeLabel={t('common.close')}
      footer={
        amenity &&
        (done ? (
          <Button block onClick={close}>
            {t('common.done')}
          </Button>
        ) : (
          <Button block disabled={!slot} loading={book.isPending} onClick={() => book.mutate()}>
            {t('amenities.confirmBtn')}
            {slot && ` · ${amenity.fee ? inr(amenity.fee) : t('amenities.free')}`}
          </Button>
        ))
      }
    >
      {amenity &&
        (done ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <CheckCircle2 className="h-14 w-14 text-success" />
            </motion.div>
            <p className="font-medium">{t('amenities.done')}</p>
            <p className="text-sm text-muted">
              {fmtDate(day, i18n.language)} · {slot}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium">{t('amenities.pickDay')}</p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {days.map((d) => {
                  const k = isoDay(d)
                  return (
                    <button
                      key={k}
                      aria-pressed={day === k}
                      onClick={() => {
                        setDay(k)
                        setSlot('')
                      }}
                      className={clsx(
                        'flex min-h-[64px] min-w-[56px] flex-col items-center justify-center rounded-ctl border text-sm transition',
                        day === k ? 'border-accent bg-accent-tint text-ink' : 'border-line hover:bg-sunken',
                      )}
                    >
                      <span className="text-xs text-muted">
                        {d.toLocaleDateString(i18n.language === 'en' ? 'en-IN' : `${i18n.language}-IN`, {
                          weekday: 'short',
                        })}
                      </span>
                      <span className="font-semibold tabular-nums">{d.getDate()}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">{t('amenities.pickSlot')}</p>
              {booked.isPending ? (
                <Skeleton className="h-28" />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {amenity.slots.map((s) => (
                    <button
                      key={s}
                      disabled={taken(s)}
                      aria-pressed={slot === s}
                      onClick={() => setSlot(s)}
                      className={clsx(
                        'min-h-[48px] rounded-ctl border text-sm tabular-nums transition disabled:cursor-not-allowed disabled:bg-sunken disabled:text-muted disabled:line-through',
                        slot === s
                          ? 'border-accent bg-accent-tint font-medium text-ink'
                          : 'border-line hover:bg-sunken',
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2 rounded-card bg-sunken p-4 text-sm">
              <p className="font-medium">
                {t('amenities.fee')}:{' '}
                {amenity.fee ? `${inr(amenity.fee)} ${amenity.feeNote}` : t('amenities.free')}
              </p>
              {amenity.fee > 0 && <p className="text-muted">{t('amenities.payAtDesk')}</p>}
              <p className="pt-1 font-medium">{t('amenities.rules')}</p>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {amenity.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
    </Sheet>
  )
}

function MyBookings({ flatId }: { flatId: string }) {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['bookings', 'mine', flatId], queryFn: () => api.listBookings({ flatId }) })
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelBooking(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bookings'] }),
  })
  return (
    <Async
      query={q}
      skeleton={<Skeleton className="h-32" />}
      isEmpty={(d) => !d.length}
      empty={<EmptyState title={t('amenities.none')} body={t('amenities.noneBody')} />}
    >
      {(list) => (
        <ul className="space-y-3">
          {[...list]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 rounded-card border border-line p-4"
              >
                <div>
                  <p className="font-medium">{b.amenityName}</p>
                  <p className="text-sm text-muted">
                    {fmtDate(b.date, i18n.language)} · {b.slot}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  loading={cancel.isPending && cancel.variables === b.id}
                  onClick={() => cancel.mutate(b.id)}
                >
                  {t('amenities.cancel')}
                </Button>
              </li>
            ))}
        </ul>
      )}
    </Async>
  )
}

export default function Amenities() {
  const { t } = useTranslation()
  const { flatId } = useResident()
  const [tab, setTab] = useState<'book' | 'mine'>('book')
  const [sel, setSel] = useState<Amenity | null>(null)
  const q = useQuery({ queryKey: ['amenities'], queryFn: () => api.listAmenities() })
  return (
    <>
      <PageHeader title={t('amenities.title')} back />
      <div className="mb-4">
        <Tabs
          label={t('amenities.title')}
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'book', label: t('amenities.book') },
            { id: 'mine', label: t('amenities.my') },
          ]}
        />
      </div>
      {tab === 'mine' ? (
        <MyBookings flatId={flatId} />
      ) : (
        <Async
          query={q}
          skeleton={
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          }
        >
          {(list) => (
            <ul className="space-y-3">
              {list.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => setSel(a)}
                    className="flex min-h-[72px] w-full items-center justify-between gap-3 rounded-card border border-line p-4 text-left transition hover:border-line-strong"
                  >
                    <span>
                      <span className="block font-medium">{a.name}</span>
                      <span className="text-sm text-muted">
                        {a.fee ? `${inr(a.fee)} ${a.feeNote}` : t('amenities.free')}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-ink">{t('amenities.book')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Async>
      )}
      <BookSheet amenity={sel} onClose={() => setSel(null)} />
    </>
  )
}
