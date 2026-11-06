import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { fmtDate, fmtTime } from '@/lib/format'
import { Async, DataTable, EmptyState, Input, Select, Skeleton } from '@/components/ui'

export default function AuditLog() {
  const [s, setS] = useState('')
  const [actor, setActor] = useState('')
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.listAudit(), refetchInterval: 15000 })
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <Async
        query={q}
        skeleton={<Skeleton className="h-80" />}
        isEmpty={(d) => !d.length}
        empty={
          <EmptyState
            title="Nothing logged yet"
            body="Changes made by staff and residents are recorded here."
          />
        }
      >
        {(all) => {
          const actors = [...new Set(all.map((a) => a.actor))]
          const k = s.trim().toLowerCase()
          const rows = all.filter(
            (a) =>
              (!actor || a.actor === actor) &&
              (!k || `${a.action} ${a.target} ${a.detail}`.toLowerCase().includes(k)),
          )
          return (
            <>
              <div className="flex flex-wrap gap-3">
                <div className="w-64">
                  <Input
                    label="Search"
                    placeholder="Action, target or detail"
                    value={s}
                    onChange={(e) => setS(e.target.value)}
                  />
                </div>
                <div className="w-56">
                  <Select label="Who" value={actor} onChange={(e) => setActor(e.target.value)}>
                    <option value="">Everyone</option>
                    {actors.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </Select>
                </div>
              </div>
              {rows.length === 0 ? (
                <EmptyState title="No entries match" body="Clear a filter to see more." />
              ) : (
                <DataTable
                  caption="Audit log"
                  rowKey={(a) => a.id}
                  rows={rows}
                  columns={[
                    {
                      key: 'at',
                      header: 'When',
                      cell: (a) => (
                        <span className="tabular-nums">
                          {fmtDate(a.at, 'en', false)}, {fmtTime(a.at)}
                        </span>
                      ),
                    },
                    { key: 'who', header: 'Who', cell: (a) => a.actor },
                    {
                      key: 'act',
                      header: 'Action',
                      cell: (a) => <span className="font-medium">{a.action}</span>,
                    },
                    { key: 'tg', header: 'Target', cell: (a) => a.target },
                    {
                      key: 'dt',
                      header: 'Detail',
                      cell: (a) => <span className="text-muted">{a.detail}</span>,
                      hideOnMobile: false,
                    },
                  ]}
                />
              )}
            </>
          )
        }}
      </Async>
    </div>
  )
}
