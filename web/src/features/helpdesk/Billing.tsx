import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtDate, inr, LATE_FEE_RATE_PA } from '@/lib/format'
import {
  Amount,
  Async,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  Modal,
  Skeleton,
  StatusPill,
  Tabs,
  toast,
} from '@/components/ui'
import { useSession } from '@/app/store'

function BillRun({ ro }: { ro: boolean }) {
  const user = useSession((s) => s.user)!
  const qc = useQueryClient()
  const [previewing, setPreviewing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const preview = useQuery({
    queryKey: ['billrun'],
    queryFn: () => api.previewBillRun(),
    enabled: previewing,
  })
  const runs = useQuery({ queryKey: ['billruns'], queryFn: () => api.publishedRuns() })
  const publish = useMutation({
    mutationFn: (m: string) => api.publishBillRun(m, user.name),
    onSuccess: () => {
      setConfirm(false)
      toast.success('Bill run published')
      void qc.invalidateQueries({ queryKey: ['billruns'] })
      void qc.invalidateQueries({ queryKey: ['audit'] })
    },
    onError: (e) => {
      setConfirm(false)
      toast.error(e instanceof Error ? e.message : 'Failed')
    },
  })
  const published = (m: string) => runs.data?.includes(m)
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-2 p-5">
          <h2 className="font-medium">Late-fee rules</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Bills fall due on the 10th. Most residents pay in the first 10 days.</li>
            <li>
              After the due date, simple interest of {Math.round(LATE_FEE_RATE_PA * 100)}% a year runs on the
              unpaid amount, counted by day.
            </li>
            <li>Rate and interest follow the society bye-laws under Maharashtra cooperative law.</li>
          </ul>
        </Card>
        <Card className="flex flex-col items-start justify-between gap-4 p-5">
          <div>
            <h2 className="font-medium">Monthly bill run</h2>
            <p className="text-sm text-muted">Area × rate for every flat. Preview first, then publish.</p>
          </div>
          {!previewing && (
            <Button onClick={() => setPreviewing(true)} disabled={ro}>
              Preview next bill run
            </Button>
          )}
          {ro && <p className="text-xs text-muted">Committee members can view but not publish.</p>}
        </Card>
      </div>
      {previewing && (
        <Async query={preview} skeleton={<Skeleton className="h-72" />}>
          {(p) => (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex gap-8">
                  <div>
                    <p className="text-sm text-muted">Month</p>
                    <p className="text-xl font-semibold">{p.month}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted">Rate</p>
                    <p className="text-xl font-semibold tabular-nums">{inr(p.rate, 2)} / sq ft</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted">Flats · Total</p>
                    <p className="text-xl font-semibold tabular-nums">
                      {p.flats.toLocaleString('en-IN')} · {inr(p.total)}
                    </p>
                  </div>
                </div>
                {published(p.month) ? (
                  <StatusPill status="paid" label="Published" />
                ) : (
                  <Button onClick={() => setConfirm(true)}>Publish bills</Button>
                )}
              </div>
              <p className="text-xs text-muted">
                Showing the {p.rows.length} sample flats in this demo. The total is scaled to all 2,400 flats.
              </p>
              <DataTable
                caption="Bill run preview"
                rowKey={(r) => r.flatId}
                rows={p.rows}
                columns={[
                  {
                    key: 'f',
                    header: 'Flat',
                    cell: (r) => <span className="font-medium">{r.flatId}</span>,
                    sortValue: (r) => r.flatId,
                  },
                  { key: 'n', header: 'Resident', cell: (r) => r.name },
                  {
                    key: 'a',
                    header: 'Area (sq ft)',
                    cell: (r) => <span className="tabular-nums">{r.area.toLocaleString('en-IN')}</span>,
                    sortValue: (r) => r.area,
                  },
                  {
                    key: 'b',
                    header: 'Bill',
                    cell: (r) => <Amount value={r.amount} />,
                    sortValue: (r) => r.amount,
                    className: 'text-right',
                  },
                ]}
              />
              <Modal
                open={confirm}
                onClose={() => setConfirm(false)}
                title={`Publish ${p.month} bills?`}
                footer={
                  <>
                    <Button variant="secondary" onClick={() => setConfirm(false)}>
                      Cancel
                    </Button>
                    <Button loading={publish.isPending} onClick={() => publish.mutate(p.month)}>
                      Publish
                    </Button>
                  </>
                }
              >
                <p className="text-sm">
                  Residents of all {p.flats.toLocaleString('en-IN')} flats will see their bill of about{' '}
                  {inr(p.total / p.flats)}. This is logged in the audit log.
                </p>
              </Modal>
            </div>
          )}
        </Async>
      )}
    </div>
  )
}

