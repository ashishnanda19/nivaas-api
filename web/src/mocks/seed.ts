import { calcLateFee } from '@/lib/format'
import { classifyText, SLA_HOURS } from '@/lib/classify'
import type {
  Amenity,
  AuditEntry,
  Booking,
  Category,
  Complaint,
  ComplaintStatus,
  Flat,
  Member,
  Notice,
  PreApproval,
  Receipt,
  Staff,
  TimelineStep,
  User,
  Visitor,
} from '@/lib/api/types'

export const RATE = 6.5
export const DAY = 86400000
export const HOUR = 3600000

export interface RawLedger {
  id: string
  flatId: string
  date: string
  kind: 'bill' | 'payment' | 'late_fee'
  desc: string
  debit: number
  credit: number
}
export interface Db {
  seedDay: string
  flats: Flat[]
  ledger: RawLedger[]
  complaints: Complaint[]
  visitors: Visitor[]
  preApprovals: PreApproval[]
  bookings: Booking[]
  members: Member[]
  audit: AuditEntry[]
  receipts: Receipt[]
  postedRefs: string[]
  billRuns: string[]
}

export const USERS: User[] = [
  {
    id: 'u1',
    name: 'Neeraj Kulkarni',
    phone: '9800000001',
    role: 'resident',
    flatId: 'T07-1203',
    memberRole: 'owner',
  },
  {
    id: 'u2',
    name: 'Swati Joshi',
    phone: '9800000002',
    role: 'resident',
    flatId: 'T12-0408',
    memberRole: 'tenant',
  },
  {
    id: 'u3',
    name: 'Aamir Shaikh',
    phone: '9800000003',
    role: 'resident',
    flatId: 'T21-1601',
    memberRole: 'owner',
  },
  { id: 'u4', name: 'Priya Deshmukh', phone: '9800000010', role: 'helpdesk', title: 'Help desk lead' },
  {
    id: 'u5',
    name: 'Meera Nair',
    phone: '9800000020',
    role: 'committee',
    title: 'Treasurer, federation committee',
  },
  { id: 'u6', name: 'Gate 1 tablet', phone: '9800000030', role: 'guard', title: 'Main gate' },
]

export const STAFF: Staff[] = [
  { id: 's1', name: 'Ramesh Pawar', skills: ['plumbing'] },
  { id: 's2', name: 'Sunil Gaikwad', skills: ['electrical'] },
  { id: 's3', name: 'Lift vendor desk', skills: ['lift'] },
  { id: 's4', name: 'Anil Yadav', skills: ['security', 'parking', 'noise'] },
  { id: 's5', name: 'Sunita Bhosale', skills: ['housekeeping'] },
  { id: 's6', name: 'Vikram Joshi (duty manager)', skills: ['safety'] },
  { id: 's7', name: 'Priya Deshmukh', skills: ['other'] },
]
export const staffFor = (c: Category) => STAFF.find((s) => s.skills.includes(c))?.name ?? 'Priya Deshmukh'

export const GATES = ['Gate 1 (Main)', 'Gate 2 (East)', 'Gate 3 (Service)', 'Gate 4 (North)']

export const AMENITIES: Amenity[] = [
  {
    id: 'a1',
    name: 'Clubhouse hall',
    fee: 2500,
    feeNote: 'per slot',
    rules: ['Maximum 80 guests', 'Music off by 10:30 pm', 'Refundable deposit taken at the desk'],
    slots: ['10:00–14:00', '15:00–19:00', '19:00–23:00'],
  },
  {
    id: 'a2',
    name: 'Badminton court',
    fee: 100,
    feeNote: 'per hour',
    rules: ['Non-marking shoes only', 'Maximum 4 players'],
    slots: ['06:00–07:00', '07:00–08:00', '17:00–18:00', '18:00–19:00', '19:00–20:00', '20:00–21:00'],
  },
  {
    id: 'a3',
    name: 'Tennis court',
    fee: 200,
    feeNote: 'per hour',
    rules: ['Tennis shoes only', 'Maximum 4 players', 'Floodlights till 9 pm'],
    slots: ['06:00–07:00', '07:00–08:00', '17:00–18:00', '18:00–19:00', '19:00–20:00'],
  },
  {
    id: 'a4',
    name: 'Swimming pool',
    fee: 0,
    feeNote: 'included',
    rules: ['Swimwear mandatory', 'Children under 12 with an adult', 'Closed on Mondays'],
    slots: ['06:00–07:00', '07:00–08:00', '16:00–17:00', '17:00–18:00', '18:00–19:00'],
  },
  {
    id: 'a5',
    name: 'Gym',
    fee: 0,
    feeNote: 'included',
    rules: ['Maximum 12 people per slot', 'Carry a towel'],
    slots: ['05:30–07:00', '07:00–08:30', '18:00–19:30', '19:30–21:00'],
  },
  {
    id: 'a6',
    name: 'Terrace lawn',
    fee: 1500,
    feeNote: 'per slot',
    rules: ['Maximum 40 guests', 'No loud music', 'Clean up before leaving'],
    slots: ['10:00–14:00', '16:00–20:00', '19:00–22:00'],
  },
]

