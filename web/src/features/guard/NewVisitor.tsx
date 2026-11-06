import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, CloudOff, Loader2, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/lib/api'
import type { Visitor } from '@/lib/api'
import { enqueue } from '@/lib/guardQueue'
import { useOnline } from '@/lib/hooks'
import { Button, Input } from '@/components/ui'
import { CameraCapture } from '@/components/CameraCapture'
import { useGate } from './useGate'
import { GateNotice } from './GateNotice'

const PURPOSES = ['delivery', 'guest', 'cab', 'service', 'help'] as const
const FLATS_KEY = 'nivaas.guard.flats'
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function cachedFlats() {
  try {
    return JSON.parse(localStorage.getItem(FLATS_KEY) ?? 'null') as
      { id: string; residentName: string }[] | null
  } catch {
    return null
  }
}

/** Big, loud result. Green means walk in, red means stop. */
export function Result({
  status,
  name,
  flat,
  onNext,
}: {
  status: 'waiting' | 'approved' | 'denied' | 'offline'
  name: string
  flat: string
  onNext: () => void
}) {
  const { t } = useTranslation()
  const look = {
    waiting: 'border-line bg-surface',
    offline: 'border-warning bg-warning-tint text-warning',
    approved: 'border-transparent bg-success text-slate-950',
    denied: 'border-transparent bg-danger text-slate-950',
  }[status]
  return (
    <div
      role="status"
      aria-live="assertive"
      className={clsx(
        'flex flex-1 flex-col items-center justify-center gap-6 rounded-card border-2 p-8 text-center',
        look,
      )}
    >
      {status === 'waiting' && <Loader2 className="h-20 w-20 animate-spin text-muted" aria-hidden />}
      {status === 'approved' && <Check className="h-28 w-28" strokeWidth={3} aria-hidden />}
      {status === 'denied' && <X className="h-28 w-28" strokeWidth={3} aria-hidden />}
      {status === 'offline' && <CloudOff className="h-20 w-20" aria-hidden />}
      <p
        className={clsx('font-bold', status === 'approved' || status === 'denied' ? 'text-6xl' : 'text-3xl')}
      >
        {
          {
            waiting: t('guard.waiting'),
            approved: t('guard.letIn'),
            denied: t('guard.doNotAllow'),
            offline: t('guard.savedOffline'),
          }[status]
        }
      </p>
      <p className="text-2xl">
        {name} · {flat}
      </p>
      {status !== 'waiting' && (
        <Button
          size="lg"
          variant={status === 'offline' ? 'primary' : 'secondary'}
          className="min-w-[260px] border-slate-950/30 bg-slate-950 text-white"
          onClick={onNext}
        >
          {t('guard.newEntry')}
        </Button>
      )}
    </div>
  )
}

