/**
 * Demo data. Everything here is fictional.
 *
 *   npm run seed            seeds an empty database, does nothing if it is already seeded
 *   npm run seed -- --reset wipes every table first and seeds again (due dates are relative to today)
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import type { Category, ComplaintStatus, PayMode, Urgency, VisitorStatus } from '@prisma/client'
import { prisma } from '../src/lib/db.js'
import { config } from '../src/lib/config.js'
import { calcMaintenance } from '../src/lib/money.js'
import { appendLedger, refreshBillStatuses } from '../src/modules/billing/ledger.js'
import { periodLabel, runLateFees } from '../src/modules/billing/service.js'
import { classifyByRules, detectSafety } from '../src/modules/ai/rules.js'
import { DEFAULT_SLA } from '../src/modules/complaints/service.js'
import { hashCode } from '../src/modules/visitors/service.js'
import { storage } from '../src/lib/storage.js'

const DAY = 86400000
const HOUR = 3600000
const now = new Date()
const at = (daysAgo: number, hour = 11) => {
  const d = new Date(now.getTime() - daysAgo * DAY)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}
const periodOf = (d: Date) => d.toISOString().slice(0, 7)

// small deterministic PRNG so every reseed gives the same shape
let s = 20261106
const rnd = () => {
  s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

const FIRST = ['Anita', 'Rohit', 'Kavita', 'Suresh', 'Meena', 'Vikas', 'Pooja', 'Sanjay', 'Divya', 'Arjun', 'Nisha', 'Rahul', 'Sneha', 'Amit', 'Ritu', 'Manoj', 'Lata', 'Deepak', 'Farah', 'Tarun', 'Isha', 'Gaurav', 'Seema', 'Kunal']
const LAST = ['Patil', 'Menon', 'Iyer', 'Rao', 'Desai', 'Kapoor', 'Naik', 'Bhat', 'Chavan', 'Pillai', 'Gupta', 'Sawant', 'Shetty', 'Mehta', 'Jadhav', 'Khan', 'Thakur', 'Pawar', 'Nambiar', 'Gokhale']

interface FlatDef {
  id: string
  area: number
  name?: string
  rel?: 'OWNER' | 'TENANT'
  phone?: string
  /** Overdue days of the latest bill. Negative means it is not due yet. */
  overdue: number
  paidPaise?: number
  chronic?: boolean
  upi?: string
}

const named: FlatDef[] = [
  { id: 'T07-1203', area: 1150, name: 'Neeraj Kulkarni', phone: '9800000001', overdue: 3, paidPaise: 747500, upi: 'neeraj.k@okaxis' },
  { id: 'T12-0408', area: 980, name: 'Swati Joshi', rel: 'TENANT', phone: '9800000002', overdue: 47, upi: 'swati.j@ybl' },
  { id: 'T21-1601', area: 1640, name: 'Aamir Shaikh', phone: '9800000003', overdue: 18, paidPaise: 500000, upi: 'aamir.s@okhdfcbank' },
]
const cluster: FlatDef[] = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010].map((n, i) => ({
  id: `T14-${String(n).padStart(4, '0')}`, area: 900 + i * 40, overdue: 5 + i * 3,
}))
const sampleCsvFlats: FlatDef[] = [
  { id: 'T09-0302', area: 1000, name: 'Rohit Patil', overdue: -5 }, // exact by flat number
  { id: 'T10-0605', area: 950, name: 'Anita Rao', overdue: -5, upi: 'anita.r@okicici' }, // exact by known UPI
  { id: 'T05-0702', area: 1250, name: 'Kavita Menon', overdue: -4 }, // pays two months
  { id: 'T12-0409', area: 980, name: 'Suresh Iyer', overdue: -3 }, // same bill as Swati: makes amount alone ambiguous
]
const others: FlatDef[] = [
  ['T01-0101', 850], ['T02-0302', 1000], ['T03-0504', 1100], ['T04-0401', 760], ['T06-0903', 780], ['T08-1101', 1320], ['T08-0502', 910],
  ['T11-0807', 1180], ['T13-0204', 1020], ['T15-1001', 1400], ['T16-0306', 900], ['T17-0508', 1080], ['T18-0702', 1190], ['T19-0903', 1500],
  ['T20-1204', 870], ['T21-1602', 1640], ['T22-0401', 1330], ['T23-0605', 1010], ['T24-0807', 980], ['T25-1002', 1450], ['T26-0203', 930],
  ['T27-0506', 1130], ['T28-0901', 1600], ['T07-1204', 1150],
].map(([id, area]) => {
  const r = rnd()
  return { id: id as string, area: area as number, overdue: r < 0.55 ? int(1, 8) : r < 0.75 ? -int(2, 7) : r < 0.9 ? int(35, 55) : int(30, 40), chronic: r >= 0.9, paidPaise: undefined }
})
// most "others" are paid up
for (const f of others) if (f.overdue > 0 && f.overdue < 9) f.paidPaise = -1 // -1 means: paid in full