export const NOTICES: Notice[] = [
  {
    id: 'n1',
    title: 'Water tank cleaning on Saturday',
    body: 'Towers 1 to 10 will have water supply paused from 10 am to 2 pm. Please store water in advance.',
    at: '',
  },
  {
    id: 'n2',
    title: 'Maintenance due by the 10th',
    body: 'Pay by the 10th to avoid late interest as per the society bye-laws.',
    at: '',
  },
  {
    id: 'n3',
    title: 'Lift B in Tower 14 under repair',
    body: 'The vendor is on site. Expected restoration by tomorrow evening. Use Lift A meanwhile.',
    at: '',
  },
  {
    id: 'n4',
    title: 'Diwali clubhouse bookings open',
    body: 'Book early. Terrace lawn and clubhouse hall slots are limited.',
    at: '',
  },
  {
    id: 'n5',
    title: 'New visitor photo notice at gates',
    body: 'Visitor photos are kept for 90 days and then deleted, under the DPDP Act 2023.',
    at: '',
  },
]

function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST = [
  'Rohan',
  'Anjali',
  'Vikram',
  'Sneha',
  'Karan',
  'Pooja',
  'Rahul',
  'Divya',
  'Sanjay',
  'Kavita',
  'Amit',
  'Neha',
  'Manish',
  'Ritu',
  'Suresh',
  'Meena',
  'Arjun',
  'Isha',
  'Nikhil',
  'Shweta',
  'Prakash',
  'Asha',
  'Deepak',
  'Rekha',
]
const LAST = [
  'Patil',
  'Deshpande',
  'Kale',
  'Jadhav',
  'Mehta',
  'Iyer',
  'Sharma',
  'Gokhale',
  'Naik',
  'Bhosale',
  'Khan',
  'Fernandes',
  'Rao',
  'Joshi',
  'Pawar',
  'More',
  'Menon',
  'Shinde',
]
const banks = ['okaxis', 'oksbi', 'okhdfcbank', 'ybl', 'paytm']

export function seedFlats(): Flat[] {
  const r = rng(7)
  const named: Flat[] = [
    {
      id: 'T07-1203',
      tower: 7,
      area: 1150,
      residentName: 'Neeraj Kulkarni',
      tenant: false,
      billed: 7475,
      paid: 7475,
      credit: 0,
      daysOverdue: 0,
      upiIds: ['neeraj.k@okaxis'],
    },
    {
      id: 'T12-0408',
      tower: 12,
      area: 980,
      residentName: 'Swati Joshi',
      tenant: true,
      billed: 6370,
      paid: 0,
      credit: 0,
      daysOverdue: 47,
      upiIds: ['swati.joshi@ybl'],
    },
    {
      id: 'T21-1601',
      tower: 21,
      area: 1640,
      residentName: 'Aamir Shaikh',
      tenant: false,
      billed: 10660,
      paid: 5000,
      credit: 0,
      daysOverdue: 18,
      upiIds: ['aamir.shaikh@oksbi'],
    },
  ]
  const used = new Set(named.map((f) => f.id))
  const towers = [...Array(10).fill(14), ...Array.from({ length: 32 }, () => 1 + Math.floor(r() * 28))]
  const gen: Flat[] = []
  towers.forEach((tower, i) => {
    let id: string
    do {
      const floor = 1 + Math.floor(r() * 18)
      const unit = 1 + Math.floor(r() * 8)
      id = `T${String(tower).padStart(2, '0')}-${String(floor).padStart(2, '0')}${String(unit).padStart(2, '0')}`
    } while (used.has(id))
    used.add(id)
    const area = [650, 720, 850, 980, 1100, 1250, 1450, 1640, 1800][Math.floor(r() * 9)]
    const billed = Math.round(area * RATE)
    const name = `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`
    // First 8 non-tower-14 flats are forced unpaid so the demo bank statement has material.
    const forced = i >= 10 && i < 20
    const roll = r()
    let paid = billed
    let daysOverdue = 0
    if (forced || roll > 0.72) {
      paid = forced && i % 3 === 0 ? Math.round(billed * 0.4) : 0
      daysOverdue = roll > 0.9 || forced ? 5 + Math.floor(r() * 80) : 0
    }
    gen.push({
      id,
      tower,
      area,
      residentName: name,
      tenant: r() < 0.25,
      billed,
      paid,
      credit: 0,
      daysOverdue,
      upiIds:
        r() < 0.6 ? [`${name.toLowerCase().replace(' ', '.')}@${banks[Math.floor(r() * banks.length)]}`] : [],
    })
  })
  return [...named, ...gen]
}

