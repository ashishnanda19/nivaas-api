import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Button } from './button'

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={clsx('skeleton relative overflow-hidden rounded-ctl bg-sunken', className)} />
  )
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col items-center gap-1 px-6 py-12 text-center">
      <p className="font-medium">{t('common.errorTitle')}</p>
      <p className="max-w-xs text-sm text-muted">{message ?? t('common.errorBody')}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}

/** One place that guarantees the four states: loading, error, empty, populated. */
export function Async<T>({
  query,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<T>
  skeleton: ReactNode
  isEmpty?: (d: T) => boolean
  empty?: ReactNode
  children: (d: T) => ReactNode
}) {
  if (query.isPending) return <>{skeleton}</>
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  if (isEmpty?.(query.data) && empty) return <>{empty}</>
  return <>{children(query.data)}</>
}
