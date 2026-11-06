import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Download, FileUp, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/lib/api'
import type { FlatForMatch } from '@/lib/api'
import { downloadFile } from '@/lib/csv'
import { inr } from '@/lib/format'
import { KIND_LABEL, type MatchRow } from '@/lib/matching'
import { buildSampleCsv } from '@/mocks/statement'
import { Amount, Badge, Button, EmptyState, Modal, Select, Skeleton, Tabs, toast } from '@/components/ui'
import { useSession } from '@/app/store'

const TONE = { exact: 'success', likely: 'warning', unclear: 'danger' } as const
const CONF_LABEL = { exact: 'Exact', likely: 'Likely', unclear: 'Unclear' }

function Why({ row }: { row: MatchRow }) {
  return (
    <div className="space-y-2 rounded-ctl bg-sunken p-3 text-sm">
      <p className="font-medium">Why this match</p>
      <ul className="space-y-1">
        {row.signals.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            {s.hit ? (
              <Check className="h-4 w-4 text-success" aria-label="Yes" />
            ) : (
              <X className="h-4 w-4 text-muted" aria-label="No" />
            )}
            <span className={s.hit ? '' : 'text-muted'}>{s.label}</span>
          </li>
        ))}
      </ul>
      {row.reasons && row.reasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted">
          {row.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {row.kind !== 'normal' && (
        <p className="text-muted">
          {KIND_LABEL[row.kind]}: this is never posted without a person confirming it.
        </p>
      )}
      {row.confidence === 'unclear' && (
        <p className="text-muted">No flat could be found. Pick one in the Accounts queue.</p>
      )}
    </div>
  )
}

function RowLine({
  row,
  selected,
  onToggle,
  posted,
  trailing,
}: {
  row: MatchRow
  selected?: boolean
  onToggle?: () => void
  posted: boolean
  trailing?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={clsx('border-b border-line px-4 py-3 last:border-0', posted && 'opacity-50')}>
      <div className="grid items-center gap-x-4 gap-y-1 md:grid-cols-[24px_108px_96px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto]">
        {onToggle ? (
          <input
            type="checkbox"
            aria-label={`Select ${row.reference || row.id}`}
            checked={!!selected}
            disabled={posted}
            onChange={onToggle}
            className="h-4 w-4 accent-indigo-600"
          />
        ) : (
          <span className="hidden md:block" />
        )}
        <span className="text-sm tabular-nums text-muted">{row.date}</span>
        <Amount value={row.amount} className="text-sm font-medium" />
        <span className="truncate text-sm" title={row.reference}>
          {row.reference || '–'}
        </span>
        <span className="truncate text-sm text-muted" title={row.upi}>
          {row.upi || '–'}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.flatId ? (
            <span className="text-sm font-medium">
              {row.flatId}
              <span className="font-normal text-muted"> · {row.flatName}</span>
            </span>
          ) : (
            <span className="text-sm text-muted">No flat found</span>
          )}
          <Badge tone={TONE[row.confidence]}>{CONF_LABEL[row.confidence]}</Badge>
          {row.kind !== 'normal' && <Badge tone="neutral">{KIND_LABEL[row.kind]}</Badge>}
          {posted && <Badge tone="success">Posted</Badge>}
        </div>
        <div className="flex items-center justify-end gap-2">
          {trailing}
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex min-h-[36px] items-center gap-1 whitespace-nowrap text-xs font-medium text-ink"
          >
            Why this match
            <ChevronDown className={clsx('h-3.5 w-3.5 transition', open && 'rotate-180')} aria-hidden />
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-2">
          <Why row={row} />
        </div>
      )}
    </div>
  )
}

const Header = ({ select }: { select?: boolean }) => (
  <div className="hidden grid-cols-[24px_108px_96px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] gap-x-4 border-b border-line bg-sunken px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted md:grid">
    <span>{select ? '' : ''}</span>
    <span>Date</span>
    <span>Amount</span>
    <span>Reference</span>
    <span>UPI ID</span>
    <span>Matched flat</span>
    <span className="w-32" />
  </div>
)

