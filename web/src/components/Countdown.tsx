import { Clock } from 'lucide-react'
import { Badge } from '@/components/ui'
import { countdownLabel } from '@/lib/format'
import { useNow } from '@/lib/hooks'

/** Response-by countdown: neutral, then amber in the last third, then red once overdue. */
export function Countdown({
  createdAt,
  dueAt,
  className,
}: {
  createdAt: string
  dueAt: string
  className?: string
}) {
  const now = useNow(30000)
  const total = +new Date(dueAt) - +new Date(createdAt)
  const left = +new Date(dueAt) - now
  const tone = left < 0 ? 'danger' : left < total / 3 ? 'warning' : 'neutral'
  return (
    <Badge tone={tone} className={className}>
      <Clock className="h-3 w-3" aria-hidden />
      <span className="tabular-nums">{countdownLabel(left)}</span>
    </Badge>
  )
}