export function dueDateOf(f: Flat, now: Date): Date {
  return f.daysOverdue > 0 ? new Date(now.getTime() - f.daysOverdue * DAY) : new Date(now.getTime() + 5 * DAY)
}

function seedLedger(flats: Flat[], now: Date): RawLedger[] {
  const out: RawLedger[] = []
  for (const f of flats) {
    const billDate = new Date(dueDateOf(f, now).getTime() - 10 * DAY)
    for (let k = 3; k >= 1; k--) {
      const d = new Date(billDate)
      d.setMonth(d.getMonth() - k)
      const label = d.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
      out.push({
        id: `L-${f.id}-b${k}`,
        flatId: f.id,
        date: d.toISOString(),
        kind: 'bill',
        desc: `Maintenance, ${label}`,
        debit: f.billed,
        credit: 0,
      })
      out.push({
        id: `L-${f.id}-p${k}`,
        flatId: f.id,
        date: new Date(d.getTime() + 5 * DAY).toISOString(),
        kind: 'payment',
        desc: 'Payment received (UPI)',
        debit: 0,
        credit: f.billed,
      })
    }
    const label = billDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' })
    out.push({
      id: `L-${f.id}-b0`,
      flatId: f.id,
      date: billDate.toISOString(),
      kind: 'bill',
      desc: `Maintenance, ${label}`,
      debit: f.billed,
      credit: 0,
    })
    if (f.paid > 0) {
      const payDate = new Date(Math.min(now.getTime(), billDate.getTime() + 4 * DAY))
      out.push({
        id: `L-${f.id}-p0`,
        flatId: f.id,
        date: payDate.toISOString(),
        kind: 'payment',
        desc: f.paid >= f.billed ? 'Payment received (UPI)' : 'Part payment received (UPI)',
        debit: 0,
        credit: f.paid,
      })
    }
  }
  return out
}

const TEXTS: Partial<Record<Category, string[]>> = {
  plumbing: [
    'Water leaking from the bathroom ceiling',
    'Kitchen tap is dripping all day',
    'Drain blocked in the balcony',
    'Low water pressure since morning',
    'नल से पानी टपक रहा है',
  ],
  electrical: [
    'Corridor light not working on our floor',
    'Power keeps tripping in the evening',
    'Switch board in the hall is loose',
    'Staircase bulb fused',
  ],
  lift: [
    'Lift is very slow and jerks between floors',
    'Lift door does not close properly',
    'Lift display is not working',
  ],
  security: [
    'Stranger loitering near the tower entrance',
    'Guard was not at the gate at night',
    'CCTV near parking looks off',
  ],
  housekeeping: [
    'Garbage not collected from our floor',
    'Staircase is dirty and not swept',
    'Dustbin overflowing near the lobby',
  ],
  parking: ['Someone parked in my slot', 'Bike blocking the car exit'],
  noise: ['Loud music from a flat after 11 pm', 'Drilling noise on Sunday morning'],
  other: ['Need a duplicate access card', 'Please paint the number plate outside my door'],
}

const addStep = (tl: Complaint['timeline'], step: TimelineStep, at: number) =>
  tl.push({ step, at: new Date(at).toISOString() })