export default function Matching() {
  const user = useSession((s) => s.user)!
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [rows, setRows] = useState<MatchRow[] | null>(null)
  const [tab, setTab] = useState<'all' | 'queue'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [posted, setPosted] = useState<Set<string>>(new Set())
  const [manual, setManual] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<{ ids: string[]; flats: Record<string, string> } | null>(null)
  const [error, setError] = useState('')
  const flats = useQuery({ queryKey: ['match-flats'], queryFn: () => api.flatsForMatching(), staleTime: 0 })

  const exact = useMemo(
    () => rows?.filter((r) => r.confidence === 'exact' && !posted.has(r.id)) ?? [],
    [rows, posted],
  )
  const queue = useMemo(() => rows?.filter((r) => r.confidence !== 'exact') ?? [], [rows])
  const flatById = useMemo(
    () => new Map((flats.data ?? []).map((f) => [f.id, f] as [string, FlatForMatch])),
    [flats.data],
  )

  const load = async (text: string) => {
    setError('')
    try {
      const res = await api.matchStatement(text)
      if (!res.rows.length)
        return setError(
          res.errors[0] ??
            'No payment rows found. Expected columns: Date, Amount, Reference, UPI ID, Narration.',
        )
      if (res.errors.length)
        toast.info(
          `${res.errors.length} row${res.errors.length === 1 ? '' : 's'} could not be read and were skipped.`,
        )
      void flats.refetch()
      setRows(res.rows)
      setPosted(new Set())
      setManual({})
      setSelected(new Set(res.rows.filter((r) => r.confidence === 'exact').map((r) => r.id)))
      setTab('all')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the statement.')
    }
  }
  const readFile = async (f?: File) => {
    if (!f) return
    if (!/\.csv$/i.test(f.name) && f.type !== 'text/csv') return setError('Please upload a .csv file.')
    await load(await f.text())
  }
  const sample = async () => {
    const fl = (await flats.refetch()).data ?? []
    return buildSampleCsv(fl)
  }

  const post = useMutation({
    mutationFn: async ({ ids, flats: pick }: { ids: string[]; flats: Record<string, string> }) => {
      const list = ids.map((id) => rows!.find((r) => r.id === id)!)
      return api.postStatement(
        list.map((r) => ({
          rowId: r.id,
          allowDuplicate: r.kind === 'duplicate',
          flatId: pick[r.id] ?? r.flatId!,
          amount: r.amount,
          reference: r.reference,
          date: r.date,
          upi: r.upi,
        })),
        user.name,
      )
    },
    onSuccess: (res, v) => {
      setPosted((p) => new Set([...p, ...v.ids]))
      setSelected((s) => new Set([...s].filter((id) => !v.ids.includes(id))))
      setConfirm(null)
      toast.success(`Posted ${res.posted} payment${res.posted === 1 ? '' : 's'}, ${inr(res.total)}`)
      void qc.invalidateQueries({ queryKey: ['match-flats'] })
      void qc.invalidateQueries({ queryKey: ['bill'] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not post'),
  })

  const selectedExact = exact.filter((r) => selected.has(r.id))
  const confirmRows = confirm ? confirm.ids.map((id) => rows!.find((r) => r.id === id)!) : []

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Payment matching</h1>
        <p className="text-sm text-muted">
          Upload a bank statement. Exact matches can be posted in one click; everything else waits for a
          person.
        </p>
      </div>

      <div
        onDragOver={(e: DragEvent) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault()
          setDrag(false)
          void readFile(e.dataTransfer.files[0])
        }}
        className={clsx(
          'flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-8 text-center transition',
          drag ? 'border-accent bg-accent-tint' : 'border-line-strong',
        )}
      >
        <FileUp className="h-6 w-6 text-muted" aria-hidden />
        <p className="text-sm">
          <span className="font-medium">Drag and drop a bank statement CSV</span> or choose a file
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            void readFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => fileRef.current?.click()}>Choose file</Button>
          <Button variant="secondary" onClick={async () => void load(await sample())}>
            Try with sample
          </Button>
          <Button
            variant="ghost"
            onClick={async () => downloadFile('sample-bank-statement.csv', await sample(), 'text/csv')}
          >
            <Download className="h-4 w-4" aria-hidden />
            Download sample CSV
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {flats.isPending && !rows && <Skeleton className="h-24" />}
      {flats.isError && !rows && (
        <p role="alert" className="text-sm text-danger">
          Could not load flats.{' '}
          <button className="underline" onClick={() => void flats.refetch()}>
            Try again
          </button>
        </p>
      )}

      {rows && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              label="Statement view"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'all', label: `Statement (${rows.length})` },
                {
                  id: 'queue',
                  label: 'Accounts queue',
                  badge: queue.filter((r) => !posted.has(r.id)).length,
                },
              ]}
            />
            {tab === 'all' && (
              <Button
                disabled={!selectedExact.length}
                onClick={() => setConfirm({ ids: selectedExact.map((r) => r.id), flats: {} })}
              >
                Post all exact
                {selectedExact.length
                  ? ` (${selectedExact.length}, ${inr(selectedExact.reduce((s, r) => s + r.amount, 0))})`
                  : ''}
              </Button>
            )}
          </div>

          {tab === 'all' ? (
            <div className="overflow-hidden rounded-card border border-line">
              <Header select />
              {rows.map((r) => (
                <RowLine
                  key={r.id}
                  row={r}
                  posted={posted.has(r.id)}
                  selected={selected.has(r.id)}
                  onToggle={
                    r.confidence === 'exact'
                      ? () =>
                          setSelected((s) => {
                            const n = new Set(s)
                            if (n.has(r.id)) n.delete(r.id)
                            else n.add(r.id)
                            return n
                          })
                      : undefined
                  }
                />
              ))}
            </div>
          ) : queue.length === 0 ? (
            <EmptyState title="Queue is empty" body="Every row in this statement was an exact match." />
          ) : (
            <div className="overflow-hidden rounded-card border border-line">
              <Header />
              {queue.map((r) => {
                const done = posted.has(r.id)
                const pick = manual[r.id] ?? r.flatId ?? ''
                return (
                  <RowLine
                    key={r.id}
                    row={r}
                    posted={done}
                    trailing={
                      !done && (
                        <div className="flex items-center gap-2">
                          <Select
                            label="Flat"
                            aria-label={`Flat for ${r.reference || r.id}`}
                            wrapperClassName="w-44 [&>label]:sr-only"
                            value={pick}
                            onChange={(e) => setManual((m) => ({ ...m, [r.id]: e.target.value }))}
                          >
                            <option value="">Pick flat…</option>
                            {(flats.data ?? []).map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.id} · {f.name}
                                {f.outstanding ? ` · ${inr(f.outstanding)} due` : ''}
                              </option>
                            ))}
                          </Select>
                          <Button
                            size="sm"
                            disabled={!pick}
                            onClick={() => setConfirm({ ids: [r.id], flats: { [r.id]: pick } })}
                          >
                            Post
                          </Button>
                        </div>
                      )
                    }
                  />
                )
              })}
            </div>
          )}
        </>
      )}

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Confirm posting"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button loading={post.isPending} onClick={() => confirm && post.mutate(confirm)}>
              Confirm and post
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            You are about to post <b>{confirmRows.length}</b> payment{confirmRows.length === 1 ? '' : 's'}{' '}
            totalling <b className="tabular-nums">{inr(confirmRows.reduce((s, r) => s + r.amount, 0))}</b> to
            flat ledgers. This is recorded in the audit log.
          </p>
          <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-ctl border border-line">
            {confirmRows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">
                  {confirm?.flats[r.id] ?? r.flatId}
                  <span className="text-muted">
                    {' '}
                    · {flatById.get(confirm?.flats[r.id] ?? r.flatId ?? '')?.name}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{inr(r.amount)}</span>
              </li>
            ))}
          </ul>
          {confirmRows.some((r) => r.kind === 'duplicate') && (
            <p className="rounded-ctl bg-warning-tint px-3 py-2 text-warning">
              One of these looks like a duplicate of a payment already seen. Post it only if you are sure.
            </p>
          )}
          {confirmRows.some((r) => r.kind === 'partial') && (
            <p className="text-muted">Partial payments leave the rest of the bill open.</p>
          )}
        </div>
      </Modal>
    </div>
  )
}
