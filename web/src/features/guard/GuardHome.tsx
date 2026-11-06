import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CloudOff, Hash, UserPlus, Wifi } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/lib/api'
import { useOnline } from '@/lib/hooks'
import { useQueue } from '@/lib/guardQueue'
import { Select } from '@/components/ui'
import { useGate } from './useGate'

export default function GuardHome() {
  const { t } = useTranslation()
  const online = useOnline()
  const waiting = useQueue().length
  const [gate, setGate] = useGate()
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div
        role="status"
        className={clsx(
          'flex min-h-[64px] items-center gap-3 rounded-card border px-5 text-lg font-medium',
          online ? 'border-line' : 'border-warning bg-warning-tint text-warning',
        )}
      >
        {online ? (
          <Wifi className="h-6 w-6 text-success" aria-hidden />
        ) : (
          <CloudOff className="h-6 w-6" aria-hidden />
        )}
        <span className="flex-1">
          {online
            ? waiting
              ? t('guard.waitingSync', { count: waiting })
              : `${t('guard.online')} · ${t('guard.synced')}`
            : t('guard.offline')}
        </span>
        {waiting > 0 && online && <span className="tabular-nums text-muted">{waiting}</span>}
        {waiting > 0 && !online && (
          <span className="rounded-full bg-warning px-3 py-1 text-base tabular-nums text-slate-950">
            {t('guard.waitingSync', { count: waiting })}
          </span>
        )}
      </div>
      <Select
        label={t('guard.gate')}
        value={gate}
        onChange={(e) => setGate(e.target.value)}
        className="!min-h-[64px] !text-xl"
      >
        {api.gates().map((g) => (
          <option key={g}>{g}</option>
        ))}
      </Select>
      <div className="grid flex-1 gap-4 md:grid-cols-2">
        <Link
          to="/guard/visitor"
          className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-card bg-accent text-3xl font-semibold text-white transition active:scale-[0.98]"
        >
          <UserPlus className="h-14 w-14" aria-hidden />
          {t('guard.newVisitor')}
        </Link>
        <Link
          to="/guard/code"
          className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-card border-2 border-line-strong bg-surface text-3xl font-semibold transition active:scale-[0.98]"
        >
          <Hash className="h-14 w-14" aria-hidden />
          {t('guard.preapproved')}
        </Link>
      </div>
    </div>
  )
}