const ALL = [...named, ...sampleCsvFlats, ...cluster, ...others]

async function wipe() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\\_prisma%'`
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} RESTART IDENTITY CASCADE`)
}

async function main() {
  if (config.isProd && !process.argv.includes('--force-production')) {
    throw new Error('Refusing to seed demo data in production. Pass --force-production if you really mean it.')
  }
  if (process.argv.includes('--reset')) await wipe()
  else if (await prisma.society.count()) {
    console.log('Database already has data. Nothing to do. Use --reset to start over.')
    return
  }

  // ---- society, towers, gates, staff --------------------------------------------------------
  const soc = await prisma.society.create({ data: { name: 'Greenfield Heights (demo)', ratePaisePerSqft: 650, graceDays: 5, lateFeeMode: 'MONTHLY_INTEREST', lateFeeMonthlyBp: 175 } })
  const towerIds = new Map<number, string>()
  for (let n = 1; n <= 28; n++) towerIds.set(n, (await prisma.tower.create({ data: { societyId: soc.id, number: n } })).id)
  await prisma.gate.createMany({ data: [{ id: 'g1', name: 'Gate 1 (Main)' }, { id: 'g2', name: 'Gate 2 (East)' }, { id: 'g3', name: 'Gate 3 (Service)' }, { id: 'g4', name: 'Gate 4 (North)' }] })
  const staff = [
    { id: 'st-ramesh', name: 'Ramesh Pawar', skills: ['PLUMBING', 'WATER_SUPPLY'] as Category[] },
    { id: 'st-sunil', name: 'Sunil Gaikwad', skills: ['ELECTRICAL'] as Category[] },
    { id: 'st-lift', name: 'Lift vendor desk', skills: ['LIFT'] as Category[] },
    { id: 'st-anil', name: 'Anil Yadav', skills: ['SECURITY', 'PARKING', 'NOISE'] as Category[] },
    { id: 'st-sunita', name: 'Sunita Bhosale', skills: ['HOUSEKEEPING', 'GARDEN'] as Category[] },
    { id: 'st-vikram', name: 'Vikram Joshi (duty manager)', skills: [] as Category[], isDutyManager: true },
    { id: 'st-priya', name: 'Priya Deshmukh', skills: ['OTHER'] as Category[] },
  ]
  await prisma.staffMember.createMany({ data: staff })

  // ---- people --------------------------------------------------------------------------------
  const demo = (phone: string, name: string, role: 'RESIDENT' | 'HELPDESK' | 'COMMITTEE' | 'GUARD', title?: string, language = 'en') =>
    prisma.user.create({ data: { phone, name, role, title, language, consentAt: new Date() } })
  await demo('9800000010', 'Priya Deshmukh', 'HELPDESK', 'Help desk lead')
  await demo('9800000020', 'Meera Nair', 'COMMITTEE', 'Treasurer, federation committee')
  await demo('9800000030', 'Gate 1 tablet', 'GUARD', 'Main gate')

  const residentOf = new Map<string, string>() // flatId -> user id
  let phoneSeq = 9700000100
  for (const f of ALL) {
    const num = f.id.split('-')[1]
    const tower = Number(f.id.slice(1, 3))
    await prisma.flat.create({ data: { id: f.id, towerId: towerIds.get(tower)!, towerNo: tower, number: num, areaSqft: f.area } })
    const name = f.name ?? `${pick(FIRST)} ${pick(LAST)}`
    const u = await prisma.user.create({
      data: { phone: f.phone ?? String(phoneSeq++), name, role: 'RESIDENT', language: f.id === 'T21-1601' ? 'mr' : 'en', consentAt: f.phone ? new Date() : null },
    })
    await prisma.flatMember.create({ data: { userId: u.id, flatId: f.id, relation: f.rel ?? 'OWNER' } })
    residentOf.set(f.id, u.id)
    if (f.upi) await prisma.knownPayer.create({ data: { flatId: f.id, upiId: f.upi, payerName: name } })
  }
  const spouse = await prisma.user.create({ data: { phone: '9800000004', name: 'Meera Kulkarni', role: 'RESIDENT', consentAt: new Date() } })
  await prisma.flatMember.create({ data: { userId: spouse.id, flatId: 'T07-1203', relation: 'FAMILY' } })

  // ---- bills, payments, ledger ---------------------------------------------------------------
  const modes: PayMode[] = ['UPI', 'UPI', 'UPI', 'CARD', 'NETBANKING']
  let receiptSeq = 0
  const bill = async (flatId: string, area: number, due: Date, paid: 'none' | 'full' | number, paidAt?: Date) => {
    const period = periodOf(due)
    const amount = calcMaintenance(area, soc.ratePaisePerSqft)
    await prisma.$transaction(async (tx) => {
      await tx.bill.create({ data: { flatId, period, areaSqft: area, ratePaise: soc.ratePaisePerSqft, amountPaise: amount, dueDate: due, createdAt: new Date(due.getTime() - 10 * DAY) } })
      await appendLedger(tx, { flatId, type: 'BILL', amountPaise: amount, ref: `BILL:${period}`, description: `Maintenance ${periodLabel(period)}`, period, createdAt: new Date(due.getTime() - 10 * DAY) })
      const pay = paid === 'full' ? amount : paid === 'none' ? 0 : paid
      if (pay > 0) {
        const when = paidAt ?? new Date(due.getTime() - int(0, 6) * DAY)
        const mode = pick(modes)
        const p = await tx.payment.create({ data: { flatId, amountPaise: pay, mode, reference: `${mode}${crypto.randomBytes(4).toString('hex').toUpperCase()}`, source: 'TEST_GATEWAY', status: 'SUCCESS', paidAt: when, createdAt: when } })
        await appendLedger(tx, { flatId, type: 'PAYMENT', amountPaise: -pay, ref: `PAY:${p.id}`, description: `Payment ${mode} ${p.reference}`, createdAt: when })
        await tx.receipt.create({ data: { paymentId: p.id, number: `NIV-${when.getUTCFullYear()}-${String(++receiptSeq).padStart(6, '0')}`, createdAt: when } })
      }
      await refreshBillStatuses(tx, flatId)
    })
  }

  for (const f of ALL) {
    const dues = f.chronic ? [95, 60, f.overdue] : [f.overdue]
    const firstDue = new Date(now.getTime() - dues[0] * DAY)
    // three earlier months, paid, mostly on time
    for (let i = 3; i >= 1; i--) {
      const d = new Date(Date.UTC(firstDue.getUTCFullYear(), firstDue.getUTCMonth() - i, 10, 11))
      const late = rnd() < 0.15 ? int(3, 14) : 0
      await bill(f.id, f.area, d, 'full', new Date(d.getTime() - int(0, 6) * DAY + late * DAY))
    }
    for (let i = 0; i < dues.length; i++) {
      const last = i === dues.length - 1
      const due = new Date(now.getTime() - dues[i] * DAY)
      due.setUTCHours(0, 0, 0, 0)
      if (!last) await bill(f.id, f.area, due, 'none')
      else if (f.paidPaise === -1 || (f.paidPaise === 747500)) await bill(f.id, f.area, due, 'full', new Date(due.getTime() - int(1, 5) * DAY))
      else if (f.paidPaise && f.paidPaise > 0) await bill(f.id, f.area, due, f.paidPaise, new Date(due.getTime() + 2 * DAY))
      else await bill(f.id, f.area, due, 'none')
    }
  }
  const lf = await runLateFees(now)

  // ---- complaints -----------------------------------------------------------------------------
  const authors = [...residentOf.entries()]
  const nameOf = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  let codeSeq = 1000
  const staffFor = (c: Category, escalated: boolean) =>
    escalated ? 'st-vikram' : (staff.find((x) => x.skills.includes(c)) ?? staff[staff.length - 1]).id

  const make = async (o: {
    flatId: string
    text: string
    ageHours: number
    status: ComplaintStatus
    category?: Category
    parent?: string
    rating?: number
    reopened?: number
    overdue?: boolean
  }) => {
    const rules = classifyByRules(o.text)
    const safety = detectSafety(o.text)
    const category = o.category ?? (safety ? safety.defaultCategory : rules.category)
    const urgency: Urgency = safety ? 'CRITICAL' : rules.urgency
    const created = new Date(now.getTime() - o.ageHours * HOUR)
    const slaMin = DEFAULT_SLA[urgency]
    const responded = o.status !== 'NEW'
    const firstResponse = responded ? new Date(created.getTime() + Math.min(slaMin * 0.8, int(10, 400)) * 60_000) : null
    const resolvedAt = o.status === 'RESOLVED' ? new Date(created.getTime() + Math.max(2, o.ageHours * 0.5) * HOUR) : null
    const code = `C-${++codeSeq}`
    const assignee = staffFor(category, !!safety)
    const c = await prisma.complaint.create({
      data: {
        code, flatId: o.flatId, towerNo: Number(o.flatId.slice(1, 3)), authorId: residentOf.get(o.flatId)!, text: o.text, category, urgency,
        aiCategory: rules.category, aiUrgency: urgency, aiReason: safety ? safety.reason : rules.reason, aiSource: 'rules', needsReview: !rules.matched && !safety,
        assigneeId: o.status === 'NEW' ? null : assignee, status: o.status, responseDueAt: new Date(created.getTime() + slaMin * 60_000),
        firstResponseAt: firstResponse, overdueAt: o.overdue ? new Date(created.getTime() + slaMin * 60_000 + 60_000) : null,
        escalated: !!safety, escalatedReason: safety?.reason ?? null, rating: o.rating ?? null, reopenedCount: o.reopened ?? 0, resolvedAt, createdAt: created,
      },
    })
    const step = (text: string, t: Date, who = 'System') => prisma.complaintUpdate.create({ data: { complaintId: c.id, authorId: 'seed', authorName: who, kind: 'status', text, createdAt: t } })
    await step('raised', created, nameOf.get(residentOf.get(o.flatId)!) ?? 'Resident')
    if (o.status !== 'NEW') await step('assigned', new Date(created.getTime() + 60_000))
    if (o.status === 'IN_PROGRESS' || o.status === 'RESOLVED' || o.status === 'REOPENED') await step('in_progress', firstResponse!, 'Help desk')
    if (resolvedAt) await step('resolved', resolvedAt, 'Help desk')
    if (o.status === 'REOPENED') await step('reopened', new Date(now.getTime() - 2 * HOUR))
    if (o.status === 'RESOLVED' || o.status === 'IN_PROGRESS')
      await prisma.complaintUpdate.create({ data: { complaintId: c.id, authorId: 'seed', authorName: 'Help desk', staff: true, kind: 'comment', text: o.status === 'RESOLVED' ? 'Fixed and checked. Please reopen if it comes back.' : 'Technician is on the way.', createdAt: new Date(created.getTime() + 2 * HOUR) } })
    if (o.parent) await prisma.complaintLink.create({ data: { parentId: o.parent, childId: c.id } })
    return c
  }

  // the lift cluster: ten flats in tower 14 report the same lift
  const liftTexts = ['Lift is not working in tower 14 since morning', 'Tower 14 lift not working, the display shows the wrong floor', 'Lift not working in tower 14, please fix urgently', 'The lift in tower 14 is out of order since morning', 'Tower 14 main lift not working again today', 'Lift of tower 14 not working, elderly residents struggling', 'Not able to use the tower 14 lift since morning, not working', 'Tower 14 lift stopped working this morning, door does not close', 'Lift not working tower 14 since early morning', 'Lift in tower 14 is not working please send technician']
  const parent = await make({ flatId: cluster[0].id, text: liftTexts[0], ageHours: 20, status: 'IN_PROGRESS', category: 'LIFT' })
  for (let i = 1; i < cluster.length; i++) await make({ flatId: cluster[i].id, text: liftTexts[i], ageHours: 20 - i, status: 'ASSIGNED', category: 'LIFT', parent: parent.id })

  // safety complaints
  await make({ flatId: 'T09-0302', text: 'Someone is stuck in the lift between floors 8 and 9, please send help', ageHours: 0.5, status: 'ASSIGNED' })
  await make({ flatId: 'T12-0408', text: 'Water is leaking from the ceiling in the bathroom and the tap is dripping', ageHours: 52, status: 'ASSIGNED' })
  await make({ flatId: 'T02-0302', text: 'Strong gas smell near the kitchen shaft on the 3rd floor', ageHours: 5, status: 'IN_PROGRESS' })
  await make({ flatId: 'T18-0702', text: 'बेसमेंट में आग लगी है और धुआं फैल रहा है', ageHours: 70, status: 'RESOLVED', rating: 5 })

  const pool: [string, Category | undefined][] = [
    ['Water tap leaking in the kitchen sink area', 'PLUMBING'], ['Bathroom drain is clogged and water is overflowing slowly', 'PLUMBING'],
    ['Corridor light bulb fused on the 5th floor', 'ELECTRICAL'], ['Power cut only in our flat, MCB keeps tripping', 'ELECTRICAL'],
    ['Garbage not collected from the staircase landing', 'HOUSEKEEPING'], ['Lobby floor is very dirty, needs cleaning', 'HOUSEKEEPING'],
    ['Someone parked in my slot, car blocked since morning', 'PARKING'], ['Visitor vehicles are blocking the tower entrance', 'PARKING'],
    ['Loud music from the flat above till 2am', 'NOISE'], ['Construction noise before 8 am in the next building', 'NOISE'],
    ['No water supply since morning, tank empty', 'WATER_SUPPLY'], ['Low water pressure on the top floors', 'WATER_SUPPLY'],
    ['Garden sprinklers not working, lawn drying up', 'GARDEN'], ['Tree branches touching the second floor balcony', 'GARDEN'],
    ['Stranger at the gate without a visitor entry, looks suspicious', 'SECURITY'], ['CCTV near the tower 6 entrance is not working', 'SECURITY'],
    ['नल से पानी टपक रहा है, कृपया ठीक करें', 'PLUMBING'], ['कचरा नहीं उठाया गया, बहुत गंदगी है', 'HOUSEKEEPING'],
    ['लिफ्ट बंद है, कृपया दुरुस्त करा', 'LIFT'], ['पार्किंगमध्ये गाडी लावली आहे, रस्ता अडला आहे', 'PARKING'], ['नळाला पाणी कमी येते आहे', 'WATER_SUPPLY'],
    ['Parcel locker door is broken', undefined], ['Suggestion: add a bench near the children play area', undefined],
  ]
  const statuses: ComplaintStatus[] = [...Array(8).fill('NEW'), ...Array(8).fill('ASSIGNED'), ...Array(11).fill('IN_PROGRESS'), ...Array(22).fill('RESOLVED'), ...Array(2).fill('REOPENED')] as ComplaintStatus[]
  for (let i = 0; i < 46 && i < statuses.length; i++) {
    const [text, category] = pool[i % pool.length]
    const status = statuses[i]
    const [flatId] = pick(authors.filter(([id]) => !id.startsWith('T14')))
    await make({
      flatId, text, category, status, ageHours: status === 'NEW' ? int(1, 10) : status === 'RESOLVED' ? int(30, 24 * 40) : int(4, 24 * 6),
      rating: status === 'RESOLVED' && rnd() < 0.6 ? int(3, 5) : undefined, reopened: status === 'REOPENED' ? 1 : 0, overdue: status === 'NEW' && i % 3 === 0,
    })
  }
  // keep each staff member's open load honest
  for (const st of staff) {
    const n = await prisma.complaint.count({ where: { assigneeId: st.id, status: { not: 'RESOLVED' } } })
    await prisma.staffMember.update({ where: { id: st.id }, data: { openLoad: n } })
  }
  await prisma.$executeRawUnsafe(`SELECT setval('complaint_code_seq', ${codeSeq})`)

  // ---- visitors --------------------------------------------------------------------------------
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const purposes = ['Delivery', 'Cab pickup', 'Guest', 'Plumber', 'Courier', 'Food delivery', 'Relative', 'Electrician', 'Maid', 'Interview']
  const visitorStatuses: VisitorStatus[] = ['WAITING', 'WAITING', 'APPROVED', 'APPROVED', 'APPROVED', 'CHECKED_IN', 'CHECKED_IN', 'CHECKED_OUT', 'CHECKED_OUT', 'CHECKED_OUT', 'DENIED']
  const gateAdmin = (await prisma.user.findFirstOrThrow({ where: { role: 'GUARD' } })).id
  for (let i = 0; i < 28; i++) {
    const [flatId] = i < 3 ? [['T07-1203'], ['T12-0408'], ['T21-1601']][i] : pick(authors)
    const status = i < 3 ? 'WAITING' : pick(visitorStatuses)
    const created = new Date(now.getTime() - (i < 3 ? int(1, 8) * 60_000 : int(20, 72 * 60) * 60_000))
    const withPhoto = i % 4 === 0
    const photoPath = withPhoto ? await storage.put('visitors', PNG, 'png') : null
    await prisma.visitor.create({
      data: {
        clientId: `seed-visitor-${String(i).padStart(4, '0')}`, gateId: pick(['g1', 'g2', 'g3', 'g4']), flatId, name: `${pick(FIRST)} ${pick(LAST)}`,
        phone: String(9600000100 + i), purpose: pick(purposes), photoPath, photoDeleteAfter: withPhoto ? new Date(created.getTime() + 90 * DAY) : null,
        status, createdBy: gateAdmin, createdAt: created, decidedAt: status === 'WAITING' ? null : new Date(created.getTime() + 2 * 60_000), createdOffline: i % 9 === 0,
      },
    })
  }
  // two old visits whose photos are past their 90 days: the retention job removes them
  for (const flatId of ['T10-0605', 'T05-0702']) {
    const created = new Date(now.getTime() - 100 * DAY)
    await prisma.visitor.create({
      data: {
        gateId: 'g1', flatId, name: `${pick(FIRST)} ${pick(LAST)}`, phone: '9600000999', purpose: 'Guest', status: 'CHECKED_OUT', createdBy: gateAdmin, createdAt: created,
        decidedAt: created, photoPath: await storage.put('visitors', PNG, 'png'), photoDeleteAfter: new Date(created.getTime() + 90 * DAY),
      },
    })
  }
  // a pre-approved guest for today with a known demo code
  await prisma.preApproval.create({ data: { flatId: 'T07-1203', guestName: 'Aunty Sharma', date: new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`), codeHash: hashCode('482913'), createdBy: residentOf.get('T07-1203')! } })

  // ---- amenities -------------------------------------------------------------------------------
  const amenities = [
    { id: 'clubhouse', name: 'Clubhouse hall', feePaise: 250000, feeNote: 'per slot', slotMinutes: 240, openFrom: '10:00', openTo: '22:00', rules: ['Maximum 80 guests', 'Music off by 10:30 pm', 'Refundable deposit taken at the desk'] },
    { id: 'badminton', name: 'Badminton court', feePaise: 10000, feeNote: 'per hour', slotMinutes: 60, openFrom: '06:00', openTo: '22:00', rules: ['Non-marking shoes only', 'Maximum 4 players'] },
    { id: 'tennis', name: 'Tennis court', feePaise: 20000, feeNote: 'per hour', slotMinutes: 60, openFrom: '06:00', openTo: '20:00', rules: ['Bring your own racket', 'Maximum 4 players'] },
    { id: 'pool', name: 'Swimming pool', feePaise: 0, feeNote: 'free for residents', slotMinutes: 60, openFrom: '06:00', openTo: '20:00', rules: ['Swim cap required', 'Children under 12 need an adult'] },
    { id: 'gym', name: 'Gym', feePaise: 0, feeNote: 'free for residents', slotMinutes: 60, openFrom: '05:00', openTo: '22:00', rules: ['Wipe equipment after use'] },
    { id: 'terrace', name: 'Terrace party area', feePaise: 500000, feeNote: 'per slot', slotMinutes: 240, openFrom: '16:00', openTo: '24:00', rules: ['Maximum 50 guests', 'No loud music after 10 pm'] },
  ]
  await prisma.amenity.createMany({ data: amenities })
  const ist = (daysAhead: number, hhmm: string) => {
    const d = new Date(now.getTime() + daysAhead * DAY + 5.5 * HOUR).toISOString().slice(0, 10)
    return new Date(`${d}T${hhmm}:00+05:30`)
  }
  const bookings: [string, string, number, string, number][] = [
    ['clubhouse', 'T21-1601', 5, '15:00', 240], ['badminton', 'T07-1203', 1, '18:00', 60], ['badminton', 'T14-0101', 1, '19:00', 60], ['tennis', 'T09-0302', 2, '07:00', 60],
    ['pool', 'T12-0408', 1, '07:00', 60], ['terrace', 'T19-0903', 9, '20:00', 240], ['gym', 'T03-0504', 1, '06:00', 60],
  ]
  for (const [amenityId, flatId, d, t, mins] of bookings) {
    const startsAt = ist(d, t)
    await prisma.amenityBooking.create({ data: { amenityId, flatId, startsAt, endsAt: new Date(startsAt.getTime() + mins * 60_000), feePaise: amenities.find((a) => a.id === amenityId)!.feePaise, createdBy: residentOf.get(flatId)! } })
  }

  // ---- notices ---------------------------------------------------------------------------------
  await prisma.notice.createMany({
    data: [
      { title: 'Water tank cleaning on Saturday', body: 'Towers 1 to 10 will have water supply paused from 10 am to 2 pm. Please store water in advance.', createdAt: at(2) },
      { title: 'Maintenance due by the 10th', body: 'Pay by the 10th to avoid late interest as per the society bye-laws.', createdAt: at(6) },
      { title: 'Lift service in Tower 14', body: 'The lift vendor will service the Tower 14 lifts tomorrow between 11 am and 3 pm. One lift will stay in service.', createdAt: at(0, 8) },
      { title: 'Annual general meeting', body: 'The AGM is on the last Sunday of the month at the clubhouse, 11 am. Agenda is on the notice board.', createdAt: at(12) },
    ],
  })

  console.log(`Seeded ${ALL.length} flats, ${await prisma.complaint.count()} complaints, ${await prisma.visitor.count()} visitors, ${await prisma.amenityBooking.count()} bookings, ${lf.posted} late fee entries.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
