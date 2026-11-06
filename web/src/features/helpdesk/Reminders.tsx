import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing } from 'lucide-react'
import { api } from '@/lib/api'
import type { ReminderKind, ReminderLog } from '@/lib/api'
import { useSession } from '@/app/store'
import { fmtDate, fmtTime } from '@/lib/format'
import { Async, Badge, Button, Card, DataTable, EmptyState, Skeleton, toast } from '@/components/ui'

const KIND: Record<ReminderKind, { label: string; tone: 'accent' | 'warning' | 'danger' }> = {
  BEFORE_DUE: { label: '3 days before due', tone: 'accent' },
  ON_DUE: { label: 'On the due date', tone: 'warning' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
}
const LANG: Record<string, string> = { en: 'English', hi: 'Hindi', mr: 'Marathi' }

export default function Reminders() {
  const qc = useQueryClient()
  const canRun = useSession((s) => s.user!.role === 'helpdesk')
  const q = useQuery({ queryKey: ['reminders'], queryFn: () => api.listReminders(), refetchInterval: 30000 })
  const run = useMutation({
    mutationFn: () => api.runReminders(),
    onSuccess: (r) => {
      toast.success(r.sent ? `${r.sent} reminder${r.sent === 1 ? '' : 's'} sent${r.held ? `, ${r.held} not sent (not allowed)` : ''}` : r.held ? `${r.held} not sent: those numbers are not on the allowed list` : 'Nothing new to send. Everyone due a reminder has had it.')
      void qc.invalidateQueries({ queryKey: ['reminders'] })
      void qc.invalidateQueries({ queryKey: ['audit'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not run reminders'),
  })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payment reminders</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Sent automatically every day to the owner or tenant of a flat with an unpaid bill: 3 days before the due date, on it, and from the fifth day overdue. Each person gets each
            reminder once, in their own language, and never after the bill is paid.
          </p>
        </div>
        {canRun && (
          <Button onClick={() => run.mutate()} loading={run.isPending} variant="secondary">
            <BellRing className="h-4 w-4" aria-hidden /> Run now
          </Button>
        )}
      </div>
      <Async
        query={q}
        skeleton={<Skeleton className="h-72" />}
        isEmpty={(d) => !d.length}
        empty={
          <EmptyState
            title="No reminders sent yet"
            body={canRun ? 'They go out once a day. Press Run now to send today’s.' : 'They go out once a day.'}
          />
        }
      >
        {(rows: ReminderLog[]) => (
          <>
            <Card className="flex flex-wrap gap-x-8 gap-y-2 p-4 text-sm">
              {(Object.keys(KIND) as ReminderKind[]).map((k) => (
                <span key={k}>
                  <span className="text-muted">{KIND[k].label}: </span>
                  <span className="font-medium tabular-nums">{rows.filter((r) => r.kind === k).length}</span>
                </span>
              ))}
              <span>
                <span className="text-muted">Failed: </span>
                <span className="font-medium tabular-nums">{rows.filter((r) => r.status === 'FAILED').length}</span>
              </span>
              <span title="Not on the list of numbers that may receive messages, or a demo account">
                <span className="text-muted">Not sent: </span>
                <span className="font-medium tabular-nums">{rows.filter((r) => r.status === 'SKIPPED').length}</span>
              </span>
            </Card>
            <DataTable
              caption="Reminders sent"
              rowKey={(r) => r.id}
              rows={rows}
              columns={[
                { key: 'at', header: 'When', cell: (r) => <span className="tabular-nums">{fmtDate(r.at, 'en', false)}, {fmtTime(r.at)}</span> },
                { key: 'flat', header: 'Flat', cell: (r) => <span className="font-medium">{r.flatId}</span> },
                { key: 'kind', header: 'Type', cell: (r) => <Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge> },
                { key: 'lang', header: 'Language', cell: (r) => LANG[r.language] ?? r.language },
                { key: 'msg', header: 'Message', cell: (r) => <span className="text-muted">{r.message}</span>, hideOnMobile: false },
                { key: 'st', header: 'Status', cell: (r) => <Badge tone={r.status === 'SENT' ? 'success' : r.status === 'FAILED' ? 'danger' : 'neutral'}>{r.status === 'SENT' ? 'Sent' : r.status === 'FAILED' ? 'Failed' : 'Not sent'}</Badge> },
              ]}
            />
          </>
        )}
      </Async>
    </div>
  )
}
