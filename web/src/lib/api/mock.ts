import { calcLateFee, LATE_FEE_RATE_PA, lateFeeNote } from '../format'
import { parseCsv } from '../csv'
import { matchRows, rowsFromCsv } from '../matching'
import { classifyText, SLA_HOURS } from '../classify'
import {
  buildSeed,
  AMENITIES,
  DAY,
  dueDateOf,
  GATES,
  HOUR,
  NOTICES,
  RATE,
  staffFor,
  STAFF,
  USERS,
} from '@/mocks/seed'
import type { Db } from '@/mocks/seed'
import { getSettings } from './settings'
import type { MatchRow } from '../matching'
import type {
  Bill,
  BillRunPreview,
  Booking,
  Category,
  Complaint,
  ComplaintStatus,
  DashboardStats,
  Flat,
  FlatForMatch,
  LedgerEntry,
  Member,
  MemberRole,
  PayMethod,
  PreApproval,
  Receipt,
  StatementPosting,
  TimelineStep,
  Visitor,
  Notice,
} from './types'

const KEY = 'nivaas.db.v1'
const IS_TEST = import.meta.env.MODE === 'test'

export class ApiError extends Error {}

function load(): Db {
  const today = new Date().toISOString().slice(0, 10)
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as Db
      if (db.seedDay === today) {
        const cutoff = Date.now() - 90 * DAY // DPDP: visitor photos are deleted after 90 days
        db.visitors.forEach((v) => {
          if (v.photo && +new Date(v.createdAt) < cutoff) delete v.photo
        })
        return db
      }
    }
  } catch {
    /* fall through to a fresh seed */
  }
  const db = buildSeed()
  save(db)
  return db
}
function save(db: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* storage full or unavailable: changes live for this call only */
  }
}
export function resetDemoData() {
  localStorage.removeItem(KEY)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function latency(read = false) {
  if (IS_TEST) return
  await wait(120 + Math.random() * 300)
  if (read && getSettings().flaky && Math.random() < 0.04)
    throw new ApiError('Something went wrong on our side.')
}
let seq = Date.now() % 100000
const uid = (p: string) => `${p}-${(seq++).toString(36)}`
const iso = (ms = Date.now()) => new Date(ms).toISOString()
const must = <T>(v: T | undefined, msg: string): T => {
  if (v === undefined) throw new ApiError(msg)
  return v
}
const audit = (db: Db, actor: string, action: string, target: string, detail: string) =>
  db.audit.unshift({ id: uid('au'), at: iso(), actor, action, target, detail })

function billOf(db: Db, f: Flat): Bill {
  const now = new Date()
  const due = dueDateOf(f, now)
  const billDate = new Date(due.getTime() - 10 * DAY)
  const outstanding = Math.max(f.billed - f.paid, 0)
  const lateFee = calcLateFee(outstanding, f.daysOverdue)
  void db
  return {
    flatId: f.id,
    monthLabel: billDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
    area: f.area,
    rate: RATE,
    billed: f.billed,
    paid: f.paid,
    outstanding,
    lateFee,
    total: outstanding + lateFee,
    dueDate: due.toISOString(),
    daysOverdue: f.daysOverdue,
    status: outstanding === 0 ? 'paid' : f.daysOverdue > 0 ? 'overdue' : f.paid > 0 ? 'partial' : 'due',
  }
}

function autoRespond(db: Db) {
  if (!getSettings().autoRespond) return
  let changed = false
  for (const v of db.visitors) {
    if (
      v.status === 'waiting' &&
      v.source === 'guard' &&
      Date.now() - +new Date(v.createdAt) > 12000 &&
      Date.now() - +new Date(v.createdAt) < 3600000
    ) {
      v.status = v.id.charCodeAt(v.id.length - 1) % 4 === 0 ? 'denied' : 'approved'
      v.decidedAt = iso()
      changed = true
    }
  }
  if (changed) save(db)
}

function openClusterTarget(db: Db, c: Complaint): Complaint | undefined {
  if (c.escalated || (c.category !== 'lift' && c.category !== 'electrical')) return undefined
  const tower = c.flatId.slice(0, 3)
  return db.complaints.find(
    (o) =>
      o.id !== c.id &&
      o.status !== 'resolved' &&
      o.category === c.category &&
      o.flatId.startsWith(tower) &&
      Date.now() - +new Date(o.createdAt) < 12 * HOUR,
  )
}

const step = (c: Complaint, s: TimelineStep) => c.timeline.push({ step: s, at: iso() })

export const mockApi = {
  // auth
  async requestOtp(phone: string) {
    void phone
  },
  async recordConsent() {},
  async setLanguage(language: string) {
    void language
  },
  async logout() {},
  async verifyOtp(phone: string, otp: string) {
    await latency()
    if (otp !== '123456') throw new ApiError('That code is not right. Try 123456.')
    return must(
      USERS.find((u) => u.phone === phone),
      'This number is not registered. Use a demo login.',
    )
  },
  demoUsers: () => USERS,

  // bills
  async getBill(flatId: string): Promise<Bill> {
    await latency(true)
    const db = load()
    return billOf(
      db,
      must(
        db.flats.find((f) => f.id === flatId),
        'Flat not found',
      ),
    )
  },
  async getLedger(flatId: string): Promise<LedgerEntry[]> {
    await latency(true)
    const db = load()
    const flat = must(
      db.flats.find((f) => f.id === flatId),
      'Flat not found',
    )
    const rows = db.ledger
      .filter((l) => l.flatId === flatId)
      .sort((a, b) => +new Date(a.date) - +new Date(b.date))
    const bill = billOf(db, flat)
    const all: Omit<LedgerEntry, 'balance'>[] = [...rows]
    if (bill.lateFee > 0)
      all.push({
        id: 'L-virtual-fee',
        flatId,
        date: iso(),
        kind: 'late_fee',
        desc: `Late fee (${lateFeeNote(bill.daysOverdue, LATE_FEE_RATE_PA)})`,
        debit: bill.lateFee,
        credit: 0,
      })
    let bal = 0
    return all.map((e) => ({ ...e, balance: (bal += e.debit - e.credit) })).reverse()
  },
  async getPayments(flatId: string) {
    await latency(true)
    const db = load()
    return db.receipts
      .filter((r) => r.flatId === flatId)
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .concat(
        db.ledger
          .filter((l) => l.flatId === flatId && l.kind === 'payment')
          .sort((a, b) => +new Date(b.date) - +new Date(a.date))
          .filter((l) => !l.id.startsWith('L-rcpt'))
          .map((l): Receipt => ({
            id: `R-${l.id}`,
            flatId,
            date: l.date,
            amount: l.credit,
            method: 'UPI',
            reference: l.id,
            residentName: '',
          })),
      )
  },
  async payBill(flatId: string, method: PayMethod): Promise<Receipt> {
    await latency()
    const db = load()
    const flat = must(
      db.flats.find((f) => f.id === flatId),
      'Flat not found',
    )
    const bill = billOf(db, flat)
    if (bill.total <= 0) throw new ApiError('Nothing is due on this flat.')
    const rid = uid('R')
    if (bill.lateFee > 0)
      db.ledger.push({
        id: uid('L-fee'),
        flatId,
        date: iso(),
        kind: 'late_fee',
        desc: `Late fee (${lateFeeNote(bill.daysOverdue)})`,
        debit: bill.lateFee,
        credit: 0,
      })
    db.ledger.push({
      id: `L-rcpt-${rid}`,
      flatId,
      date: iso(),
      kind: 'payment',
      desc: `Payment received (${method.toUpperCase()}, test mode)`,
      debit: 0,
      credit: bill.total,
    })
    flat.paid = flat.billed
    flat.daysOverdue = 0
    const receipt: Receipt = {
      id: rid,
      flatId,
      date: iso(),
      amount: bill.total,
      method: method.toUpperCase(),
      reference: `TEST${Math.floor(Math.random() * 1e9)}`,
      residentName: flat.residentName,
    }
    db.receipts.push(receipt)
    audit(db, flat.residentName, 'Paid maintenance', flatId, `${bill.total} via ${method} (test)`)
    save(db)
    return receipt
  },

  // complaints
  async suggest(text: string) {
    await latency()
    return classifyText(text)
  },
  async listComplaints(opts: { flatId?: string } = {}): Promise<Complaint[]> {
    await latency(true)
    const db = load()
    return db.complaints.filter((c) => !opts.flatId || c.flatId === opts.flatId)
  },
  async getComplaint(id: string): Promise<Complaint & { clusterFlats: number }> {
    await latency(true)
    const db = load()
    const c = must(
      db.complaints.find((x) => x.id === id),
      'Complaint not found',
    )
    const clusterFlats = c.clusterId
      ? new Set(db.complaints.filter((x) => x.clusterId === c.clusterId).map((x) => x.flatId)).size
      : 0
    return { ...c, clusterFlats }
  },
  async createComplaint(input: {
    flatId: string
    text: string
    category?: Category
    photo?: string
  }): Promise<Complaint> {
    await latency()
    const db = load()
    const flat = must(
      db.flats.find((f) => f.id === input.flatId),
      'Flat not found',
    )
    const cls = classifyText(input.text)
    const category = cls.escalated ? 'safety' : (input.category ?? cls.category)
    const urgency = cls.escalated ? 'urgent' : cls.urgency
    const c: Complaint = {
      id: `C-${Math.max(1000, ...db.complaints.map((x) => Number(x.id.slice(2)) || 0)) + 1}`,
      flatId: flat.id,
      residentName: flat.residentName,
      text: input.text,
      category,
      urgency,
      status: category === 'other' ? 'new' : 'assigned',
      createdAt: iso(),
      dueAt: iso(Date.now() + SLA_HOURS[urgency] * HOUR),
      assignee: category === 'other' ? undefined : staffFor(category),
      comments: [],
      photo: input.photo,
      escalated: cls.escalated,
      aiCategory: cls.category,
      aiUrgency: cls.urgency,
      aiReason: cls.reason,
      reopened: 0,
      timeline: [],
    }
    step(c, 'raised')
    if (c.status === 'assigned') step(c, 'assigned')
    const target = openClusterTarget(db, c)
    if (target) {
      target.clusterId ??= `CL-${target.id}`
      c.clusterId = target.clusterId
    }
    db.complaints.unshift(c)
    audit(
      db,
      flat.residentName,
      'Raised complaint',
      c.id,
      `${category}, ${urgency}${c.escalated ? ', escalated to duty manager' : ''}`,
    )
    save(db)
    return c
  },
  async setStatus(id: string, status: ComplaintStatus, actor: string) {
    await latency()
    const db = load()
    const c = must(
      db.complaints.find((x) => x.id === id),
      'Complaint not found',
    )
    c.status = status
    if (status === 'assigned') c.assignee ??= staffFor(c.category)
    if (status !== 'new')
      step(c, status === 'assigned' ? 'assigned' : status === 'in_progress' ? 'in_progress' : 'resolved')
    if (status === 'resolved') c.resolvedAt = iso()
    audit(db, actor, 'Changed status', id, `Now ${status.replace('_', ' ')}`)
    save(db)
  },
  async assign(id: string, assignee: string, actor: string) {
    await latency()
    const db = load()
    const c = must(
      db.complaints.find((x) => x.id === id),
      'Complaint not found',
    )
    c.assignee = assignee
    if (c.status === 'new') {
      c.status = 'assigned'
      step(c, 'assigned')
    }
    audit(db, actor, 'Assigned complaint', id, `Assigned to ${assignee}`)
    save(db)
  },
  async setCategory(id: string, category: Category, actor: string) {
    await latency()
    const db = load()
    const c = must(
      db.complaints.find((x) => x.id === id),
      'Complaint not found',
    )
    c.category = c.escalated ? 'safety' : category // escalation cannot be undone by re-categorising
    audit(db, actor, 'Changed category', id, `${c.aiCategory} to ${c.category}`)
    save(db)
  },
  async addComment(id: string, by: string, staff: boolean, text: string) {
    await latency()
    const db = load()
    const c = must(
      db.complaints.find((x) => x.id === id),
      'Complaint not found',
    )
    c.comments.push({ id: uid('cm'), by, staff, text, at: iso() })
    save(db)
  },
  async rate(id: string, rating: number) {
    await latency()
    const db = load()
    must(
      db.complaints.find((x) => x.id === id),
      'Complaint not found',
    ).rating = rating
    save(db)
  },
  async reopen(id: string, by: string) {
    await latency()
    const db = load()
    const c = must(
      db.complaints.find((x) => x.id === id),
      'Complaint not found',
    )
    c.status = 'in_progress'
    c.reopened += 1
    c.rating = undefined
    c.resolvedAt = undefined
    c.dueAt = iso(Date.now() + 8 * HOUR)
    step(c, 'in_progress')
    audit(db, by, 'Reopened complaint', id, 'Resident said it is not fixed')
    save(db)
  },
  async link(id: string, targetId: string, actor: string) {
    await latency()
    const db = load()
    const c = must(
      db.complaints.find((x) => x.id === id),
      'Complaint not found',
    )
    const t = must(
      db.complaints.find((x) => x.id === targetId),
      'Target complaint not found',
    )
    t.clusterId ??= `CL-${t.id}`
    c.clusterId = t.clusterId
    audit(db, actor, 'Linked duplicate', id, `Linked with ${targetId}. Nothing was closed.`)
    save(db)
  },
  async unlink(id: string, actor: string) {
    await latency()
    const db = load()
    const c = must(
      db.complaints.find((x) => x.id === id),
      'Complaint not found',
    )
    delete c.clusterId
    audit(db, actor, 'Unlinked duplicate', id, '')
    save(db)
  },
  async listStaff() {
    return STAFF
  },

  // visitors
  async listVisitors(opts: { flatId?: string; today?: boolean } = {}): Promise<Visitor[]> {
    await latency(true)
    const db = load()
    autoRespond(db)
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return db.visitors.filter(
      (v) => (!opts.flatId || v.flatId === opts.flatId) && (!opts.today || +new Date(v.createdAt) >= +start),
    )
  },
  async getVisitor(id: string): Promise<Visitor> {
    if (!IS_TEST) await wait(80)
    const db = load()
    autoRespond(db)
    return must(
      db.visitors.find((v) => v.id === id),
      'Visitor not found',
    )
  },
  async createVisitor(
    input: Pick<Visitor, 'gateId' | 'flatId' | 'name' | 'phone' | 'purpose' | 'photo'> & {
      id?: string
      createdAt?: string
    },
  ): Promise<Visitor> {
    await latency()
    const db = load()
    if (input.id) {
      const existing = db.visitors.find((v) => v.id === input.id)
      if (existing) return existing // idempotent when an offline entry syncs twice
    }
    must(
      db.flats.find((f) => f.id === input.flatId),
      `Flat ${input.flatId} not found`,
    )
    const v: Visitor = {
      ...input,
      id: input.id ?? uid('V'),
      createdAt: input.createdAt ?? iso(),
      status: 'waiting',
      source: 'guard',
    }
    db.visitors.unshift(v)
    save(db)
    return v
  },
  async decideVisitor(id: string, decision: 'approved' | 'denied') {
    await latency()
    const db = load()
    const v = must(
      db.visitors.find((x) => x.id === id),
      'Visitor not found',
    )
    v.status = decision
    v.decidedAt = iso()
    save(db)
  },
  async preApprove(input: { flatId: string; name: string; date: string }): Promise<PreApproval> {
    await latency()
    const db = load()
    let code = ''
    do code = String(100000 + Math.floor(Math.random() * 900000))
    while (db.preApprovals.some((p) => p.code === code))
    const p: PreApproval = { id: uid('PA'), ...input, code, used: false }
    db.preApprovals.unshift(p)
    save(db)
    return p
  },
  async listPreApprovals(flatId: string) {
    await latency(true)
    return load().preApprovals.filter((p) => p.flatId === flatId)
  },
  async verifyCode(code: string, gateId: string): Promise<Visitor> {
    await latency()
    const db = load()
    const p = db.preApprovals.find((x) => x.code === code)
    if (!p) throw new ApiError('This code is not valid.')
    if (p.used) throw new ApiError('This code has already been used.')
    if (p.date !== new Date().toISOString().slice(0, 10)) throw new ApiError(`This code is for ${p.date}.`)
    p.used = true
    const v: Visitor = {
      id: uid('V'),
      gateId,
      flatId: p.flatId,
      name: p.name,
      phone: '',
      purpose: 'Pre-approved guest',
      createdAt: iso(),
      status: 'approved',
      source: 'code',
      decidedAt: iso(),
    }
    db.visitors.unshift(v)
    save(db)
    return v
  },
  gates: () => GATES,

  // amenities
  async listAmenities() {
    await latency(true)
    return AMENITIES
  },
  async listBookings(opts: { flatId?: string; amenityId?: string } = {}): Promise<Booking[]> {
    await latency(true)
    return load().bookings.filter(
      (b) =>
        b.status === 'confirmed' &&
        (!opts.flatId || b.flatId === opts.flatId) &&
        (!opts.amenityId || b.amenityId === opts.amenityId),
    )
  },
  async book(input: { amenityId: string; flatId: string; date: string; slot: string }): Promise<Booking> {
    await latency()
    const db = load()
    const a = must(
      AMENITIES.find((x) => x.id === input.amenityId),
      'Amenity not found',
    )
    if (
      db.bookings.some(
        (b) =>
          b.status === 'confirmed' && b.amenityId === a.id && b.date === input.date && b.slot === input.slot,
      )
    )
      throw new ApiError('Someone just booked this slot. Pick another.')
    const b: Booking = { id: uid('B'), ...input, amenityName: a.name, fee: a.fee, status: 'confirmed' }
    db.bookings.push(b)
    audit(db, input.flatId, 'Booked amenity', a.name, `${input.date} ${input.slot}`)
    save(db)
    return b
  },
  async cancelBooking(id: string) {
    await latency()
    const db = load()
    must(
      db.bookings.find((b) => b.id === id),
      'Booking not found',
    ).status = 'cancelled'
    save(db)
  },

  // family and notices
  async listMembers(flatId: string): Promise<Member[]> {
    await latency(true)
    return load().members.filter((m) => m.flatId === flatId)
  },
  async inviteMember(input: { flatId: string; name: string; phone: string; role: MemberRole }) {
    await latency()
    if (!/^[6-9]\d{9}$/.test(input.phone)) throw new ApiError('Enter a valid 10 digit mobile number.')
    const db = load()
    db.members.push({ id: uid('m'), ...input })
    save(db)
  },
  async removeMember(id: string) {
    await latency()
    const db = load()
    db.members = db.members.filter((m) => m.id !== id)
    save(db)
  },
  async listNotices(): Promise<Notice[]> {
    await latency(true)
    return NOTICES.map((n, i) => ({ ...n, at: iso(Date.now() - (i * 2 + 1) * DAY) }))
  },

  // help desk
  async searchFlats(q = ''): Promise<(Flat & { outstanding: number })[]> {
    await latency(true)
    const s = q.trim().toLowerCase()
    return load()
      .flats.filter((f) => !s || f.id.toLowerCase().includes(s) || f.residentName.toLowerCase().includes(s))
      .map((f) => ({ ...f, outstanding: Math.max(f.billed - f.paid, 0) }))
  },
  /** What the gate tablet needs to pick a flat: ids and names, nothing about money. */
  async listGateFlats(): Promise<{ id: string; residentName: string }[]> {
    await latency(true)
    return load().flats.map((f) => ({ id: f.id, residentName: f.residentName }))
  },
  async flatsForMatching(): Promise<FlatForMatch[]> {
    await latency(true)
    return load().flats.map((f) => {
      const outstanding = Math.max(f.billed - f.paid, 0)
      return {
        id: f.id,
        billed: f.billed,
        outstanding,
        lateFee: calcLateFee(outstanding, f.daysOverdue),
        upiIds: f.upiIds,
        name: f.residentName,
      }
    })
  },
  async postedRefs(): Promise<string[]> {
    return load().postedRefs
  },
  /** The demo matches in the browser. A real backend does this on the server and returns the same rows. */
  async matchStatement(text: string): Promise<{ rows: MatchRow[]; errors: string[] }> {
    const parsed = rowsFromCsv(parseCsv(text))
    const [fl, refs] = await Promise.all([mockApi.flatsForMatching(), mockApi.postedRefs()])
    return { rows: matchRows(parsed, fl, new Set(refs)), errors: [] }
  },
  async postStatement(postings: StatementPosting[], actor: string) {
    await latency()
    const db = load()
    let total = 0
    for (const p of postings) {
      const flat = must(
        db.flats.find((f) => f.id === p.flatId),
        `Flat ${p.flatId} not found`,
      )
      const outstanding = Math.max(flat.billed - flat.paid, 0)
      const fee = calcLateFee(outstanding, flat.daysOverdue)
      if (fee > 0 && p.amount >= outstanding + fee)
        db.ledger.push({
          id: uid('L-fee'),
          flatId: flat.id,
          date: iso(),
          kind: 'late_fee',
          desc: `Late fee (${lateFeeNote(flat.daysOverdue)})`,
          debit: fee,
          credit: 0,
        })
      db.ledger.push({
        id: uid('L-bank'),
        flatId: flat.id,
        date: new Date(p.date || Date.now()).toISOString(),
        kind: 'payment',
        desc: `Bank payment ${p.reference || ''}`.trim(),
        debit: 0,
        credit: p.amount,
      })
      const applied = Math.min(p.amount, outstanding)
      flat.paid += applied
      flat.credit += p.amount - applied
      if (flat.billed - flat.paid <= 0) flat.daysOverdue = 0
      if (p.reference) db.postedRefs.push(p.reference.toUpperCase().replace(/[^A-Z0-9]/g, ''))
      total += p.amount
    }
    audit(db, actor, 'Posted payments', 'Bank statement', `${postings.length} payments, total ${total}`)
    save(db)
    return { posted: postings.length, total }
  },
  async previewBillRun(): Promise<BillRunPreview> {
    await latency(true)
    const db = load()
    const next = new Date()
    next.setMonth(next.getMonth() + 1)
    const rows = db.flats.map((f) => ({
      flatId: f.id,
      name: f.residentName,
      area: f.area,
      amount: Math.round(f.area * RATE),
    }))
    const avg = rows.reduce((s, r) => s + r.amount, 0) / rows.length
    return {
      month: next.toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
      rate: RATE,
      flats: 2400,
      total: Math.round(avg * 2400),
      rows,
    }
  },
  async publishBillRun(month: string, actor: string) {
    await latency()
    const db = load()
    if (db.billRuns.includes(month)) throw new ApiError(`Bills for ${month} are already published.`)
    db.billRuns.push(month)
    audit(db, actor, 'Published bill run', month, `2,400 flats at ₹${RATE} per sq ft`)
    save(db)
  },
  async publishedRuns() {
    return load().billRuns
  },
  async listAudit() {
    await latency(true)
    return load().audit
  },

  // committee
  async getDashboard(opts: { months: number; tower: number | 'all' }): Promise<DashboardStats> {
    await latency(true)
    const share = opts.tower === 'all' ? 1 : (0.85 + ((Number(opts.tower) * 37) % 30) / 100) / 28
    const now = new Date()
    const months = Array.from({ length: opts.months }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (opts.months - 1 - i), 1)
      const billed = Math.round(18_000_000 * share)
      const pct = Math.min(0.94, 0.74 + i * (0.16 / Math.max(opts.months - 1, 1)) + ((i * 7) % 5) / 200)
      return {
        label: d.toLocaleString('en-IN', { month: 'short' }),
        billed,
        collected: Math.round(billed * pct),
      }
    })
    const billedTotal = months.reduce((s, m) => s + m.billed, 0)
    const collectedTotal = months.reduce((s, m) => s + m.collected, 0)
    const dues = billedTotal - collectedTotal
    const towers = Array.from({ length: 28 }, (_, i) => ({
      tower: `T${String(i + 1).padStart(2, '0')}`,
      dues: Math.round((((i * 53) % 29) + 8) * 11_000),
      flats: 86,
    }))
      .sort((a, b) => b.dues - a.dues)
      .slice(0, 5)
    return {
      months,
      billedTotal,
      collectedTotal,
      collectedPct: Math.round((collectedTotal / billedTotal) * 100),
      onTimePct: Math.round(70 + (opts.months <= 3 ? 11 : 6)),
      ageing: [
        { bucket: '0–30', amount: Math.round(dues * 0.46) },
        { bucket: '31–60', amount: Math.round(dues * 0.27) },
        { bucket: '61–90', amount: Math.round(dues * 0.15) },
        { bucket: '90+', amount: Math.round(dues * 0.12) },
      ],
      towers,
      complaintsByWeek: Array.from({ length: Math.min(opts.months * 4, 12) }, (_, i) => ({
        week: `W${i + 1}`,
        count: Math.round((380 + ((i * 41) % 90)) * (opts.tower === 'all' ? 1 : share * 4)),
      })),
      avgResponseH: 2.6,
      avgResolutionH: 19.5,
      reopenedPct: 11,
    }
  },
}
export type Api = typeof mockApi
