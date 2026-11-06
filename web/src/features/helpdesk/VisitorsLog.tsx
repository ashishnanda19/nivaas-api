import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtDate, fmtTime } from '@/lib/format'
import { Async, Avatar, DataTable, EmptyState, Input, Skeleton, StatusPill } from '@/components/ui'

export default function VisitorsLog() {
  const [s, setS] = useState('')
  const q = useQuery({
    queryKey: ['visitors', 'log'],
    queryFn: () => api.listVisitors(),
    refetchInterval: 10000,
  })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Visitors log</h1>
        <div className="w-64">
          <Input
            label="Search visitors"
            wrapperClassName="[&>label]:sr-only"
            placeholder="Name, flat, gate or purpose"
            value={s}
            onChange={(e) => setS(e.target.value)}
          />
        </div>
      </div>
      <p className="flex items-center gap-2 rounded-ctl bg-accent-tint px-3 py-2 text-sm text-ink">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        Visitor photos are deleted automatically after 90 days, as required under the DPDP Act 2023. Notices
        are displayed at all four gates.
      </p>
      <Async
        query={q}
        skeleton={<Skeleton className="h-80" />}
        isEmpty={(d) => !d.length}
        empty={<EmptyState title="No visitors yet" body="Entries made by guards appear here." />}
      >
        {(all) => {
          const k = s.trim().toLowerCase()
          const rows = all.filter(
            (v) => !k || `${v.name} ${v.flatId} ${v.gateId} ${v.purpose}`.toLowerCase().includes(k),
          )
          return rows.length === 0 ? (
            <EmptyState title="No visitor matches" body="Try a different word." />
          ) : (
            <DataTable
              caption="Visitors"
              rowKey={(v) => v.id}
              rows={rows}
              columns={[
                {
                  key: 'who',
                  header: 'Visitor',
                  cell: (v) => (
                    <span className="flex items-center gap-2">
                      <Avatar name={v.name} src={v.photo} size={32} />
                      <span className="font-medium">{v.name}</span>
                    </span>
                  ),
                  sortValue: (v) => v.name,
                },
                { key: 'f', header: 'Flat', cell: (v) => v.flatId, sortValue: (v) => v.flatId },
                { key: 'p', header: 'Purpose', cell: (v) => v.purpose },
                { key: 'g', header: 'Gate', cell: (v) => v.gateId },
                {
                  key: 't',
                  header: 'Time',
                  cell: (v) => (
                    <span className="tabular-nums">
                      {fmtDate(v.createdAt, 'en', false)}, {fmtTime(v.createdAt)}
                    </span>
                  ),
                  sortValue: (v) => -+new Date(v.createdAt),
                },
                {
                  key: 's',
                  header: 'Status',
                  cell: (v) => (
                    <StatusPill status={v.status} label={v.status[0].toUpperCase() + v.status.slice(1)} />
                  ),
                },
              ]}
            />
          )
        }}
      </Async>
    </div>
  )
}
