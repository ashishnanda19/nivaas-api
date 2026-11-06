import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { api } from '@/lib/api'
import type { DashboardStats } from '@/lib/api'
import { downloadFile } from '@/lib/csv'
import { inrCompact, inr } from '@/lib/format'
import { makePdf } from '@/lib/pdf'
import { Async, Button, Card, ProgressRing, Select, Skeleton, Stat, toast } from '@/components/ui'

const CollectionChart = lazy(() => import('./Charts').then((m) => ({ default: m.CollectionChart })))
const SimpleBars = lazy(() => import('./Charts').then((m) => ({ default: m.SimpleBars })))
const ChartFallback = () => <Skeleton className="h-[240px]" />

/** One of the brief's targets: where it started, where it is now, and where it should get to. */
function TargetRow({ label, from, now, target, value, detail }: { label: string; from: string; now: string; target: string; value: number; detail?: string }) {
  const pct = Math.max(0, Math.min(1, value))
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">
          {from} <span aria-hidden>→</span> <span className="font-medium text-fg">{now}</span> <span aria-hidden>→</span> target {target}
        </span>
      </div>
      <div
        className="h-1.5 rounded-full bg-sunken"
        role="progressbar"
        aria-label={`${label}: ${Math.round(pct * 100)}% of the way from the starting point to the target`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct * 100}%` }} />
      </div>
      {detail && <p className="text-xs text-muted">{detail}</p>}
    </li>
  )
}

function report(s: DashboardStats, label: string) {
  downloadFile(
    `nivaas-monthly-report.pdf`,
    makePdf('Nivaas monthly report', [
      `Scope: ${label}`,
      `Generated: ${new Date().toLocaleDateString('en-IN')}`,
      '',
      '# Collections',
      `Billed: Rs. ${new Intl.NumberFormat('en-IN').format(s.billedTotal)}`,
      `Collected: Rs. ${new Intl.NumberFormat('en-IN').format(s.collectedTotal)} (${s.collectedPct}%)`,
      `Paid on time: ${s.onTimePct}%`,
      '# Dues ageing',
      ...s.ageing.map((a) => `${a.bucket} days: Rs. ${new Intl.NumberFormat('en-IN').format(a.amount)}`),
      '# Complaints',
      `Average response: ${s.avgResponseH} h`,
      `Average resolution: ${s.avgResolutionH} h`,
      `Reopened: ${s.reopenedPct}%`,
    ]),
    'application/pdf',
  )
  toast.success('Report downloaded')
}

export default function Dashboard() {
  const [months, setMonths] = useState(6)
  const [tower, setTower] = useState<'all' | number>('all')
  const q = useQuery({
    queryKey: ['dashboard', months, tower],
    queryFn: () => api.getDashboard({ months, tower }),
  })
  const scope = `${months} months, ${tower === 'all' ? 'all towers' : `Tower ${tower}`}`
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">{scope}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Period" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={3}>Last 3 months</option>
            <option value={6}>Last 6 months</option>
            <option value={12}>Last 12 months</option>
          </Select>
          <Select
            label="Tower"
            value={tower}
            onChange={(e) => setTower(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All towers</option>
            {Array.from({ length: 28 }, (_, i) => (
              <option key={i} value={i + 1}>
                Tower {i + 1}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!q.data} onClick={() => q.data && report(q.data, scope)}>
            <Download className="h-4 w-4" aria-hidden />
            Download monthly report
          </Button>
        </div>
      </div>

      <Async
        query={q}
        skeleton={
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
            <Skeleton className="h-72" />
          </div>
        }
      >
        {(s) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="flex items-center justify-between gap-3 p-5">
                <Stat
                  label="Collected"
                  value={inrCompact(s.collectedTotal)}
                  hint={`of ${inrCompact(s.billedTotal)} billed`}
                />
                <ProgressRing value={s.collectedPct} label="Collected" />
              </Card>
              <Card className="p-5">
                <Stat
                  label="Paid on time"
                  value={`${s.onTimePct}%`}
                  hint="Target 90%"
                  tone={s.onTimePct >= 90 ? 'success' : undefined}
                />
              </Card>
              <Card className="p-5">
                <Stat
                  label="Avg response"
                  value={`${s.avgResponseH} h`}
                  hint={`Resolution ${s.avgResolutionH} h`}
                />
              </Card>
              <Card className="p-5">
                <Stat
                  label="Reopened"
                  value={`${s.reopenedPct}%`}
                  hint="Target under 8%"
                  tone={s.reopenedPct > 8 ? 'danger' : 'success'}
                />
              </Card>
            </div>

            <Card className="p-5">
              <h2 className="mb-1 font-medium">Targets from the brief</h2>
              <p className="mb-4 text-sm text-muted">Where each measure started, where it is now, and the target. The bar shows how far along that line it is.</p>
              <ul className="space-y-5">
                <TargetRow label="Paid on time" from="70%" now={`${s.onTimePct}%`} target="90%" value={(s.onTimePct - 70) / 20} />
                <TargetRow label="Reopened complaints" from="25%" now={`${s.reopenedPct}%`} target="under 8%" value={(25 - s.reopenedPct) / 17} />
                <TargetRow
                  label="Payments matched without hand work"
                  from="0% (every row by hand)"
                  now={s.matching.rows ? `${s.matching.oneClickPct}%` : 'no statement yet'}
                  target="80%"
                  value={s.matching.oneClickPct / 80}
                  detail={
                    s.matching.rows
                      ? `${s.matching.rows} statement rows so far${s.matching.avgMinutesToPost !== null ? `. A posted row waited ${s.matching.avgMinutesToPost} minutes on average` : ''}. This stands in for "matching time down 80%": rows that qualify for one-click posting need no manual matching.`
                      : 'Upload a bank statement as the help desk to measure it. Rows that qualify for one-click posting need no manual matching.'
                  }
                />
              </ul>
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-5 lg:col-span-2">
                <h2 className="mb-3 font-medium">Collection vs billed</h2>
                <Suspense fallback={<ChartFallback />}>
                  <CollectionChart data={s.months} />
                </Suspense>
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 font-medium">Top defaulting towers</h2>
                <ol className="space-y-3">
                  {s.towers.map((t) => (
                    <li key={t.tower} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{t.tower}</span>
                        <span className="tabular-nums text-muted">{inr(t.dues)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-sunken">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${(t.dues / s.towers[0].dues) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 font-medium">Dues ageing (days)</h2>
                <Suspense fallback={<ChartFallback />}>
                  <SimpleBars data={s.ageing} x="bucket" y="amount" money />
                </Suspense>
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 font-medium">Complaint volume by week</h2>
                <Suspense fallback={<ChartFallback />}>
                  <SimpleBars data={s.complaintsByWeek} x="week" y="count" />
                </Suspense>
              </Card>
            </div>
          </>
        )}
      </Async>
    </div>
  )
}
