import type { FastifyInstance } from 'fastify'
import { prisma } from '../src/lib/db.js'
import { buildApp } from '../src/app.js'
import { MemoryMessageProvider } from '../src/modules/auth/messages.js'
import { calcMaintenance } from '../src/lib/money.js'
import { appendLedger } from '../src/modules/billing/ledger.js'
import { dueDateFor } from '../src/modules/billing/service.js'

export const PHONES = {
  neeraj: '9000000001', // T07-1203 owner
  swati: '9000000002', // T12-0408 tenant
  aamir: '9000000003', // T21-1601 owner
  neerajSpouse: '9000000004', // T07-1203 family
  helpdesk: '9000000010',
  committee: '9000000011',
  guard: '9000000012',
  noConsent: '9000000013',
}

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\\_prisma%'`
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(',')} RESTART IDENTITY CASCADE`)
}

export const THIS_PERIOD = () => new Date().toISOString().slice(0, 7)
export const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)

/** Small fixture: the three named flats, one user per role, one bill each. */
export async function seedFixture() {
  await resetDb()
  const soc = await prisma.society.create({ data: { name: 'Test Township', graceDays: 5 } })
  const towers = new Map<number, string>()
  for (const n of [7, 12, 21]) towers.set(n, (await prisma.tower.create({ data: { societyId: soc.id, number: n } })).id)
  const flats = [
    { id: 'T07-1203', t: 7, n: '1203', a: 1150 },
    { id: 'T12-0408', t: 12, n: '0408', a: 980 },
    { id: 'T21-1601', t: 21, n: '1601', a: 1640 },
  ]
  for (const f of flats) await prisma.flat.create({ data: { id: f.id, towerId: towers.get(f.t)!, towerNo: f.t, number: f.n, areaSqft: f.a } })
  const mk = (phone: string, name: string, role: 'RESIDENT' | 'HELPDESK' | 'COMMITTEE' | 'GUARD', consent = true) =>
    prisma.user.create({ data: { phone, name, role, consentAt: consent ? new Date() : null } })
  const neeraj = await mk(PHONES.neeraj, 'Neeraj Kulkarni', 'RESIDENT')
  const swati = await mk(PHONES.swati, 'Swati Joshi', 'RESIDENT')
  const aamir = await mk(PHONES.aamir, 'Aamir Shaikh', 'RESIDENT')
  const spouse = await mk(PHONES.neerajSpouse, 'Meera Kulkarni', 'RESIDENT')
  await mk(PHONES.helpdesk, 'Help Desk', 'HELPDESK')
  await mk(PHONES.committee, 'Committee', 'COMMITTEE')
  await mk(PHONES.guard, 'Gate Guard', 'GUARD')
  await mk(PHONES.noConsent, 'No Consent', 'RESIDENT', false)
  await prisma.flatMember.createMany({
    data: [
      { userId: neeraj.id, flatId: 'T07-1203', relation: 'OWNER' },
      { userId: spouse.id, flatId: 'T07-1203', relation: 'FAMILY' },
      { userId: swati.id, flatId: 'T12-0408', relation: 'TENANT' },
      { userId: aamir.id, flatId: 'T21-1601', relation: 'OWNER' },
    ],
  })
  await prisma.staffMember.createMany({
    data: [
      { id: 'st-ravi', name: 'Ravi Pawar', skills: ['PLUMBING', 'WATER_SUPPLY'] },
      { id: 'st-ravi2', name: 'Kiran Jadhav', skills: ['PLUMBING', 'WATER_SUPPLY'] },
      { id: 'st-sunita', name: 'Sunita More', skills: ['ELECTRICAL', 'LIFT'] },
      { id: 'st-asha', name: 'Asha Kale', skills: ['HOUSEKEEPING', 'GARDEN', 'PARKING', 'NOISE', 'SECURITY', 'OTHER'] },
      { id: 'st-duty', name: 'Mr. Deshmukh (duty manager)', skills: [], isDutyManager: true },
    ],
  })
  await prisma.gate.createMany({ data: [{ id: 'G1', name: 'Main gate' }, { id: 'G2', name: 'Tower gate' }] })
  // Bills: period 47 / 18 days overdue for the two unpaid flats, current for Neeraj.
  const bill = async (flatId: string, area: number, daysOver: number, paid = 0) => {
    const due = daysAgo(daysOver)
    const period = due.toISOString().slice(0, 7)
    const amount = calcMaintenance(area, soc.ratePaisePerSqft)
    await prisma.$transaction(async (tx) => {
      await tx.bill.create({ data: { flatId, period, areaSqft: area, ratePaise: soc.ratePaisePerSqft, amountPaise: amount, dueDate: due } })
      await appendLedger(tx, { flatId, type: 'BILL', amountPaise: amount, ref: `BILL:${period}`, description: `Maintenance ${period}`, period })
      if (paid) await appendLedger(tx, { flatId, type: 'PAYMENT', amountPaise: -paid, ref: `PAY:seed-${flatId}`, description: 'Seed payment' })
    })
  }
  await bill('T07-1203', 1150, 3, 747500)
  await bill('T12-0408', 980, 47)
  await bill('T21-1601', 1640, 18, 500000)
  void dueDateFor
  return { soc }
}

export function makeApp() {
  const sms = new MemoryMessageProvider()
  return buildApp({ sms }).then((app) => ({ app, sms }))
}

export async function login(app: FastifyInstance, phone: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone } })
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone, code: '123456' } })
  if (r.statusCode !== 200) throw new Error(`login failed ${r.statusCode} ${r.body}`)
  return r.json().accessToken
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` })

/** Build a multipart/form-data body by hand so tests need no extra dependency. */
export function multipart(filename: string, content: string, contentType = 'text/csv') {
  const boundary = '----nivaas' + Math.random().toString(16).slice(2)
  const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n${content}\r\n--${boundary}--\r\n`
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}

export const SAMPLE_CSV = [
  'Date,Amount,Reference,UPI ID,Narration',
  '05/11/2026,"6,370.00",UPI/T12-0408/MAINT,swati.j@ybl,Maintenance',
  '05/11/2026,"6,370.00",UPI/T12-0408/MAINT,swati.j@ybl,Maintenance',
  '05/11/2026,3000,T12-0408 PART,,Part payment',
  '06/11/2026,"21,320.00",MAINT T21-1601 2 MONTHS,,Two months',
  '06/11/2026,43.21,NEFT 88231,unknown.person@ybl,Transfer',
  '06/11/2026,"7,475.00",UPI/T07-1203/MAINT,neeraj.k@okaxis,Maintenance',
].join('\n')

// 1x1 PNG, enough for the magic-byte check
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

export function multipartFields(fields: Record<string, string>, file?: { name: string; data: Buffer; type: string }) {
  const b = '----nivaas' + Math.random().toString(16).slice(2)
  const parts: Buffer[] = []
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`))
  if (file) {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="photo"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${b}--\r\n`))
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } }
}