function seedComplaints(flats: Flat[], now: Date): Complaint[] {
  const r = rng(21)
  const t0 = now.getTime()
  const list: Complaint[] = []
  let n = 1001
  const mk = (
    flat: Flat,
    text: string,
    age: number,
    forced?: { status?: ComplaintStatus; category?: Category; cluster?: string },
  ): Complaint => {
    const cls = classifyText(text)
    const category = forced?.category ?? cls.category
    const createdAt = t0 - age
    const status: ComplaintStatus =
      forced?.status ??
      (age > 6 * DAY
        ? r() < 0.9
          ? 'resolved'
          : 'in_progress'
        : age > 2 * DAY
          ? (['resolved', 'in_progress', 'assigned'] as const)[Math.floor(r() * 3)]
          : (['new', 'assigned', 'in_progress'] as const)[Math.floor(r() * 3)])
    const tl: Complaint['timeline'] = []
    addStep(tl, 'raised', createdAt)
    if (status !== 'new') addStep(tl, 'assigned', createdAt + 12 * 60000)
    if (status === 'in_progress' || status === 'resolved') addStep(tl, 'in_progress', createdAt + 2 * HOUR)
    const resolvedAt =
      status === 'resolved' ? createdAt + Math.min(age - 1000, (6 + r() * 40) * HOUR) : undefined
    if (resolvedAt) addStep(tl, 'resolved', resolvedAt)
    const urgency = cls.escalated ? 'urgent' : cls.urgency
    return {
      id: `C-${n++}`,
      flatId: flat.id,
      residentName: flat.residentName,
      text,
      category,
      urgency,
      status,
      createdAt: new Date(createdAt).toISOString(),
      dueAt: new Date(createdAt + SLA_HOURS[urgency] * HOUR).toISOString(),
      assignee: status === 'new' ? undefined : staffFor(category),
      comments:
        status === 'new'
          ? []
          : [
              {
                id: `cm-${n}`,
                by: staffFor(category),
                staff: true,
                text: 'We have noted this and assigned a technician.',
                at: new Date(createdAt + 15 * 60000).toISOString(),
              },
            ],
      clusterId: forced?.cluster,
      escalated: cls.escalated,
      aiCategory: cls.category,
      aiUrgency: cls.urgency,
      aiReason: cls.reason,
      rating: status === 'resolved' && r() < 0.6 ? 3 + Math.floor(r() * 3) : undefined,
      reopened: status === 'resolved' && r() < 0.12 ? 1 : 0,
      resolvedAt: resolvedAt ? new Date(resolvedAt).toISOString() : undefined,
      timeline: tl,
    }
  }
  const byId = (id: string) => flats.find((f) => f.id === id)!
  // Hand-written ones the brief asks for.
  list.push(
    mk(byId('T12-0408'), 'Water leaking from the bathroom ceiling', 26 * HOUR, {
      status: 'in_progress',
      category: 'plumbing',
    }),
  )
  const t14 = flats.filter((f) => f.tower === 14)
  list.push(
    mk(t14[0], 'Lift is stuck between floors 6 and 7, people inside', 40 * 60000, { status: 'assigned' }),
  )
  list.push(
    mk(flats[12], 'Strong gas smell in the corridor near the meter room', 25 * 60000, { status: 'new' }),
  )
  // Cluster: ten flats report the same lift.
  t14
    .slice(0, 10)
    .forEach((f, i) =>
      list.push(
        mk(
          f,
          [
            'Lift B not working in Tower 14',
            'Tower 14 lift B is out of service',
            'Lift B stopped, we are using stairs on the 15th floor',
          ][i % 3],
          (3 + i * 0.6) * HOUR,
          { status: i < 5 ? 'in_progress' : 'assigned', category: 'lift', cluster: 'CL-T14-LIFT-B' },
        ),
      ),
    )
  // The rest, varied.
  const cats = Object.keys(TEXTS) as Category[]
  while (list.length < 60) {
    const c = cats[Math.floor(r() * cats.length)]
    const texts = TEXTS[c]!
    list.push(
      mk(
        flats[Math.floor(r() * flats.length)],
        texts[Math.floor(r() * texts.length)],
        (4 + r() * 24 * 30) * HOUR,
      ),
    )
  }
  return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
}

const PURPOSES = ['Delivery', 'Guest', 'Cab', 'Service visit', 'Domestic help']
const VISITOR_NAMES = [
  'Ravi Kumar',
  'Sunita Devi',
  'Mohammed Irfan',
  'Anita Rao',
  'Delivery - Swiggy',
  'Delivery - Amazon',
  'Uber driver',
  'Plumber (Urban Co)',
  'Kiran Pawar',
  'Tushar Ghosh',
]

