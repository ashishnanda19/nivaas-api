import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Layers, ShieldAlert, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/lib/api'
import type { Category, Complaint, ComplaintStatus, Urgency } from '@/lib/api'
import { ageLabel, fmtTime } from '@/lib/format'
import {
  Async,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  Select,
  Sheet,
  Skeleton,
  StatusPill,
  Tabs,
  toast,
} from '@/components/ui'
import { Countdown } from '@/components/Countdown'
import { useSession } from '@/app/store'
import { useNow } from '@/lib/hooks'

const CATS: Category[] = [
  'plumbing',
  'electrical',
  'lift',
  'security',
  'housekeeping',
  'safety',
  'parking',
  'noise',
  'other',
]
const COLS: { id: ComplaintStatus; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'resolved', label: 'Resolved' },
]
const NEXT: Record<ComplaintStatus, { to: ComplaintStatus; label: string } | null> = {
  new: { to: 'assigned', label: 'Assign' },
  assigned: { to: 'in_progress', label: 'Start' },
  in_progress: { to: 'resolved', label: 'Resolve' },
  resolved: null,
}
const WEIGHT: Record<Urgency, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

interface Group {
  primary: Complaint
  items: Complaint[]
}

/** Safety complaints pin to the top; duplicates in one status collapse into a stack. Nothing is closed by stacking. */
function groupColumn(list: Complaint[]): Group[] {
  const sorted = [...list].sort(
    (a, b) =>
      Number(b.escalated) - Number(a.escalated) ||
      WEIGHT[a.urgency] - WEIGHT[b.urgency] ||
      +new Date(b.createdAt) - +new Date(a.createdAt),
  )
  const out: Group[] = []
  const byCluster = new Map<string, Group>()
  for (const c of sorted) {
    if (c.clusterId && !c.escalated) {
      const g = byCluster.get(c.clusterId)
      if (g) {
        g.items.push(c)
        continue
      }
      const ng = { primary: c, items: [c] }
      byCluster.set(c.clusterId, ng)
      out.push(ng)
    } else out.push({ primary: c, items: [c] })
  }
  return out
}

