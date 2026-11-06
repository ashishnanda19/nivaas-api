import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { auth, login, makeApp, multipartFields, PHONES, PNG, seedFixture } from './helpers.js'
import { markOverdue, setLlmClients } from '../src/modules/complaints/service.js'
import { clearClassifyCache, resetAiLimits } from '../src/modules/ai/classify.js'

let app: Awaited<ReturnType<typeof makeApp>>['app']
let swati: string, neeraj: string, aamir: string, hd: string
beforeEach(async () => {
  await seedFixture()
  app = (await makeApp()).app
  setLlmClients([])
  clearClassifyCache()
  resetAiLimits()
  ;[swati, neeraj, aamir, hd] = await Promise.all([PHONES.swati, PHONES.neeraj, PHONES.aamir, PHONES.helpdesk].map((p) => login(app, p)))
})
afterAll(async () => {
  setLlmClients(null)
  await prisma.$disconnect()
})

const create = (token: string, flatId: string, text: string, extra: object = {}) =>
  app.inject({ method: 'POST', url: '/api/v1/complaints', headers: auth(token), payload: { flatId, text, ...extra } })
const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: auth(token), payload })

describe('creating complaints', () => {
  it('classifies, assigns by skill and sets the response timer', async () => {
    const r = await create(swati, 'T12-0408', 'Water is leaking from the tap in the bathroom')
    expect(r.statusCode).toBe(200)
    const c = r.json()
    expect(c).toMatchObject({ category: 'PLUMBING', urgency: 'NORMAL', status: 'ASSIGNED', escalated: false, flatId: 'T12-0408', residentName: 'Swati Joshi' })
    expect(c.id).toMatch(/^C-\d+$/)
    expect(['Ravi Pawar', 'Kiran Jadhav']).toContain(c.assignee.name)
    expect(new Date(c.dueAt).getTime() - new Date(c.createdAt).getTime()).toBeGreaterThan(7.9 * 3600e3)
    expect(c.ai).toMatchObject({ category: 'PLUMBING', source: 'rules' })
  })

  it('balances load across staff with the same skill', async () => {
    const a = (await create(swati, 'T12-0408', 'Tap leaking in the kitchen sink area')).json()
    const b = (await create(neeraj, 'T07-1203', 'Water leakage from the bathroom pipe joint')).json()
    expect(a.assignee.id).not.toBe(b.assignee.id)
  })

  it('a gas smell is escalated to the duty manager by rule, with an audit row', async () => {
    const c = (await create(swati, 'T12-0408', 'There is a strong gas smell in the kitchen')).json()
    expect(c).toMatchObject({ urgency: 'CRITICAL', escalated: true, status: 'ASSIGNED' })
    expect(c.assignee.name).toMatch(/duty manager/)
    expect(new Date(c.dueAt).getTime() - new Date(c.createdAt).getTime()).toBeLessThanOrEqual(15 * 60e3 + 1000)
    expect(await prisma.auditLog.count({ where: { action: 'complaint.escalate', entityId: c.id } })).toBe(1)
  })

  it('escalates in Hindi and Marathi too', async () => {
    expect((await create(swati, 'T12-0408', 'लिफ्ट में फंस गए हैं, जल्दी मदद करें')).json()).toMatchObject({ escalated: true, urgency: 'CRITICAL' })
    expect((await create(swati, 'T12-0408', 'स्वयंपाकघरात गॅसचा वास येतोय')).json()).toMatchObject({ escalated: true, urgency: 'CRITICAL' })
  })

  it('a model that says LOW cannot downgrade a safety word', async () => {
    setLlmClients([{ name: 'gemini', complete: async () => JSON.stringify({ category: 'LIFT', urgency: 'LOW', reason: 'minor', language: 'en', confidence: 0.95 }) }])
    const c = (await create(neeraj, 'T07-1203', 'Someone is stuck in the lift on floor 8')).json()
    expect(c).toMatchObject({ category: 'LIFT', urgency: 'CRITICAL', escalated: true })
  })

  it('unreadable model output files the complaint as OTHER for review', async () => {
    setLlmClients([{ name: 'gemini', complete: async () => 'not json' }])
    const c = (await create(neeraj, 'T07-1203', 'The corridor paint is peeling near the stairs')).json()
    expect(c).toMatchObject({ category: 'OTHER' })
    expect(c.ai.needsReview).toBe(true)
  })

  it('the resident can override the suggestion; the suggestion is kept', async () => {
    const c = (await create(neeraj, 'T07-1203', 'Water is leaking from the tap in the bathroom', { category: 'WATER_SUPPLY' })).json()
    expect(c.category).toBe('WATER_SUPPLY')
    expect(c.ai.category).toBe('PLUMBING')
  })

  it('validates input', async () => {
    expect((await create(swati, 'T12-0408', 'short')).statusCode).toBe(400)
    expect((await create(swati, 'T12-0408', 'A long enough complaint text', { sneaky: 1 })).statusCode).toBe(400)
    expect((await create(swati, 'T12-0408', 'A long enough complaint text', { category: 'NOPE' })).statusCode).toBe(400)
  })

  it('a resident cannot file for another flat', async () => {
    expect((await create(swati, 'T07-1203', 'Tap leaking in the neighbour bathroom')).statusCode).toBe(403)
  })

  it('classify preview returns a suggestion without saving anything', async () => {
    const r = await call('POST', '/complaints/classify', swati, { text: 'Garbage not collected from the staircase' })
    expect(r.json()).toMatchObject({ category: 'HOUSEKEEPING', escalated: false })
    expect(await prisma.complaint.count()).toBe(0)
  })
})