function Lookup({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial)
  const [flat, setFlat] = useState<string | null>(null)
  const flats = useQuery({ queryKey: ['flat-search', q], queryFn: () => api.searchFlats(q) })
  const ledger = useQuery({
    queryKey: ['ledger', flat],
    queryFn: () => api.getLedger(flat!),
    enabled: !!flat,
  })
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-[38px] h-4 w-4 text-muted" aria-hidden />
          <Input
            label="Find a flat"
            className="pl-9"
            placeholder="T12-0408 or a name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Async
          query={flats}
          skeleton={<Skeleton className="h-64" />}
          isEmpty={(d) => !d.length}
          empty={<EmptyState title="No flat found" body="Try a tower number or part of a name." />}
        >
          {(list) => (
            <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto rounded-card border border-line">
              {list.slice(0, 40).map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => setFlat(f.id)}
                    aria-pressed={flat === f.id}
                    className={`flex min-h-[52px] w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-sunken ${flat === f.id ? 'bg-accent-tint' : ''}`}
                  >
                    <span>
                      <span className="block font-medium">{f.id}</span>
                      <span className="text-xs text-muted">
                        {f.residentName}
                        {f.tenant ? ' (tenant)' : ''}
                      </span>
                    </span>
                    {f.outstanding > 0 ? (
                      <span className="text-xs font-medium text-danger tabular-nums">
                        {inr(f.outstanding)} due
                      </span>
                    ) : (
                      <span className="text-xs text-success">Paid</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </div>
      <div>
        {!flat ? (
          <Card>
            <EmptyState title="Choose a flat" body="Its ledger shows here." />
          </Card>
        ) : (
          <Async
            query={ledger}
            skeleton={<Skeleton className="h-72" />}
            isEmpty={(d) => !d.length}
            empty={<EmptyState title="No entries" />}
          >
            {(rows) => (
              <DataTable
                caption={`Ledger for ${flat}`}
                rowKey={(r) => r.id}
                rows={rows}
                columns={[
                  { key: 'd', header: 'Date', cell: (r) => fmtDate(r.date) },
                  { key: 'e', header: 'Entry', cell: (r) => r.desc },
                  {
                    key: 'c',
                    header: 'Charge',
                    cell: (r) => (r.debit ? <Amount value={r.debit} /> : '–'),
                    className: 'text-right',
                  },
                  {
                    key: 'p',
                    header: 'Paid',
                    cell: (r) => (r.credit ? <Amount value={r.credit} className="text-success" /> : '–'),
                    className: 'text-right',
                  },
                  {
                    key: 'b',
                    header: 'Balance',
                    cell: (r) => <Amount value={r.balance} className="font-medium" />,
                    className: 'text-right',
                  },
                ]}
              />
            )}
          </Async>
        )}
      </div>
    </div>
  )
}

export default function Billing() {
  const ro = useSession((s) => s.user!.role === 'committee')
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'ledger' | 'run'>(params.get('q') ? 'ledger' : 'run')
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <Tabs
        label="Billing"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'run', label: 'Bill run' },
          { id: 'ledger', label: 'Flat ledger' },
        ]}
      />
      {tab === 'run' ? <BillRun ro={ro} /> : <Lookup initial={params.get('q') ?? ''} />}
    </div>
  )
}
