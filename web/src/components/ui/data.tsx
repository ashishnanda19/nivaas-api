import { useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ArrowDown, ArrowUp, Check } from 'lucide-react'
import clsx from 'clsx'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => ReactNode
  sortValue?: (row: T) => string | number
  className?: string
  /** Hide this column in the mobile card view. */
  hideOnMobile?: boolean
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  caption,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (r: T) => string
  onRowClick?: (r: T) => void
  caption: string
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key)
    if (!col?.sortValue || !sort) return rows
    const sv = col.sortValue
    return [...rows].sort((a, b) => (sv(a) > sv(b) ? 1 : sv(a) < sv(b) ? -1 : 0) * sort.dir)
  }, [rows, sort, columns])

  return (
    <>
      <div className="hidden max-h-[70vh] overflow-auto rounded-card border border-line md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  className={clsx(
                    'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-sunken px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted',
                    c.className,
                  )}
                >
                  {c.sortValue ? (
                    <button
                      className="inline-flex items-center gap-1 uppercase"
                      onClick={() =>
                        setSort((s) =>
                          s?.key === c.key
                            ? { key: c.key, dir: (s.dir * -1) as 1 | -1 }
                            : { key: c.key, dir: 1 },
                        )
                      }
                    >
                      {c.header}
                      {sort?.key === c.key &&
                        (sort.dir === 1 ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        ))}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={clsx(
                  'border-b border-line last:border-0',
                  onRowClick && 'cursor-pointer hover:bg-sunken',
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx('px-4 py-3 align-middle', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {sorted.map((r) => (
          <li key={rowKey(r)}>
            <div
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className="space-y-1.5 rounded-card border border-line bg-surface p-4"
            >
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="flex items-start justify-between gap-4 text-sm">
                    <span className="text-muted">{c.header}</span>
                    <span className="text-right">{c.cell(r)}</span>
                  </div>
                ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

export interface TimelineStepData {
  key: string
  label: string
  at?: string
}

/** Vertical status timeline; the connector fills as steps complete. */
export function Timeline({ steps, doneCount }: { steps: TimelineStepData[]; doneCount: number }) {
  return (
    <ol className="relative space-y-5">
      {steps.map((s, i) => {
        const done = i < doneCount
        const current = i === doneCount - 1
        return (
          <li key={s.key} className="relative flex gap-3">
            {i < steps.length - 1 && (
              <span className="absolute left-[11px] top-6 h-[calc(100%+8px)] w-0.5 bg-line" aria-hidden>
                <motion.span
                  className="block w-full bg-accent"
                  initial={{ height: 0 }}
                  animate={{ height: i < doneCount - 1 ? '100%' : 0 }}
                  transition={{ duration: 0.4, delay: i * 0.12, ease: 'easeOut' }}
                />
              </span>
            )}
            <span
              className={clsx(
                'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                done ? 'border-accent bg-accent text-white' : 'border-line-strong bg-surface',
              )}
            >
              {done && <Check className="h-3.5 w-3.5" aria-hidden />}
            </span>
            <div className="-mt-0.5">
              <p className={clsx('text-sm', done ? 'font-medium' : 'text-muted', current && 'text-ink')}>
                {s.label}
              </p>
              {s.at && <p className="text-xs text-muted">{s.at}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: string; badge?: number }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex w-full rounded-ctl bg-sunken p-1 md:w-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            'flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-medium transition duration-150 md:flex-none',
            value === t.id ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.badge !== undefined && t.badge > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-xs text-white">{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}