describe('photos', () => {
  const withPhoto = async (name: string, data: Buffer, type: string) => {
    const m = multipartFields({ flatId: 'T12-0408', text: 'Water leaking from the ceiling' }, { name, data, type })
    return app.inject({ method: 'POST', url: '/api/v1/complaints', headers: { ...auth(swati), ...m.headers }, payload: m.payload })
  }
  it('stores a real image and serves it through a short-lived link', async () => {
    const r = await withPhoto('leak.png', PNG, 'image/png')
    expect(r.statusCode).toBe(200)
    const url = r.json().photoUrl as string
    expect(url).toMatch(/\?t=/)
    const img = await app.inject({ method: 'GET', url })
    expect(img.statusCode).toBe(200)
    expect(img.headers['content-type']).toBe('image/png')
    expect((await app.inject({ method: 'GET', url: url.split('?')[0] + '?t=bad' })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: url.split('?')[0] })).statusCode).toBe(403)
  })
  it('rejects a non-image renamed to .png', async () => {
    const r = await withPhoto('evil.png', Buffer.from('<script>alert(1)</script>'), 'image/png')
    expect(r.statusCode).toBe(400)
    expect(await prisma.complaint.count()).toBe(0)
  })
})

describe('duplicates are linked, never closed', () => {
  it('links same-tower, same-category, similar complaints under the first', async () => {
    // all in tower 12 via the same flat id family: use a second flat in tower 12
    await prisma.flat.create({ data: { id: 'T12-0501', towerId: (await prisma.tower.findFirstOrThrow({ where: { number: 12 } })).id, towerNo: 12, number: '0501', areaSqft: 900 } })
    const u = await prisma.user.create({ data: { phone: '9333333333', name: 'Tower Twelve', role: 'RESIDENT', consentAt: new Date() } })
    await prisma.flatMember.create({ data: { userId: u.id, flatId: 'T12-0501', relation: 'OWNER' } })
    const other = await login(app, '9333333333')

    const first = (await create(swati, 'T12-0408', 'Lift is not working in tower 12 since morning')).json()
    const second = (await create(other, 'T12-0501', 'Tower 12 lift not working since morning, very inconvenient')).json()
    expect(first.clusterId).toBeNull()
    expect(second.clusterId).toBe(first.id)
    expect(second.status).not.toBe('RESOLVED')

    const parent = (await call('GET', `/complaints/${first.id}`, hd)).json()
    expect(parent.linkedCount).toBe(1)
    expect(parent.linked.map((l: { id: string }) => l.id)).toEqual([second.id])

    const folded = (await call('GET', '/complaints', hd)).json()
    expect(folded.items.map((c: { id: string }) => c.id)).toEqual([first.id])
    const all = (await call('GET', '/complaints?includeLinked=true', hd)).json()
    expect(all.total).toBe(2)
  })

  it('does not link another tower, another category, an unrelated text, or a safety complaint', async () => {
    const a = (await create(swati, 'T12-0408', 'Lift is not working in the tower since morning')).json()
    const otherTower = (await create(neeraj, 'T07-1203', 'Lift is not working in the tower since morning')).json()
    const otherText = (await create(swati, 'T12-0408', 'Lift mirror is broken and the display shows wrong floor')).json()
    const safety = (await create(swati, 'T12-0408', 'Lift is stuck and people are trapped inside, not working')).json()
    expect(otherTower.clusterId).toBeNull()
    expect(otherText.clusterId).toBeNull()
    expect(safety).toMatchObject({ clusterId: null, escalated: true })
    expect(a.clusterId).toBeNull()
  })

  it('help desk can link and unlink by hand and it is audited', async () => {
    const a = (await create(swati, 'T12-0408', 'Garbage piled up near the tower entrance')).json()
    const b = (await create(neeraj, 'T07-1203', 'Parking slot blocked by a stranger vehicle')).json()
    expect((await call('POST', `/complaints/${b.id}/link`, hd, { parentCode: a.id })).json().clusterId).toBe(a.id)
    expect((await call('DELETE', `/complaints/${b.id}/link`, hd)).json().clusterId).toBeNull()
    expect(await prisma.auditLog.count({ where: { action: { in: ['complaint.link', 'complaint.unlink'] } } })).toBe(2)
    expect((await call('POST', `/complaints/${b.id}/link`, swati, { parentCode: a.id })).statusCode).toBe(403)
  })
})

