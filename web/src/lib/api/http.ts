import { USERS } from '@/mocks/seed'
import { ApiError } from './mock'
import type { Api } from './mock'
import type {
  Amenity,
  Bill,
  BillRunPreview,
  Booking,
  Category,
  Classification,
  Complaint,
  ComplaintStatus,
  DashboardStats,
  Flat,
  FlatForMatch,
  LedgerEntry,
  Member,
  MemberRole,
  Notice,
  PreApproval,
  Receipt,
  Staff,
  TimelineStep,
  Urgency,
  User,
  Visitor,
  ReminderLog,
  ReminderRun,
} from './types'
import type { MatchKind, MatchRow } from '../matching'

/**
 * Real backend client. Same shape as the mock, so nothing in features/ changes.
 * The server speaks integer paise, upper-case enums and its own ids; everything is converted here.
 */

const BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:4000'
const V1 = `${BASE}/api/v1`
const TOKEN_KEY = 'nivaas.token'

let token: string | null = (() => {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
})()
const setToken = (t: string | null) => {
  token = t
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t)
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: the token lives in memory only */
  }
}

let onAuthLost: () => void = () => {}
export const setAuthLostHandler = (fn: () => void) => {
  onAuthLost = fn
}

let refreshing: Promise<boolean> | null = null
async function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${V1}/auth/refresh`, { method: 'POST', credentials: 'include' })
      if (!r.ok) return false
      setToken(((await r.json()) as { accessToken: string }).accessToken)
      return true
    } catch {
      return false
    } finally {
      setTimeout(() => (refreshing = null), 0)
    }
  })()
  return refreshing
}

interface Opts {
  method?: string
  body?: unknown
  form?: FormData
  headers?: Record<string, string>
  noAuthRetry?: boolean
}
async function call<T>(path: string, o: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { ...o.headers }
  if (token) headers.authorization = `Bearer ${token}`
  if (o.body !== undefined) headers['content-type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`${V1}${path}`, {
      method: o.method ?? 'GET',
      headers,
      credentials: 'include',
      body: o.form ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
    })
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.')
  }
  if (res.status === 401 && !o.noAuthRetry && !path.startsWith('/auth/')) {
    if (await refresh()) return call<T>(path, { ...o, noAuthRetry: true })
    setToken(null)
    onAuthLost()
  }
  if (!res.ok) {
    let msg = 'Something went wrong on our side.'
    try {
      const j = (await res.json()) as { error?: { message?: string } }
      if (j.error?.message) msg = j.error.message
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const rupees = (paise: number) => paise / 100
const paise = (r: number) => Math.round(r * 100)
const abs = (url: string | null | undefined) =>
  url ? (url.startsWith('http') ? url : `${BASE}${url}`) : undefined

// ---- mapping -------------------------------------------------------------------------------------

interface SUser {
  id: string
  name: string
  phone: string
  role: 'RESIDENT' | 'HELPDESK' | 'COMMITTEE' | 'GUARD' | 'ADMIN'
  title: string | null
  language: string
  consent: boolean
  flatId: string | null
  memberRole: string | null
}
const mapUser = (u: SUser): User & { consent: boolean; language: string } => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  role: u.role === 'ADMIN' ? 'helpdesk' : (u.role.toLowerCase() as User['role']),
  flatId: u.flatId ?? undefined,
  memberRole: (u.memberRole?.toLowerCase() as MemberRole | undefined) ?? undefined,
  title: u.title ?? undefined,
  consent: u.consent,
  language: u.language,
})

interface SBill {
  flatId: string
  monthLabel: string
  areaSqft: number
  ratePaise: number
  billedPaise: number
  paidPaise: number
  outstandingPaise: number
  lateFeePaise: number
  totalPaise: number
  dueDate: string
  daysOverdue: number
  status: Bill['status']
}
const mapBill = (b: SBill): Bill => ({
  flatId: b.flatId,
  monthLabel: b.monthLabel,
  area: b.areaSqft,
  rate: rupees(b.ratePaise),
  billed: rupees(b.billedPaise),
  paid: rupees(b.paidPaise),
  outstanding: rupees(b.outstandingPaise),
  lateFee: rupees(b.lateFeePaise),
  total: rupees(b.totalPaise),
  dueDate: b.dueDate,
  daysOverdue: b.daysOverdue,
  status: b.status,
})

// Server categories are finer than the UI's. Water supply folds into plumbing, garden into housekeeping.
const CAT_IN: Record<string, Category> = {
  PLUMBING: 'plumbing',
  ELECTRICAL: 'electrical',
  LIFT: 'lift',
  SECURITY: 'security',
  HOUSEKEEPING: 'housekeeping',
  PARKING: 'parking',
  NOISE: 'noise',
  WATER_SUPPLY: 'plumbing',
  GARDEN: 'housekeeping',
  OTHER: 'other',
}
const CAT_OUT: Record<Category, string | undefined> = {
  plumbing: 'PLUMBING',
  electrical: 'ELECTRICAL',
  lift: 'LIFT',
  security: 'SECURITY',
  housekeeping: 'HOUSEKEEPING',
  parking: 'PARKING',
  noise: 'NOISE',
  other: 'OTHER',
  safety: undefined,
}
const URG_IN: Record<string, Urgency> = { LOW: 'low', NORMAL: 'normal', HIGH: 'high', CRITICAL: 'urgent' }
const STATUS_IN: Record<string, ComplaintStatus> = {
  NEW: 'new',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  REOPENED: 'in_progress',
}
const STEP_IN: Record<string, TimelineStep> = {
  raised: 'raised',
  assigned: 'assigned',
  in_progress: 'in_progress',
  resolved: 'resolved',
  reopened: 'in_progress',
}

interface SComplaint {
  id: string
  flatId: string
  residentName: string
  text: string
  category: string
  urgency: string
  status: string
  createdAt: string
  dueAt: string
  assignee: { id: string; name: string } | null
  photoUrl: string | null
  clusterId: string | null
  linkedCount: number
  escalated: boolean
  ai: { category: string; urgency: string; reason: string }
  rating: number | null
  reopened: number
  resolvedAt: string | null
  comments: { id: string; by: string; staff: boolean; text: string; at: string }[]
  timeline: { step: string; at: string }[]
  linked?: { id: string; flatId: string }[]
}
const mapComplaint = (c: SComplaint): Complaint => ({
  id: c.id,
  flatId: c.flatId,
  residentName: c.residentName,
  text: c.text,
  category: c.escalated ? 'safety' : (CAT_IN[c.category] ?? 'other'),
  urgency: URG_IN[c.urgency] ?? 'normal',
  status: STATUS_IN[c.status] ?? 'new',
  createdAt: c.createdAt,
  dueAt: c.dueAt,
  assignee: c.assignee?.name,
  comments: c.comments,
  photo: abs(c.photoUrl),
  // The UI groups a stack by one shared id: the parent and its duplicates carry the same value.
  clusterId: c.clusterId ? `CL-${c.clusterId}` : c.linkedCount > 0 ? `CL-${c.id}` : undefined,
  escalated: c.escalated,
  aiCategory: CAT_IN[c.ai.category] ?? 'other',
  aiUrgency: URG_IN[c.ai.urgency] ?? 'normal',
  aiReason: c.ai.reason,
  rating: c.rating ?? undefined,
  reopened: c.reopened,
  resolvedAt: c.resolvedAt ?? undefined,
  timeline: c.timeline.map((t) => ({ step: STEP_IN[t.step] ?? 'raised', at: t.at })),
})

const GATE_NAMES = ['Gate 1 (Main)', 'Gate 2 (East)', 'Gate 3 (Service)', 'Gate 4 (North)']
const gateId = (name: string) => `g${Math.max(GATE_NAMES.indexOf(name), 0) + 1}`
const gateName = (id: string) => GATE_NAMES[Number(id.slice(1)) - 1] ?? id

interface SVisitor {
  id: string
  gateId: string
  flatId: string
  name: string
  phone: string
  purpose: string
  photoUrl: string | null
  createdAt: string
  status: string
  source: 'guard' | 'code'
  decidedAt: string | null
}
const mapVisitor = (v: SVisitor): Visitor => ({
  id: v.id,
  gateId: gateName(v.gateId),
  flatId: v.flatId,
  name: v.name,
  phone: v.phone,
  purpose: v.purpose,
  photo: abs(v.photoUrl),
  createdAt: v.createdAt,
  status: v.status === 'WAITING' ? 'waiting' : v.status === 'DENIED' ? 'denied' : 'approved',
  source: v.source,
  decidedAt: v.decidedAt ?? undefined,
})

const dash = (slot: string) => slot.replace('-', '–')
interface SBooking {
  id: string
  amenityId: string
  amenityName: string
  flatId: string
  date: string
  slot: string
  feePaise: number
  status: string
}
const mapBooking = (b: SBooking): Booking => ({
  id: b.id,
  amenityId: b.amenityId,
  amenityName: b.amenityName,
  flatId: b.flatId,
  date: b.date,
  slot: dash(b.slot),
  fee: rupees(b.feePaise),
  status: b.status === 'CANCELLED' ? 'cancelled' : 'confirmed',
})

interface Page<T> {
  items: T[]
  total: number
  pages?: number
}
/** Fetch every page up to a cap. The UI lists are small enough that this is fine. */
async function all<T>(path: string, cap = 500): Promise<T[]> {
  const out: T[] = []
  const sep = path.includes('?') ? '&' : '?'
  for (let page = 1; out.length < cap; page++) {
    const r = await call<Page<T>>(`${path}${sep}page=${page}&pageSize=100`)
    out.push(...r.items)
    if (out.length >= r.total || r.items.length === 0) break
  }
  return out
}

let staffCache: { id: string; name: string; skills: string[] }[] | null = null
const staff = async () =>
  (staffCache ??= (await call<{ items: { id: string; name: string; skills: string[] }[] }>('/staff')).items)
const memberFlat = new Map<string, string>()
const CODES_KEY = 'nivaas.codes'
const savedCodes = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(CODES_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
const rememberCode = (id: string, code: string) => {
  try {
    localStorage.setItem(CODES_KEY, JSON.stringify({ ...savedCodes(), [id]: code }))
  } catch {
    /* the code was shown once; losing the cache only hides it later */
  }
}
const nextPeriod = () => {
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() + 1, 1)
  return d.toISOString().slice(0, 7)
}
const periodByLabel = new Map<string, string>()

const AUDIT_LABEL: Record<string, string> = {
  'auth.login': 'Signed in',
  'consent.record': 'Accepted privacy notice',
  'billing.run.publish': 'Published bill run',
  'ledger.reverse': 'Reversed ledger entry',
  'payment.confirm': 'Payment confirmed',
  'statement.upload': 'Uploaded bank statement',
  'statement.post': 'Posted bank payment',
  'statement.post_all_exact': 'Posted exact matches',
  'statement.reject': 'Rejected statement row',
  'complaint.escalate': 'Escalated to duty manager',
  'complaint.assign': 'Assigned complaint',
  'complaint.category_change': 'Changed category',
  'complaint.status': 'Changed status',
  'complaint.reopen': 'Reopened complaint',
  'complaint.link': 'Linked duplicate',
  'complaint.unlink': 'Unlinked duplicate',
  'complaint.escalation_removal_blocked': 'Blocked removal of safety escalation',
  'visitor.decision': 'Visitor decision',
  'visitor.gate_status': 'Visitor gate status',
  'visitor.preapproval_used': 'Pre-approved guest admitted',
  'booking.cancel': 'Cancelled booking',
  'notice.create': 'Posted notice',
  'notice.delete': 'Removed notice',
  'member.add': 'Added member',
  'member.remove': 'Removed member',
  'pii.view': 'Viewed personal details',
  'report.export': 'Exported report',
  'retention.visitor_photos_deleted': 'Deleted expired visitor photos',
}

const toMatchRow = (
  r: {
    id: string
    date: string
    amountPaise: number
    reference: string
    upiId: string | null
    narration: string
    suggestedFlatId: string | null
    confidence: 'EXACT' | 'LIKELY' | 'UNCLEAR'
    label: string | null
    reasons: string[]
  },
  names: Map<string, string>,
): MatchRow => {
  const kind: MatchKind = (
    ['partial', 'duplicate', 'two_month', 'overpay', 'already_paid'] as string[]
  ).includes(r.label ?? '')
    ? (r.label as MatchKind)
    : 'normal'
  const has = (re: RegExp) => r.reasons.some((x) => re.test(x))
  return {
    id: r.id,
    date: r.date,
    amount: rupees(r.amountPaise),
    reference: r.reference,
    upi: r.upiId ?? '',
    narration: r.narration,
    flatId: r.suggestedFlatId ?? undefined,
    flatName: r.suggestedFlatId ? names.get(r.suggestedFlatId) : undefined,
    confidence: r.confidence.toLowerCase() as MatchRow['confidence'],
    kind,
    signals: [
      { label: 'Amount equals the bill', hit: has(/Amount equals/) },
      { label: 'Reference contains the flat number', hit: has(/Reference mentions|short code/) },
      { label: 'UPI ID seen before for this flat', hit: has(/UPI ID .* confirmed/) },
    ],
    reasons: r.reasons,
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export const httpApi: Api = {
  // ---- auth
  async requestOtp(phone: string) {
    await call('/auth/otp/request', { method: 'POST', body: { phone } })
  },
  async verifyOtp(phone: string, otp: string) {
    const r = await call<{ accessToken: string; user: SUser }>('/auth/otp/verify', {
      method: 'POST',
      body: { phone, code: otp },
    })
    setToken(r.accessToken)
    return mapUser(r.user)
  },
  async recordConsent() {
    await call('/auth/consent', { method: 'POST', body: { accepted: true } })
  },
  async setLanguage(language: string) {
    if (token) await call('/auth/language', { method: 'PATCH', body: { language } })
  },
  async logout() {
    try {
      await call('/auth/logout', { method: 'POST' })
    } finally {
      setToken(null)
      staffCache = null
    }
  },
  demoUsers: () => USERS,

  // ---- bills
  async getBill(flatId) {
    return mapBill(await call<SBill>(`/billing/bill?flatId=${flatId}`))
  },
  async getLedger(flatId): Promise<LedgerEntry[]> {
    const rows = await all<{
      id: string
      flatId: string
      date: string
      type: string
      description: string
      debitPaise: number
      creditPaise: number
      balancePaise: number
    }>(`/billing/ledger?flatId=${flatId}`)
    return rows.map((e) => ({
      id: e.id,
      flatId: e.flatId,
      date: e.date,
      kind: e.type === 'BILL' ? 'bill' : e.type === 'LATE_FEE' ? 'late_fee' : 'payment',
      desc: e.description,
      debit: rupees(e.debitPaise),
      credit: rupees(e.creditPaise),
      balance: rupees(e.balancePaise),
    }))
  },
  async getPayments(flatId): Promise<Receipt[]> {
    const rows = await all<{
      id: string
      flatId: string
      amountPaise: number
      mode: string
      reference: string
      paidAt: string | null
    }>(`/payments?flatId=${flatId}`)
    const members = await call<{ items: { name: string; relation: string }[] }>(
      `/flats/${flatId}/members`,
    ).catch(() => ({ items: [] }))
    const who = members.items.find((m) => m.relation !== 'FAMILY')?.name ?? ''
    return rows.map((p) => ({
      id: p.id,
      flatId: p.flatId,
      date: p.paidAt ?? '',
      amount: rupees(p.amountPaise),
      method: p.mode,
      reference: p.reference,
      residentName: who,
    }))
  },
  async payBill(flatId, method): Promise<Receipt> {
    const bill = await call<SBill>(`/billing/bill?flatId=${flatId}`)
    if (bill.totalPaise <= 0) throw new ApiError('Nothing is due on this flat.')
    const intent = await call<{ paymentId: string }>('/payments/intents', {
      method: 'POST',
      body: { flatId, amountPaise: bill.totalPaise, mode: method.toUpperCase() },
      headers: { 'idempotency-key': crypto.randomUUID() },
    })
    const done = await call<{
      id: string
      amountPaise: number
      mode: string
      reference: string
      paidAt: string | null
      status: string
    }>(`/gateway/pay/${intent.paymentId}`, {
      method: 'POST',
      body: { outcome: 'success' },
    })
    const members = await call<{ items: { name: string; relation: string }[] }>(
      `/flats/${flatId}/members`,
    ).catch(() => ({ items: [] }))
    return {
      id: done.id,
      flatId,
      date: done.paidAt ?? new Date().toISOString(),
      amount: rupees(done.amountPaise),
      method: done.mode,
      reference: done.reference,
      residentName: members.items.find((m) => m.relation !== 'FAMILY')?.name ?? '',
    }
  },

  // ---- complaints
  async suggest(text): Promise<Classification> {
    const r = await call<{ category: string; urgency: string; reason: string; escalated: boolean }>(
      '/complaints/classify',
      { method: 'POST', body: { text } },
    )
    return {
      category: r.escalated ? 'safety' : (CAT_IN[r.category] ?? 'other'),
      urgency: URG_IN[r.urgency] ?? 'normal',
      reason: r.reason,
      escalated: r.escalated,
    }
  },
  async listComplaints(opts = {}) {
    const q = new URLSearchParams({ includeLinked: 'true' })
    if (opts.flatId) q.set('flatId', opts.flatId)
    return (await all<SComplaint>(`/complaints?${q}`)).map(mapComplaint)
  },
  async getComplaint(id) {
    const c = await call<SComplaint>(`/complaints/${id}`)
    let clusterFlats = 0
    if (c.linked?.length) clusterFlats = new Set([c.flatId, ...c.linked.map((l) => l.flatId)]).size
    else if (c.clusterId) {
      const p = await call<SComplaint>(`/complaints/${c.clusterId}`).catch(() => null)
      if (p?.linked) clusterFlats = new Set([p.flatId, ...p.linked.map((l) => l.flatId)]).size
    }
    return { ...mapComplaint(c), clusterFlats }
  },
  async createComplaint(input) {
    const cat = input.category ? CAT_OUT[input.category] : undefined
    let r: SComplaint
    if (input.photo) {
      const form = new FormData()
      form.set('flatId', input.flatId)
      form.set('text', input.text)
      if (cat) form.set('category', cat)
      form.set('photo', dataUrlToBlob(input.photo), 'photo.jpg')
      r = await call<SComplaint>('/complaints', { method: 'POST', form })
    } else {
      r = await call<SComplaint>('/complaints', {
        method: 'POST',
        body: { flatId: input.flatId, text: input.text, ...(cat ? { category: cat } : {}) },
      })
    }
    return mapComplaint(r)
  },
  async setStatus(id, status) {
    if (status === 'in_progress' || status === 'resolved')
      await call(`/complaints/${id}/status`, {
        method: 'POST',
        body: { status: status === 'resolved' ? 'RESOLVED' : 'IN_PROGRESS' },
      })
  },
  async assign(id, assigneeName) {
    const s = (await staff()).find((x) => x.name === assigneeName)
    if (!s) throw new ApiError('Choose someone from the staff list.')
    await call(`/complaints/${id}/assign`, { method: 'POST', body: { assigneeId: s.id } })
  },
  async setCategory(id, category) {
    const c = CAT_OUT[category]
    if (!c) return // "safety" is a flag, not a category: the server keeps the escalation
    await call(`/complaints/${id}`, { method: 'PATCH', body: { category: c } })
  },
  async addComment(id, _by, _staff, text) {
    await call(`/complaints/${id}/comments`, { method: 'POST', body: { text } })
  },
  async rate(id, rating) {
    await call(`/complaints/${id}/rating`, { method: 'POST', body: { rating } })
  },
  async reopen(id) {
    await call(`/complaints/${id}/reopen`, { method: 'POST' })
  },
  async link(id, targetId) {
    await call(`/complaints/${id}/link`, {
      method: 'POST',
      body: { parentCode: targetId.replace(/^CL-/, '') },
    })
  },
  async unlink(id) {
    await call(`/complaints/${id}/link`, { method: 'DELETE' })
  },
  async listStaff(): Promise<Staff[]> {
    return (await staff()).map((s) => ({
      id: s.id,
      name: s.name,
      skills: s.skills.map((k) => CAT_IN[k] ?? 'other'),
    }))
  },

  // ---- visitors
  async listVisitors(opts = {}) {
    const q = new URLSearchParams()
    if (opts.flatId) q.set('flatId', opts.flatId)
    if (opts.today) q.set('from', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
    return (await all<SVisitor>(`/visitors?${q}`)).map(mapVisitor)
  },
  async getVisitor(id) {
    return mapVisitor(await call<SVisitor>(`/visitors/${id}`))
  },
  async createVisitor(input) {
    const entry = {
      clientId: input.id,
      gateId: gateId(input.gateId),
      flatId: input.flatId,
      name: input.name,
      phone: input.phone,
      purpose: input.purpose,
      ...(input.photo?.startsWith('data:') ? { photo: input.photo } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    }
    if (input.id && input.createdAt) {
      // Entries written on the tablet while offline go through the batch endpoint, which is built for replays.
      const r = await call<{ results: { id?: string; result: string; error?: string }[] }>('/visitors/sync', {
        method: 'POST',
        body: { entries: [entry] },
      })
      const first = r.results[0]
      if (first.result === 'error' || !first.id)
        throw new ApiError(first.error ?? 'Could not save the entry.')
      return mapVisitor(await call<SVisitor>(`/visitors/${first.id}`))
    }
    return mapVisitor(await call<SVisitor>('/visitors', { method: 'POST', body: entry }))
  },
  async decideVisitor(id, decision) {
    await call(`/visitors/${id}/decision`, { method: 'POST', body: { decision: decision.toUpperCase() } })
  },
  async preApprove(input): Promise<PreApproval> {
    const r = await call<{
      id: string
      flatId: string
      guestName: string
      date: string
      code: string
      used: boolean
    }>('/pre-approvals', {
      method: 'POST',
      body: { flatId: input.flatId, guestName: input.name, date: input.date },
    })
    rememberCode(r.id, r.code)
    return { id: r.id, flatId: r.flatId, name: r.guestName, date: r.date, code: r.code, used: r.used }
  },
  async listPreApprovals(flatId): Promise<PreApproval[]> {
    const r = await call<{
      items: { id: string; flatId: string; guestName: string; date: string; used: boolean }[]
    }>(`/pre-approvals?flatId=${flatId}`)
    const codes = savedCodes() // the server keeps only a hash, so this device remembers the codes it created
    return r.items.map((p) => ({
      id: p.id,
      flatId: p.flatId,
      name: p.guestName,
      date: p.date,
      code: codes[p.id] ?? '',
      used: p.used,
    }))
  },
  async verifyCode(code, gate) {
    return mapVisitor(
      await call<SVisitor>('/pre-approvals/verify', { method: 'POST', body: { code, gateId: gateId(gate) } }),
    )
  },
  gates: () => GATE_NAMES,

  // ---- amenities
  async listAmenities(): Promise<Amenity[]> {
    const r = await call<{
      items: {
        id: string
        name: string
        feePaise: number
        feeNote: string
        rules: string[]
        slots: string[]
      }[]
    }>('/amenities')
    return r.items.map((a) => ({
      id: a.id,
      name: a.name,
      fee: rupees(a.feePaise),
      feeNote: a.feeNote,
      rules: a.rules,
      slots: a.slots.map(dash),
    }))
  },
  async listBookings(opts = {}) {
    if (opts.amenityId) {
      // Residents may not read other flats' bookings, so taken slots come from the availability endpoint instead.
      const out: Booking[] = []
      const a = (await httpApi.listAmenities()).find((x) => x.id === opts.amenityId)
      for (let i = 0; i < 8; i++) {
        const day = new Date(Date.now() + i * 86400000 + 5.5 * 3600e3).toISOString().slice(0, 10)
        const av = await call<{
          slots: { start: string; end: string; available: boolean; reason: string | null }[]
        }>(`/amenities/${opts.amenityId}/availability?date=${day}`)
        for (const s of av.slots)
          if (s.reason === 'booked')
            out.push({
              id: `${opts.amenityId}-${day}-${s.start}`,
              amenityId: opts.amenityId,
              amenityName: a?.name ?? '',
              flatId: '',
              date: day,
              slot: `${s.start}–${s.end}`,
              fee: 0,
              status: 'confirmed',
            })
      }
      return out
    }
    const q = opts.flatId ? `?flatId=${opts.flatId}` : ''
    return (await all<SBooking>(`/amenity-bookings${q}`)).map(mapBooking)
  },
  async book(input) {
    const start = input.slot.split(/[–-]/)[0].trim()
    return mapBooking(
      await call<SBooking>('/amenity-bookings', {
        method: 'POST',
        body: { amenityId: input.amenityId, flatId: input.flatId, date: input.date, start },
      }),
    )
  },
  async cancelBooking(id) {
    await call(`/amenity-bookings/${id}`, { method: 'DELETE' })
  },

  // ---- family and notices
  async listMembers(flatId): Promise<Member[]> {
    const r = await call<{
      items: { id: string; flatId: string; name: string; phone: string; relation: string }[]
    }>(`/flats/${flatId}/members`)
    return r.items.map((m) => {
      memberFlat.set(m.id, m.flatId)
      return {
        id: m.id,
        flatId: m.flatId,
        name: m.name,
        phone: m.phone,
        role: m.relation.toLowerCase() as MemberRole,
      }
    })
  },
  async inviteMember(input) {
    await call(`/flats/${input.flatId}/members`, {
      method: 'POST',
      body: { name: input.name, phone: input.phone, relation: input.role.toUpperCase() },
    })
  },
  async removeMember(id) {
    const flatId = memberFlat.get(id)
    if (!flatId) throw new ApiError('Reload the list and try again.')
    await call(`/flats/${flatId}/members/${id}`, { method: 'DELETE' })
  },
  async listNotices(): Promise<Notice[]> {
    return (await all<Notice>('/notices', 50)).map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      at: n.at,
    }))
  },

  // ---- help desk
  async searchFlats(q = ''): Promise<(Flat & { outstanding: number })[]> {
    const rows = await all<{
      id: string
      towerNo: number
      areaSqft: number
      residentName: string
      tenant: boolean
      balancePaise: number
      daysOverdue: number
      upiIds: string[]
    }>(`/flats?search=${encodeURIComponent(q.trim())}`, 300)
    return rows.map((f) => {
      const outstanding = Math.max(rupees(f.balancePaise), 0)
      return {
        id: f.id,
        tower: f.towerNo,
        area: f.areaSqft,
        residentName: f.residentName,
        tenant: f.tenant,
        billed: outstanding,
        paid: 0,
        credit: Math.max(-rupees(f.balancePaise), 0),
        daysOverdue: f.daysOverdue,
        upiIds: f.upiIds,
        outstanding,
      }
    })
  },
  async listGateFlats() {
    return (await all<{ id: string; residentName: string }>('/gate/flats', 5000)).map((f) => ({
      id: f.id,
      residentName: f.residentName,
    }))
  },
  async flatsForMatching(): Promise<FlatForMatch[]> {
    return (await httpApi.searchFlats('')).map((f) => ({
      id: f.id,
      billed: f.billed,
      outstanding: f.outstanding,
      lateFee: 0,
      upiIds: f.upiIds,
      name: f.residentName,
    }))
  },
  async postedRefs() {
    return [] // the server checks for duplicates itself
  },
  async matchStatement(text: string) {
    const form = new FormData()
    form.set('file', new Blob([text], { type: 'text/csv' }), 'statement.csv')
    const [up, flats] = await Promise.all([
      call<{ rows: Parameters<typeof toMatchRow>[0][]; parseErrors: { lineNo: number; message: string }[] }>(
        '/matching/uploads',
        { method: 'POST', form },
      ),
      httpApi.flatsForMatching(),
    ])
    const names = new Map(flats.map((f) => [f.id, f.name]))
    return {
      rows: up.rows.map((r) => toMatchRow(r, names)),
      errors: up.parseErrors.map((e) => `Line ${e.lineNo}: ${e.message}`),
    }
  },
  async postStatement(postings) {
    let total = 0
    let posted = 0
    for (const p of postings) {
      if (!p.rowId) throw new ApiError('This row has not been uploaded yet.')
      await call(`/matching/rows/${p.rowId}/post`, {
        method: 'POST',
        body: { flatId: p.flatId, ...(p.allowDuplicate ? { allowDuplicate: true } : {}) },
      })
      total += p.amount
      posted++
    }
    return { posted, total }
  },
  async previewBillRun(): Promise<BillRunPreview> {
    const period = nextPeriod()
    const r = await call<{
      period: string
      ratePaisePerSqft: number
      flats: number
      totalPaise: number
      rows: { flatId: string; name: string; areaSqft: number; amountPaise: number }[]
    }>(`/billing/runs/preview?period=${period}`)
    const label = new Date(`${period}-01T00:00:00Z`).toLocaleString('en-IN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    periodByLabel.set(label, period)
    return {
      month: label,
      rate: rupees(r.ratePaisePerSqft),
      flats: r.flats,
      total: rupees(r.totalPaise),
      rows: r.rows.map((x) => ({
        flatId: x.flatId,
        name: x.name,
        area: x.areaSqft,
        amount: rupees(x.amountPaise),
      })),
    }
  },
  async publishBillRun(month) {
    const period = periodByLabel.get(month) ?? nextPeriod()
    await call('/billing/runs', { method: 'POST', body: { period } })
  },
  async publishedRuns() {
    return (await call<{ items: { label: string }[] }>('/billing/runs')).items.map((r) => r.label)
  },
  async listReminders(): Promise<ReminderLog[]> {
    const r = await call<{ items: (Omit<ReminderLog, 'at'> & { sentAt: string })[] }>('/reminders?pageSize=100')
    return r.items.map(({ sentAt, ...x }) => ({ ...x, at: sentAt }))
  },
  async runReminders(): Promise<ReminderRun> {
    return call<ReminderRun>('/reminders/run', { method: 'POST' })
  },
  async listAudit() {
    const r = await call<{
      items: {
        id: string
        createdAt: string
        actorName: string
        action: string
        entity: string
        entityId: string
        detail: string
      }[]
    }>('/audit?pageSize=100')
    return r.items.map((a) => ({
      id: a.id,
      at: a.createdAt,
      actor: a.actorName,
      action: AUDIT_LABEL[a.action] ?? a.action,
      target: a.entityId,
      detail: a.detail,
    }))
  },

  // ---- committee
  async getDashboard(opts): Promise<DashboardStats> {
    const d = await call<{
      months: { label: string; billedPaise: number; collectedPaise: number }[]
      billedTotalPaise: number
      collectedTotalPaise: number
      collectedPct: number
      onTime: { pct: number }
      ageing: { bucket: string; amountPaise: number }[]
      topDefaultingTowers: { tower: string; duesPaise: number; flats: number }[]
      complaints: {
        volumeByWeek: { weekStart: string; count: number }[]
        avgResponseHours: number
        avgResolutionHours: number
        reopenedPct: number
      }
      matching: { rows: number; oneClickPct: number; avgMinutesToPost: number | null }
    }>(`/committee/dashboard?months=${opts.months}${opts.tower === 'all' ? '' : `&tower=${opts.tower}`}`)
    return {
      months: d.months.map((m) => ({
        label: m.label,
        billed: rupees(m.billedPaise),
        collected: rupees(m.collectedPaise),
      })),
      billedTotal: rupees(d.billedTotalPaise),
      collectedTotal: rupees(d.collectedTotalPaise),
      collectedPct: Math.round(d.collectedPct),
      onTimePct: Math.round(d.onTime.pct),
      ageing: d.ageing.map((a) => ({ bucket: a.bucket.replace('-', '–'), amount: rupees(a.amountPaise) })),
      towers: d.topDefaultingTowers.map((t) => ({
        tower: t.tower,
        dues: rupees(t.duesPaise),
        flats: t.flats,
      })),
      complaintsByWeek: d.complaints.volumeByWeek.map((w, i) => ({ week: `W${i + 1}`, count: w.count })),
      avgResponseH: d.complaints.avgResponseHours,
      avgResolutionH: d.complaints.avgResolutionHours,
      reopenedPct: Math.round(d.complaints.reopenedPct),
      matching: d.matching,
    }
  },
}

export { paise }