export default function NewVisitor() {
  const { t } = useTranslation()
  const online = useOnline()
  const [gate] = useGate()
  const [step, setStep] = useState(0)
  const [photo, setPhoto] = useState<string>()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [search, setSearch] = useState('')
  const [flat, setFlat] = useState('')
  const [purpose, setPurpose] = useState('')
  const [sent, setSent] = useState<{ id?: string; offline?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const flats = useQuery({
    queryKey: ['guard-flats'],
    queryFn: async () => {
      const r = await api.listGateFlats()
      try {
        localStorage.setItem(FLATS_KEY, JSON.stringify(r))
      } catch {
        /* ignore */
      }
      return r
    },
    initialData: cachedFlats() ?? undefined,
    staleTime: 60000,
    retry: 1,
  })
  const hits = useMemo(() => {
    const k = norm(search)
    return k ? (flats.data ?? []).filter((f) => norm(f.id).includes(k)).slice(0, 6) : []
  }, [search, flats.data])

  const status = useQuery({
    queryKey: ['guard-visitor', sent?.id],
    queryFn: () => api.getVisitor(sent!.id!),
    enabled: !!sent?.id,
    refetchInterval: (q) =>
      (q.state.data as Visitor | undefined)?.status === 'waiting' || !q.state.data ? 2000 : false,
  })

  const reset = () => {
    setStep(0)
    setPhoto(undefined)
    setName('')
    setPhone('')
    setSearch('')
    setFlat('')
    setPurpose('')
    setSent(null)
  }
  const notify = async () => {
    const input = {
      gateId: gate,
      flatId: flat,
      name: name.trim(),
      phone,
      purpose: t(`guard.purposes.${purpose}`),
      photo,
    }
    const queue = () => {
      enqueue({
        kind: 'visitor',
        clientId: `V-${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
        input,
      })
      setSent({ offline: true })
    }
    if (!online) return queue()
    setBusy(true)
    try {
      const v = await api.createVisitor(input)
      setSent({ id: v.id })
    } catch {
      queue()
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    const st = sent.offline ? 'offline' : (status.data?.status ?? 'waiting')
    return <Result status={st} name={name} flat={flat} onNext={reset} />
  }

  const steps = ['photo', 'details', 'flat', 'purpose'] as const
  const canNext = [true, name.trim().length >= 2 && phone.length === 10, !!flat, !!purpose][step]

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex items-center gap-4">
        <Link
          to="/guard"
          aria-label={t('common.back')}
          className="flex h-16 w-16 items-center justify-center rounded-card border border-line"
        >
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <ol className="flex flex-1 gap-2" aria-label="Steps">
          {steps.map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? 'step' : undefined}
              className={clsx(
                'flex-1 rounded-full py-2 text-center text-sm font-medium',
                i === step
                  ? 'bg-accent text-white'
                  : i < step
                    ? 'bg-accent-tint text-ink'
                    : 'bg-sunken text-muted',
              )}
            >
              {t(`guard.steps.${s}`)}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex-1 space-y-5">
        {step === 0 && <CameraCapture value={photo} onChange={setPhoto} />}
        {step === 0 && <GateNotice />}
        {step === 1 && (
          <div className="space-y-4">
            <Input
              label={t('guard.name')}
              className="!min-h-[64px] !text-xl"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              label={t('guard.phone')}
              className="!min-h-[64px] !text-xl tabular-nums"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            />
          </div>
        )}
        {step === 2 && (
          <div className="space-y-4">
            <Input
              label={t('guard.searchFlat')}
              className="!min-h-[64px] !text-xl"
              autoFocus
              placeholder="T07 1203"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setFlat('')
              }}
            />
            {search && hits.length === 0 && <p className="text-lg text-muted">{t('guard.noFlat')}</p>}
            <ul className="grid gap-3 sm:grid-cols-2">
              {hits.map((f) => (
                <li key={f.id}>
                  <button
                    aria-pressed={flat === f.id}
                    onClick={() => setFlat(f.id)}
                    className={clsx(
                      'flex min-h-[72px] w-full flex-col items-start justify-center rounded-card border-2 px-5 text-left transition',
                      flat === f.id ? 'border-accent bg-accent-tint' : 'border-line',
                    )}
                  >
                    <span className="text-2xl font-semibold tabular-nums">{f.id}</span>
                    <span className="text-muted">{f.residentName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {step === 3 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {PURPOSES.map((p) => (
              <button
                key={p}
                aria-pressed={purpose === p}
                onClick={() => setPurpose(p)}
                className={clsx(
                  'min-h-[80px] rounded-card border-2 text-2xl font-semibold transition',
                  purpose === p ? 'border-accent bg-accent-tint text-ink' : 'border-line',
                )}
              >
                {t(`guard.purposes.${p}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3">
        {step === 0 && !photo && (
          <Button size="lg" variant="ghost" block onClick={() => setStep(1)}>
            {t('guard.skipPhoto')}
          </Button>
        )}
        {step < 3 ? (
          <Button size="lg" block disabled={!canNext} onClick={() => setStep(step + 1)}>
            {t('guard.next')}
          </Button>
        ) : (
          <Button size="lg" block disabled={!canNext} loading={busy} onClick={() => void notify()}>
            {t('guard.notify')}
          </Button>
        )}
        {step > 0 && (
          <Button size="lg" variant="secondary" block onClick={() => setStep(step - 1)}>
            {t('common.back')}
          </Button>
        )}
      </div>
    </div>
  )
}
