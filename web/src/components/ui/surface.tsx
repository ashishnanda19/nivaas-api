import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import { inr } from '@/lib/format'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('rounded-card border border-line bg-surface', className)} {...rest} />
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
const tones: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted border-line',
  accent: 'bg-accent-tint text-ink border-transparent',
  success: 'bg-success-tint text-success border-transparent',
  warning: 'bg-warning-tint text-warning border-transparent',
  danger: 'bg-danger-tint text-danger border-transparent',
}
export function Badge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: { tone?: Tone } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}

const STATUS_TONE: Record<string, Tone> = {
  paid: 'success',
  resolved: 'success',
  approved: 'success',
  exact: 'success',
  confirmed: 'success',
  due: 'warning',
  partial: 'warning',
  in_progress: 'warning',
  assigned: 'accent',
  waiting: 'warning',
  likely: 'warning',
  overdue: 'danger',
  urgent: 'danger',
  denied: 'danger',
  unclear: 'danger',
  new: 'neutral',
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
}
export function StatusPill({ status, label }: { status: string; label: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </Badge>
  )
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string; size?: number }) {
  const ini = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return src ? (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className="rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-tint font-medium text-ink"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {ini}
    </span>
  )
}

export function Amount({
  value,
  className,
  digits = 0,
}: {
  value: number
  className?: string
  digits?: number
}) {
  return <span className={clsx('tabular-nums', className)}>{inr(value, digits)}</span>
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted">{label}</p>
      <p
        className={clsx(
          'text-3xl font-semibold tabular-nums tracking-tight',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function ProgressRing({ value, size = 96, label }: { value: number; size?: number; label?: string }) {
  const r = (size - 12) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label ?? ''} ${pct}%`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={8} className="stroke-line" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={8}
          strokeLinecap="round"
          className="stroke-accent"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
        />
      </svg>
      <span className="absolute text-lg font-semibold tabular-nums">{pct}%</span>
    </div>
  )
}
