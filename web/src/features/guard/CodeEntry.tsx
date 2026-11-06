import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Delete } from 'lucide-react'
import clsx from 'clsx'
import { api, ApiError } from '@/lib/api'
import type { Visitor } from '@/lib/api'
import { enqueue } from '@/lib/guardQueue'
import { useOnline } from '@/lib/hooks'
import { Button } from '@/components/ui'
import { Result } from './NewVisitor'
import { useGate } from './useGate'

export default function CodeEntry() {
  const { t } = useTranslation()
  const online = useOnline()
  const [gate] = useGate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<
    { ok: true; v: Visitor } | { ok: false; msg: string } | { offline: true } | null
  >(null)

  const press = (d: string) => setCode((c) => (c.length < 6 ? c + d : c))
  const check = async () => {
    if (!online) {
      enqueue({
        kind: 'code',
        clientId: `K-${Date.now().toString(36)}`,
        createdAt: new Date().toISOString(),
        code,
        gateId: gate,
      })
      return setRes({ offline: true })
    }
    setBusy(true)
    try {
      setRes({ ok: true, v: await api.verifyCode(code, gate) })
    } catch (e) {
      setRes({ ok: false, msg: e instanceof ApiError ? e.message : t('common.errorTitle') })
    } finally {
      setBusy(false)
    }
  }
  const reset = () => {
    setCode('')
    setRes(null)
  }

  if (res) {
    if ('offline' in res) return <Result status="offline" name={code} flat="" onNext={reset} />
    if (res.ok) return <Result status="approved" name={res.v.name} flat={res.v.flatId} onNext={reset} />
    return (
      <div
        role="alert"
        className="flex flex-1 flex-col items-center justify-center gap-6 rounded-card bg-danger p-8 text-center text-slate-950"
      >
        <p className="text-6xl font-bold">{t('guard.doNotAllow')}</p>
        <p className="text-2xl">{res.msg}</p>
        <Button size="lg" className="min-w-[260px] bg-slate-950 text-white" onClick={reset}>
          {t('guard.newEntry')}
        </Button>
      </div>
    )
  }

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
        <h1 className="text-2xl font-semibold">{t('guard.enterCode')}</h1>
      </div>
      <div className="flex justify-center gap-2" role="status" aria-label={code.split('').join(' ')}>
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={clsx(
              'flex h-20 w-14 items-center justify-center rounded-card border-2 text-4xl font-semibold tabular-nums sm:w-16',
              code[i] ? 'border-accent' : 'border-line',
            )}
          >
            {code[i] ?? ''}
          </span>
        ))}
      </div>
      <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            onClick={() => press(d)}
            className="h-20 rounded-card border border-line bg-surface text-3xl font-semibold tabular-nums active:bg-sunken"
          >
            {d}
          </button>
        ))}
        <button
          onClick={() => setCode('')}
          className="h-20 rounded-card border border-line text-base font-medium text-muted active:bg-sunken"
        >
          {t('guard.clear')}
        </button>
        <button
          onClick={() => press('0')}
          className="h-20 rounded-card border border-line bg-surface text-3xl font-semibold active:bg-sunken"
        >
          0
        </button>
        <button
          onClick={() => setCode((c) => c.slice(0, -1))}
          aria-label="Backspace"
          className="flex h-20 items-center justify-center rounded-card border border-line active:bg-sunken"
        >
          <Delete className="h-7 w-7" />
        </button>
      </div>
      <Button
        size="lg"
        className="mx-auto w-full max-w-sm"
        disabled={code.length < 6}
        loading={busy}
        onClick={() => void check()}
      >
        {t('guard.check')}
      </Button>
    </div>
  )
}