function CategoryMenu({
  c,
  disabled,
  onPick,
}: {
  c: Complaint
  disabled?: boolean
  onPick: (v: Category) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="rounded-full focus-visible:ring-offset-0"
      >
        <Badge tone="accent" className={clsx(!disabled && 'cursor-pointer hover:opacity-80')}>
          {t(`complaints.cats.${c.category}`)}
        </Badge>
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 w-40 rounded-ctl border border-line bg-surface py-1 shadow-float"
        >
          {CATS.map((k) => (
            <li key={k} role="none">
              <button
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  if (k !== c.category) onPick(k)
                }}
                className={clsx(
                  'flex min-h-[36px] w-full items-center px-3 text-left text-sm hover:bg-sunken',
                  k === c.category && 'font-medium text-ink',
                )}
              >
                {t(`complaints.cats.${k}`)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Card({
  g,
  ro,
  onOpen,
  onAdvance,
  onCategory,
}: {
  g: Group
  ro: boolean
  onOpen: () => void
  onAdvance: (c: Complaint) => void
  onCategory: (c: Complaint, v: Category) => void
}) {
  const { t } = useTranslation()
  const now = useNow(60000)
  const c = g.primary
  const next = NEXT[c.status]
  return (
    <div className="relative pb-1.5">
      {g.items.length > 1 && (
        <span
          aria-hidden
          className="absolute inset-x-2 bottom-0 h-3 rounded-b-card border border-t-0 border-line bg-sunken"
        />
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className={clsx(
          'relative cursor-pointer space-y-2.5 rounded-card border bg-surface p-3.5 transition hover:border-line-strong',
          c.escalated ? 'border-danger' : 'border-line',
        )}
      >
        {c.escalated && (
          <div className="-mx-3.5 -mt-3.5 flex items-center gap-1.5 rounded-t-card bg-danger-tint px-3.5 py-1.5 text-xs font-semibold text-danger">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
            Escalated to duty manager
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <CategoryMenu c={c} disabled={ro} onPick={(v) => onCategory(c, v)} />
          <StatusPill status={c.urgency} label={t(`complaints.urgency.${c.urgency}`)} />
        </div>
        <p className="line-clamp-2 text-sm">{c.text}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="font-medium text-fg">{c.flatId}</span>
          <span>·</span>
          <span className="tabular-nums">{ageLabel(now - +new Date(c.createdAt))}</span>
          {g.items.length > 1 && (
            <Badge tone="accent">
              <Layers className="h-3 w-3" aria-hidden />
              {g.items.length} linked
            </Badge>
          )}
        </div>
        {c.status !== 'resolved' && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Countdown createdAt={c.createdAt} dueAt={c.dueAt} />
            {!ro && next && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation()
                  onAdvance(c)
                }}
              >
                {next.label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Drawer({
  id,
  all,
  ro,
  onClose,
}: {
  id: string | null
  all: Complaint[]
  ro: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const user = useSession((s) => s.user)!
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [target, setTarget] = useState('')
  const c = all.find((x) => x.id === id)
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api.listStaff() })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['complaints'] })
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Something went wrong'),
  })
  const linked = c?.clusterId ? all.filter((x) => x.clusterId === c.clusterId && x.id !== c.id) : []
  const candidates = c
    ? all
        .filter(
          (x) =>
            x.id !== c.id &&
            x.status !== 'resolved' &&
            x.category === c.category &&
            x.clusterId !== c.clusterId,
        )
        .slice(0, 25)
    : []
  return (
    <Sheet
      open={!!c}
      onClose={onClose}
      title={c ? `${c.id} · ${c.flatId}` : ''}
      closeLabel="Close"
      footer={
        c &&
        !ro &&
        c.status !== 'resolved' && (
          <Button
            block
            loading={run.isPending}
            onClick={() => run.mutate(() => api.setStatus(c.id, 'resolved', user.name))}
          >
            Resolve complaint
          </Button>
        )
      }
    >
      {c && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={c.status} label={t(`complaints.status.${c.status}`)} />
            {c.escalated && (
              <Badge tone="danger">
                <ShieldAlert className="h-3 w-3" aria-hidden />
                Escalated to duty manager
              </Badge>
            )}
            {c.status !== 'resolved' && <Countdown createdAt={c.createdAt} dueAt={c.dueAt} />}
          </div>
          <section>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Original text</p>
            <p className="text-sm">{c.text}</p>
            <p className="mt-1 text-xs text-muted">
              {c.residentName} · {fmtTime(c.createdAt)}
            </p>
            {c.photo && (
              <img
                src={c.photo}
                alt=""
                className="mt-2 h-28 w-28 rounded-card border border-line object-cover"
              />
            )}
          </section>
          <section className="rounded-card bg-accent-tint p-3 text-sm text-ink">
            <p className="flex items-center gap-1.5 font-medium">
              <Sparkles className="h-4 w-4" aria-hidden />
              AI suggests {t(`complaints.cats.${c.aiCategory}`)},{' '}
              {t(`complaints.urgency.${c.aiUrgency}`).toLowerCase()} urgency
            </p>
            <p className="mt-1 text-xs opacity-80">{c.aiReason}</p>
          </section>
          <section>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Category</p>
            <div className="flex flex-wrap gap-1.5">
              {CATS.map((k) => (
                <button
                  key={k}
                  disabled={ro || c.escalated}
                  aria-pressed={c.category === k}
                  onClick={() => run.mutate(() => api.setCategory(c.id, k, user.name))}
                  className={clsx(
                    'min-h-[36px] rounded-full border px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-60',
                    c.category === k
                      ? 'border-accent bg-accent-tint text-ink'
                      : 'border-line hover:bg-sunken',
                  )}
                >
                  {t(`complaints.cats.${k}`)}
                </button>
              ))}
            </div>
            {c.escalated && (
              <p className="mt-2 text-xs text-muted">
                Safety words lock the category and urgency. This escalation cannot be removed.
              </p>
            )}
          </section>
          {!ro && (
            <Select
              label="Assigned to"
              value={c.assignee ?? ''}
              onChange={(e) =>
                e.target.value && run.mutate(() => api.assign(c.id, e.target.value, user.name))
              }
            >
              <option value="" disabled>
                Not assigned
              </option>
              {staff.data?.map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
          <section className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Duplicates</p>
            {linked.length > 0 ? (
              <>
                <p className="text-sm">
                  {linked.length + 1} complaints linked. None of them is closed automatically.
                </p>
                <ul className="divide-y divide-line rounded-card border border-line text-sm">
                  {linked.slice(0, 6).map((x) => (
                    <li key={x.id} className="flex items-center justify-between px-3 py-2">
                      <span>
                        {x.id} · {x.flatId}
                      </span>
                      <StatusPill status={x.status} label={t(`complaints.status.${x.status}`)} />
                    </li>
                  ))}
                  {linked.length > 6 && (
                    <li className="px-3 py-2 text-muted">and {linked.length - 6} more</li>
                  )}
                </ul>
                {!ro && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => run.mutate(() => api.unlink(c.id, user.name))}
                  >
                    Unlink this complaint
                  </Button>
                )}
              </>
            ) : !ro && candidates.length > 0 ? (
              <div className="flex items-end gap-2">
                <Select
                  label="Link to a similar open complaint"
                  wrapperClassName="flex-1"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {candidates.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.id} · {x.flatId} · {x.text.slice(0, 28)}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  disabled={!target}
                  onClick={() =>
                    run.mutate(async () => {
                      await api.link(c.id, target, user.name)
                      setTarget('')
                    })
                  }
                >
                  Link
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">No linked complaints.</p>
            )}
          </section>
          <section className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Updates</p>
            {c.comments.map((m) => (
              <p key={m.id} className="rounded-ctl bg-sunken px-3 py-2 text-sm">
                <span className="block text-xs text-muted">
                  {m.by} · {fmtTime(m.at)}
                </span>
                {m.text}
              </p>
            ))}
            {!ro && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (note.trim())
                    run.mutate(async () => {
                      await api.addComment(c.id, user.name, true, note.trim())
                      setNote('')
                    })
                }}
                className="flex items-end gap-2"
              >
                <Input
                  label="Add update"
                  wrapperClassName="flex-1"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button type="submit" disabled={!note.trim()}>
                  Post
                </Button>
              </form>
            )}
          </section>
        </div>
      )}
    </Sheet>
  )
}

export default function Board() {
  const { t } = useTranslation()
  const user = useSession((s) => s.user)!
  const ro = user.role === 'committee'
  const qc = useQueryClient()
  const [view, setView] = useState<'board' | 'table'>('board')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const q = useQuery({
    queryKey: ['complaints', 'all'],
    queryFn: () => api.listComplaints(),
    refetchInterval: 15000,
  })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['complaints'] })
  const advance = useMutation({
    mutationFn: (c: Complaint) => api.setStatus(c.id, NEXT[c.status]!.to, user.name),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed'),
  })
  const recat = useMutation({
    mutationFn: ({ c, v }: { c: Complaint; v: Category }) => api.setCategory(c.id, v, user.name),
    onSuccess: () => {
      refresh()
      toast.success('Category updated')
    },
  })

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter(
      (c) => !s || `${c.id} ${c.flatId} ${c.text} ${c.residentName}`.toLowerCase().includes(s),
    )
  }, [q.data, search])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('console.board.title', 'Complaint board')}</h1>
          <p className="text-sm text-muted">
            {ro ? 'Read-only view for the committee.' : 'Safety complaints are pinned and escalated by rule.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-56">
            <Input
              label="Search"
              aria-label="Search complaints"
              placeholder="Flat, ID or words"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              wrapperClassName="[&>label]:sr-only"
            />
          </div>
          <Tabs
            label="View"
            value={view}
            onChange={setView}
            tabs={[
              { id: 'board', label: 'Board' },
              { id: 'table', label: 'Table' },
            ]}
          />
        </div>
      </div>
      <Async
        query={q}
        skeleton={
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-72" />
            ))}
          </div>
        }
        isEmpty={(d) => !d.length}
        empty={<EmptyState title="No complaints yet" body="New complaints from residents appear here." />}
      >
        {() =>
          view === 'board' ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {COLS.map((col) => {
                const items = filtered.filter((c) => c.status === col.id)
                const groups = groupColumn(items)
                return (
                  <section
                    key={col.id}
                    aria-label={col.label}
                    className="min-w-0 rounded-card bg-sunken p-2.5"
                  >
                    <h2 className="mb-2 flex items-center justify-between px-1.5 text-sm font-medium">
                      {col.label}
                      <span className="text-xs tabular-nums text-muted">{items.length}</span>
                    </h2>
                    <div className="max-h-[72vh] space-y-2 overflow-y-auto pr-0.5">
                      {groups.length === 0 && (
                        <p className="px-2 py-6 text-center text-sm text-muted">Nothing here</p>
                      )}
                      {groups.slice(0, col.id === 'resolved' ? 12 : 60).map((g) => (
                        <Card
                          key={g.primary.id}
                          g={g}
                          ro={ro}
                          onOpen={() => setOpen(g.primary.id)}
                          onAdvance={(c) => advance.mutate(c)}
                          onCategory={(c, v) => recat.mutate({ c, v })}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <DataTable
              caption="Complaints"
              rowKey={(c) => c.id}
              onRowClick={(c) => setOpen(c.id)}
              rows={[...filtered].sort((a, b) => Number(b.escalated) - Number(a.escalated))}
              columns={[
                {
                  key: 'id',
                  header: 'ID',
                  cell: (c) => <span className="font-medium">{c.id}</span>,
                  sortValue: (c) => c.id,
                },
                { key: 'flat', header: 'Flat', cell: (c) => c.flatId, sortValue: (c) => c.flatId },
                {
                  key: 'cat',
                  header: 'Category',
                  cell: (c) => (
                    <span>
                      {t(`complaints.cats.${c.category}`)}
                      {c.escalated && (
                        <Badge tone="danger" className="ml-2">
                          Escalated
                        </Badge>
                      )}
                    </span>
                  ),
                  sortValue: (c) => c.category,
                },
                {
                  key: 'urg',
                  header: 'Urgency',
                  cell: (c) => <StatusPill status={c.urgency} label={t(`complaints.urgency.${c.urgency}`)} />,
                  sortValue: (c) => WEIGHT[c.urgency],
                },
                {
                  key: 'st',
                  header: 'Status',
                  cell: (c) => <StatusPill status={c.status} label={t(`complaints.status.${c.status}`)} />,
                },
                {
                  key: 'age',
                  header: 'Age',
                  cell: (c) => (
                    <span className="tabular-nums">{ageLabel(Date.now() - +new Date(c.createdAt))}</span>
                  ),
                  sortValue: (c) => -+new Date(c.createdAt),
                },
                {
                  key: 'due',
                  header: 'Response',
                  cell: (c) =>
                    c.status === 'resolved' ? '–' : <Countdown createdAt={c.createdAt} dueAt={c.dueAt} />,
                  hideOnMobile: true,
                },
                { key: 'who', header: 'Assignee', cell: (c) => c.assignee ?? '–', hideOnMobile: true },
              ]}
            />
          )
        }
      </Async>
      <Drawer id={open} all={q.data ?? []} ro={ro} onClose={() => setOpen(null)} />
    </div>
  )
}