describe('help desk changes', () => {
  it('changing the category is one call, audited, and keeps the AI suggestion', async () => {
    const c = (await create(swati, 'T12-0408', 'Water leaking from the tap in the bathroom')).json()
    const r = await call('PATCH', `/complaints/${c.id}`, hd, { category: 'WATER_SUPPLY' })
    expect(r.json()).toMatchObject({ category: 'WATER_SUPPLY', ai: { category: 'PLUMBING' } })
    const a = await prisma.auditLog.findFirstOrThrow({ where: { action: 'complaint.category_change' } })
    expect(a).toMatchObject({ entityId: c.id, role: 'HELPDESK' })
    expect(a.before).toMatchObject({ category: 'PLUMBING' })
  })

  it('nobody can remove or lower a safety escalation, and the attempt is logged', async () => {
    const c = (await create(swati, 'T12-0408', 'Gas leak in the kitchen, strong smell')).json()
    expect((await call('PATCH', `/complaints/${c.id}`, hd, { escalated: false })).statusCode).toBe(409)
    expect((await call('PATCH', `/complaints/${c.id}`, hd, { urgency: 'LOW' })).statusCode).toBe(409)
    expect((await call('GET', `/complaints/${c.id}`, hd)).json()).toMatchObject({ escalated: true, urgency: 'CRITICAL' })
    expect(await prisma.auditLog.count({ where: { action: 'complaint.escalation_removal_blocked' } })).toBe(2)
    // but the category can still be corrected
    expect((await call('PATCH', `/complaints/${c.id}`, hd, { category: 'PLUMBING' })).statusCode).toBe(200)
  })

  it('a resident can change the category only while it is new, and cannot touch urgency', async () => {
    const c = (await create(swati, 'T12-0408', 'Water is leaking from the tap in the bathroom')).json()
    expect((await call('PATCH', `/complaints/${c.id}`, swati, { category: 'WATER_SUPPLY' })).statusCode).toBe(200)
    expect((await call('PATCH', `/complaints/${c.id}`, swati, { urgency: 'LOW' })).statusCode).toBe(403)
    await call('POST', `/complaints/${c.id}/status`, hd, { status: 'IN_PROGRESS' })
    expect((await call('PATCH', `/complaints/${c.id}`, swati, { category: 'OTHER' })).statusCode).toBe(409)
  })

  it('assign, progress, resolve, rate, reopen', async () => {
    const c = (await create(swati, 'T12-0408', 'Water is leaking from the tap in the bathroom')).json()
    expect((await call('POST', `/complaints/${c.id}/assign`, hd, { assigneeId: 'st-asha' })).json().assignee.id).toBe('st-asha')
    expect((await call('POST', `/complaints/${c.id}/rating`, swati, { rating: 5 })).statusCode).toBe(409)
    expect((await call('POST', `/complaints/${c.id}/reopen`, swati)).statusCode).toBe(409)
    await call('POST', `/complaints/${c.id}/status`, hd, { status: 'IN_PROGRESS' })
    const done = (await call('POST', `/complaints/${c.id}/status`, hd, { status: 'RESOLVED', note: 'Washer replaced' })).json()
    expect(done.status).toBe('RESOLVED')
    expect(done.timeline.map((t: { step: string }) => t.step)).toEqual(['raised', 'assigned', 'assigned', 'in_progress', 'resolved'])
    expect((await call('POST', `/complaints/${c.id}/rating`, swati, { rating: 4 })).json().rating).toBe(4)
    expect((await call('POST', `/complaints/${c.id}/rating`, hd, { rating: 4 })).statusCode).toBe(403)
    const re = (await call('POST', `/complaints/${c.id}/reopen`, swati)).json()
    expect(re).toMatchObject({ status: 'REOPENED', reopened: 1, rating: null })
    expect((await prisma.staffMember.findUniqueOrThrow({ where: { id: 'st-asha' } })).openLoad).toBe(1)
  })

  it('comments from staff count as the first response', async () => {
    const c = (await create(swati, 'T12-0408', 'Water is leaking from the tap in the bathroom')).json()
    await call('POST', `/complaints/${c.id}/comments`, swati, { text: 'Any update?' })
    expect((await prisma.complaint.findUniqueOrThrow({ where: { code: c.id } })).firstResponseAt).toBeNull()
    await call('POST', `/complaints/${c.id}/comments`, hd, { text: 'On it' })
    expect((await prisma.complaint.findUniqueOrThrow({ where: { code: c.id } })).firstResponseAt).not.toBeNull()
    const d = (await call('GET', `/complaints/${c.id}`, swati)).json()
    expect(d.comments.map((x: { staff: boolean }) => x.staff)).toEqual([false, true])
  })
})

