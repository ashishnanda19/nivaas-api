import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { fmtDate, inr, isoDay, nextDays } from '@/lib/format'
import { Async, DataTable, EmptyState, Skeleton, Tabs } from '@/components/ui'

export default function Bookings() {
  // A seven-column calendar does not fit a phone, so phones start on the list.
  const [view, setView] = useState<'calendar' | 'list'>(() =>
    window.matchMedia('(max-width: 767px)').matches ? 'list' : 'calendar',
  )
  const q = useQuery({ queryKey: ['bookings', 'all'], queryFn: () => api.listBookings() })
  const [days] = useState(() => nextDays(7))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Amenity bookings</h1>
        <Tabs
          label="View"
          value={view}
          onChange={setView}
          tabs={[
            { id: 'calendar', label: 'Calendar' },
            { id: 'list', label: 'List' },
          ]}
        />
      </div>
      <Async
        query={q}
        skeleton={<Skeleton className="h-80" />}
        isEmpty={(d) => !d.length}
        empty={<EmptyState title="No bookings" body="Resident bookings show up here." />}
      >
        {(rows) =>
          view === 'list' ? (
            <DataTable
              caption="Bookings"
              rowKey={(b) => b.id}
              rows={rows}
              columns={[
                {
                  key: 'a',
                  header: 'Amenity',
                  cell: (b) => <span className="font-medium">{b.amenityName}</span>,
                  sortValue: (b) => b.amenityName,
                },
                { key: 'd', header: 'Date', cell: (b) => fmtDate(b.date), sortValue: (b) => b.date },
                { key: 's', header: 'Slot', cell: (b) => <span className="tabular-nums">{b.slot}</span> },
                { key: 'f', header: 'Flat', cell: (b) => b.flatId },
                {
                  key: 'fee',
                  header: 'Fee',
                  cell: (b) => (b.fee ? inr(b.fee) : 'Included'),
                  className: 'text-right',
                },
              ]}
            />
          ) : (
            <div className="overflow-x-auto rounded-card border border-line">
              <div className="grid min-w-[760px] grid-cols-7 divide-x divide-line">
                {days.map((d) => {
                  const k = isoDay(d)
                  const items = rows.filter((b) => b.date === k).sort((a, b) => a.slot.localeCompare(b.slot))
                  return (
                    <section key={k} aria-label={fmtDate(d)} className="min-h-[320px]">
                      <h2 className="border-b border-line bg-sunken px-3 py-2 text-xs font-medium">
                        <span className="block text-muted">
                          {d.toLocaleDateString('en-IN', { weekday: 'short' })}
                        </span>
                        <span className="tabular-nums">
                          {d.getDate()} {d.toLocaleDateString('en-IN', { month: 'short' })}
                        </span>
                      </h2>
                      <ul className="space-y-1.5 p-2">
                        {items.length === 0 && <li className="px-1 py-2 text-xs text-muted">No bookings</li>}
                        {items.map((b) => (
                          <li key={b.id} className="rounded-ctl bg-accent-tint p-2 text-xs text-ink">
                            <p className="font-medium">{b.amenityName}</p>
                            <p className="tabular-nums">{b.slot}</p>
                            <p className="opacity-80">{b.flatId}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )
                })}
              </div>
            </div>
          )
        }
      </Async>
    </div>
  )
}