function seedVisitors(flats: Flat[], now: Date): Visitor[] {
  const r = rng(99)
  const t0 = now.getTime()
  const out: Visitor[] = []
  for (let i = 0; i < 30; i++) {
    const flat = i < 3 ? flats[i] : flats[Math.floor(r() * flats.length)]
    const createdAt = i < 8 ? t0 - (i + 1) * 40 * 60000 : t0 - (1 + r() * 6) * DAY
    const status = i === 0 ? 'waiting' : r() < 0.88 ? 'approved' : 'denied'
    out.push({
      id: `V-${2000 + i}`,
      gateId: GATES[Math.floor(r() * 4)],
      flatId: flat.id,
      name: VISITOR_NAMES[Math.floor(r() * VISITOR_NAMES.length)],
      phone: `98${Math.floor(10000000 + r() * 89999999)}`,
      purpose: PURPOSES[Math.floor(r() * PURPOSES.length)],
      createdAt: new Date(createdAt).toISOString(),
      status,
      source: 'guard',
      decidedAt: status === 'waiting' ? undefined : new Date(createdAt + 90000).toISOString(),
    })
  }
  return out.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
}

export function buildSeed(now = new Date()): Db {
  const flats = seedFlats()
  const day = now.toISOString().slice(0, 10)
  const ymd = (d: number) => new Date(now.getTime() + d * DAY).toISOString().slice(0, 10)
  const bookings: Booking[] = [
    {
      id: 'B-1',
      amenityId: 'a2',
      amenityName: 'Badminton court',
      flatId: 'T07-1203',
      date: ymd(1),
      slot: '18:00–19:00',
      fee: 100,
      status: 'confirmed',
    },
    {
      id: 'B-2',
      amenityId: 'a1',
      amenityName: 'Clubhouse hall',
      flatId: 'T21-1601',
      date: ymd(3),
      slot: '19:00–23:00',
      fee: 2500,
      status: 'confirmed',
    },
    {
      id: 'B-3',
      amenityId: 'a3',
      amenityName: 'Tennis court',
      flatId: 'T12-0408',
      date: ymd(2),
      slot: '07:00–08:00',
      fee: 200,
      status: 'confirmed',
    },
    {
      id: 'B-4',
      amenityId: 'a2',
      amenityName: 'Badminton court',
      flatId: 'T14-0301',
      date: ymd(1),
      slot: '19:00–20:00',
      fee: 100,
      status: 'confirmed',
    },
    {
      id: 'B-5',
      amenityId: 'a1',
      amenityName: 'Clubhouse hall',
      flatId: 'T03-0502',
      date: ymd(5),
      slot: '10:00–14:00',
      fee: 2500,
      status: 'confirmed',
    },
  ]
  const members: Member[] = [
    { id: 'm1', flatId: 'T07-1203', name: 'Neeraj Kulkarni', phone: '9800000001', role: 'owner' },
    { id: 'm2', flatId: 'T07-1203', name: 'Smita Kulkarni', phone: '9822200011', role: 'family' },
    { id: 'm3', flatId: 'T12-0408', name: 'Swati Joshi', phone: '9800000002', role: 'tenant' },
    { id: 'm4', flatId: 'T21-1601', name: 'Aamir Shaikh', phone: '9800000003', role: 'owner' },
    { id: 'm5', flatId: 'T21-1601', name: 'Zoya Shaikh', phone: '9822200044', role: 'family' },
  ]
  const audit: AuditEntry[] = [
    {
      id: 'au1',
      at: new Date(now.getTime() - 5 * HOUR).toISOString(),
      actor: 'Priya Deshmukh',
      action: 'Assigned complaint',
      target: 'C-1001',
      detail: 'Assigned to Ramesh Pawar',
    },
    {
      id: 'au2',
      at: new Date(now.getTime() - 26 * HOUR).toISOString(),
      actor: 'Priya Deshmukh',
      action: 'Posted payments',
      target: 'Bank statement',
      detail: '14 exact matches posted, ₹1,02,340',
    },
    {
      id: 'au3',
      at: new Date(now.getTime() - 3 * DAY).toISOString(),
      actor: 'Meera Nair',
      action: 'Downloaded report',
      target: 'Monthly report',
      detail: 'Previous month',
    },
  ]
  return {
    seedDay: day,
    flats,
    ledger: seedLedger(flats, now),
    complaints: seedComplaints(flats, now),
    visitors: seedVisitors(flats, now),
    preApprovals: [],
    bookings,
    members,
    audit,
    receipts: [],
    postedRefs: [],
    billRuns: [],
  }
}

export const lateFeeFor = (f: Flat) => calcLateFee(Math.max(f.billed - f.paid, 0), f.daysOverdue)