describe('access control', () => {
  it("a resident cannot read, comment on or change another flat's complaint", async () => {
    const c = (await create(swati, 'T12-0408', 'Water is leaking from the tap in the bathroom')).json()
    for (const [m, u, body] of [['GET', `/complaints/${c.id}`], ['POST', `/complaints/${c.id}/comments`, { text: 'hi' }], ['PATCH', `/complaints/${c.id}`, { category: 'OTHER' }], ['POST', `/complaints/${c.id}/reopen`]] as const)
      expect((await call(m, u, aamir, body as object | undefined)).statusCode, `${m} ${u}`).toBe(404)
    expect((await call('GET', '/complaints', aamir)).json().total).toBe(0)
    expect((await call('GET', '/complaints?flatId=T12-0408', aamir)).statusCode).toBe(403)
  })

  it('guard and committee have no complaint access; residents cannot assign or list staff', async () => {
    const g = await login(app, PHONES.guard)
    const c = await login(app, PHONES.committee)
    expect((await call('GET', '/complaints', g)).statusCode).toBe(403)
    expect((await call('GET', '/complaints', c)).statusCode).toBe(403)
    expect((await call('GET', '/staff', swati)).statusCode).toBe(403)
    expect((await call('GET', '/staff', hd)).json().items).toHaveLength(5)
  })

  it('help desk filters and searches', async () => {
    await create(swati, 'T12-0408', 'Water is leaking from the tap in the bathroom')
    await create(neeraj, 'T07-1203', 'Gas smell near the cylinder in the kitchen')
    expect((await call('GET', '/complaints?escalated=true', hd)).json().total).toBe(1)
    expect((await call('GET', '/complaints?category=PLUMBING', hd)).json().total).toBe(1)
    expect((await call('GET', '/complaints?tower=7', hd)).json().total).toBe(1)
    expect((await call('GET', '/complaints?search=bathroom', hd)).json().total).toBe(1)
    expect((await call('GET', '/complaints?status=OPEN&pageSize=1', hd)).json().items).toHaveLength(1)
  })
})

describe('overdue job', () => {
  it('marks an unanswered complaint overdue once', async () => {
    const c = (await create(swati, 'T12-0408', 'Water is leaking from the tap in the bathroom')).json()
    expect((await markOverdue()).marked).toBe(0)
    await prisma.complaint.update({ where: { code: c.id }, data: { responseDueAt: new Date(Date.now() - 60_000) } })
    expect((await markOverdue()).marked).toBe(1)
    expect((await markOverdue()).marked).toBe(0)
    expect((await call('GET', `/complaints/${c.id}`, hd)).json().overdue).toBe(true)
  })
  it('does not mark one that already has a response', async () => {
    const c = (await create(swati, 'T12-0408', 'Water is leaking from the tap in the bathroom')).json()
    await call('POST', `/complaints/${c.id}/comments`, hd, { text: 'On it' })
    await prisma.complaint.update({ where: { code: c.id }, data: { responseDueAt: new Date(Date.now() - 60_000) } })
    expect((await markOverdue()).marked).toBe(0)
  })
})

describe('audit of staff access', () => {
  it('logs staff comments and staff opening a resident complaint, but not the resident reading their own', async () => {
    const c = (await create(swati, 'T12-0408', 'Water is leaking from the tap in the bathroom')).json()
    await call('GET', `/complaints/${c.id}`, swati)
    expect(await prisma.auditLog.count({ where: { action: 'pii.view' } })).toBe(0)
    await call('GET', `/complaints/${c.id}`, hd)
    expect(await prisma.auditLog.count({ where: { action: 'pii.view', entity: 'Complaint', entityId: c.id } })).toBe(1)
    await call('POST', `/complaints/${c.id}/comments`, swati, { text: 'Any news?' })
    expect(await prisma.auditLog.count({ where: { action: 'complaint.comment' } })).toBe(0)
    await call('POST', `/complaints/${c.id}/comments`, hd, { text: 'On it' })
    expect(await prisma.auditLog.count({ where: { action: 'complaint.comment' } })).toBe(1)
  })
})
