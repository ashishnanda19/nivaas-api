import type { Category, Complaint, ComplaintStatus, Prisma, Urgency } from '@prisma/client'
import { prisma } from '../../lib/db.js'
import type { Db, Tx } from '../../lib/db.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { isOps, signFileToken, type AuthUser } from '../../lib/auth.js'
import { storage, requireImage } from '../../lib/storage.js'
import { writeAudit, systemActor, type Actor } from '../audit/service.js'
import { classifyComplaint, type Classification } from '../ai/classify.js'
import { defaultClients, type LlmClient } from '../ai/llm.js'

export const DEFAULT_SLA: Record<Urgency, number> = { CRITICAL: 15, HIGH: 120, NORMAL: 480, LOW: 1440 }
export const DUPLICATE_WINDOW_MS = 48 * 3600 * 1000
export const SIMILARITY_THRESHOLD = 0.34

let clientsOverride: LlmClient[] | null = null
/** Tests inject fake model clients here. */
export const setLlmClients = (c: LlmClient[] | null) => { clientsOverride = c }
const clients = () => clientsOverride ?? defaultClients()

export async function slaFor(db: Db, urgency: Urgency): Promise<number> {
  const soc = await db.society.findFirst({ select: { slaMinutes: true } })
  const cfg = (soc?.slaMinutes ?? {}) as Partial<Record<Urgency, number>>
  return cfg[urgency] ?? DEFAULT_SLA[urgency]
}

const STOP = new Set('the a an is are was were in on at of to for and or my our not no it this that with from have has been there please sir madam since very'.split(' '))
export function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !STOP.has(t)),
  )
}
/** Jaccard overlap of word sets. Embeddings would do better, this needs no external call. */
export function similarity(a: string, b: string): number {
  const A = tokenize(a), B = tokenize(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

async function nextCode(tx: Tx): Promise<string> {
  const r = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('complaint_code_seq') AS n`
  return `C-${r[0].n}`
}

/** Least loaded staff member whose skills cover the category. Ties go to the one who has waited longest (lowest id order). */
async function pickAssignee(tx: Tx, category: Category, escalated: boolean) {
  if (escalated) {
    const duty = await tx.staffMember.findFirst({ where: { isDutyManager: true }, orderBy: { openLoad: 'asc' } })
    if (duty) return duty
  }
  const skilled = await tx.staffMember.findMany({ where: { skills: { has: category }, isDutyManager: false }, orderBy: [{ openLoad: 'asc' }, { id: 'asc' }], take: 1 })
  return skilled[0] ?? (await tx.staffMember.findFirst({ where: { isDutyManager: false }, orderBy: [{ openLoad: 'asc' }, { id: 'asc' }] })) ?? null
}

async function findDuplicateParent(tx: Tx, c: { towerNo: number; category: Category; text: string; now: Date; excludeCode?: string }) {
  const since = new Date(c.now.getTime() - DUPLICATE_WINDOW_MS)
  const children = (await tx.complaintLink.findMany({ select: { childId: true } })).map((l) => l.childId)
  const open = await tx.complaint.findMany({
    where: {
      towerNo: c.towerNo, category: c.category, createdAt: { gte: since }, status: { not: 'RESOLVED' }, escalated: false,
      id: { notIn: children }, ...(c.excludeCode ? { code: { not: c.excludeCode } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
  let best: { c: Complaint; score: number } | null = null
  for (const o of open) {
    const score = similarity(o.text, c.text)
    if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { c: o, score }
  }
  return best?.c ?? null
}

export interface CreateInput {
  flatId: string
  text: string
  category?: Category
  photo?: Buffer
}

export async function createComplaint(user: AuthUser, input: CreateInput, now = new Date()) {
  const flat = await prisma.flat.findUnique({ where: { id: input.flatId }, include: { members: { include: { user: { select: { name: true } } } } } })
  if (!flat) throw notFound('Flat not found')
  const knownNames = flat.members.map((m) => m.user.name)
  const ai: Classification = await classifyComplaint({ text: input.text, userId: user.id, knownNames }, clients())

  let photoKey: string | null = null
  if (input.photo) {
    const t = requireImage(input.photo)
    photoKey = await storage.put('complaints', input.photo, t.ext)
  }
  const category = input.category ?? ai.category
  const sla = await slaFor(prisma, ai.urgency)

  try {
    return await prisma.$transaction(async (tx) => {
      const staff = await pickAssignee(tx, category, ai.escalated)
      const parent = ai.escalated ? null : await findDuplicateParent(tx, { towerNo: flat.towerNo, category, text: input.text, now })
      const code = await nextCode(tx)
      const c = await tx.complaint.create({
        data: {
          code, flatId: flat.id, towerNo: flat.towerNo, authorId: user.id, text: input.text, photoPath: photoKey,
          category, urgency: ai.urgency, aiCategory: ai.category, aiUrgency: ai.urgency, aiReason: ai.reason, aiSource: ai.source,
          needsReview: ai.needsReview, assigneeId: staff?.id ?? null, status: staff ? 'ASSIGNED' : 'NEW',
          responseDueAt: new Date(now.getTime() + sla * 60_000), escalated: ai.escalated, escalatedReason: ai.escalatedReason,
        },
      })
      await tx.complaintUpdate.create({ data: { complaintId: c.id, authorId: user.id, authorName: user.name, kind: 'status', text: 'raised' } })
      if (staff) {
        await tx.staffMember.update({ where: { id: staff.id }, data: { openLoad: { increment: 1 } } })
        await tx.complaintUpdate.create({ data: { complaintId: c.id, authorId: 'system', authorName: 'System', kind: 'status', text: 'assigned' } })
      }
      if (parent) await tx.complaintLink.create({ data: { parentId: parent.id, childId: c.id } })
      if (ai.escalated) {
        await writeAudit(tx, systemActor, {
          action: 'complaint.escalate', entity: 'Complaint', entityId: c.code,
          after: { urgency: 'CRITICAL', assignee: staff?.name, reason: ai.escalatedReason },
          detail: 'Safety rule matched. Duty manager assigned.',
        })
      }
      return { code: c.code, classification: ai }
    })
  } catch (e) {
    if (photoKey) await storage.delete(photoKey)
    throw e
  }
}

export async function classifyOnly(user: AuthUser, text: string) {
  const r = await classifyComplaint({ text, userId: user.id }, clients())
  return { category: r.category, urgency: r.urgency, reason: r.reason, escalated: r.escalated, needsReview: r.needsReview, source: r.source }
}

// ---- reads ------------------------------------------------------------------------------------

type Full = Prisma.ComplaintGetPayload<{ include: { updates: { orderBy: { createdAt: 'asc' } } } }>

async function view(c: Full, extra: { author?: string; assignee?: string | null; parentCode?: string | null; linked: number }, user: AuthUser) {
  const staffView = isOps(user)
  return {
    id: c.code, flatId: c.flatId, residentName: extra.author ?? 'Resident', text: c.text, category: c.category, urgency: c.urgency,
    status: c.status, createdAt: c.createdAt.toISOString(), dueAt: c.responseDueAt.toISOString(),
    overdue: !!c.overdueAt, assignee: c.assigneeId ? { id: c.assigneeId, name: extra.assignee ?? '' } : null,
    photoUrl: c.photoPath ? `/api/v1/files/complaints/${c.code}?t=${signFileToken(`complaint:${c.code}`)}` : null,
    clusterId: extra.parentCode ?? null, linkedCount: extra.linked, escalated: c.escalated, escalatedReason: c.escalatedReason,
    ai: { category: c.aiCategory, urgency: c.aiUrgency, reason: c.aiReason, source: c.aiSource, needsReview: c.needsReview },
    rating: c.rating, reopened: c.reopenedCount, resolvedAt: c.resolvedAt?.toISOString() ?? null,
    comments: c.updates.filter((u) => u.kind === 'comment').map((u) => ({ id: u.id, by: u.authorName, staff: u.staff, text: u.text, at: u.createdAt.toISOString() })),
    timeline: c.updates.filter((u) => u.kind === 'status').map((u) => ({ step: u.text, at: u.createdAt.toISOString() })),
    ...(staffView ? { firstResponseAt: c.firstResponseAt?.toISOString() ?? null } : {}),
  }
}

async function hydrate(rows: Full[], user: AuthUser) {
  const ids = rows.map((r) => r.id)
  const [authors, staff, links, counts] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true } }),
    prisma.staffMember.findMany({ select: { id: true, name: true } }),
    prisma.complaintLink.findMany({ where: { childId: { in: ids } } }),
    prisma.complaintLink.groupBy({ by: ['parentId'], where: { parentId: { in: ids } }, _count: true }),
  ])
  const parents = await prisma.complaint.findMany({ where: { id: { in: links.map((l) => l.parentId) } }, select: { id: true, code: true } })
  const A = new Map(authors.map((a) => [a.id, a.name])), S = new Map(staff.map((s) => [s.id, s.name]))
  const P = new Map(parents.map((p) => [p.id, p.code])), L = new Map(links.map((l) => [l.childId, l.parentId])), N = new Map(counts.map((c) => [c.parentId, c._count]))
  return Promise.all(rows.map((r) => view(r, { author: A.get(r.authorId), assignee: r.assigneeId ? S.get(r.assigneeId) : null, parentCode: L.has(r.id) ? P.get(L.get(r.id)!) : null, linked: N.get(r.id) ?? 0 }, user)))
}

const INCLUDE = { updates: { orderBy: { createdAt: 'asc' as const } } }

export function scopeWhere(user: AuthUser): Prisma.ComplaintWhereInput {
  if (isOps(user)) return {}
  if (user.role === 'RESIDENT') return { flatId: { in: user.flatIds } }
  return { id: { in: [] } }
}

export async function listComplaints(user: AuthUser, q: { flatId?: string; status?: string; category?: Category; urgency?: Urgency; tower?: number; assigneeId?: string; escalated?: string; search?: string; includeLinked: string; skip: number; take: number }) {
  const where: Prisma.ComplaintWhereInput = {
    AND: [
      scopeWhere(user),
      q.flatId ? { flatId: q.flatId } : {},
      q.status === 'OPEN' ? { status: { not: 'RESOLVED' } } : q.status ? { status: q.status as ComplaintStatus } : {},
      q.category ? { category: q.category } : {},
      q.urgency ? { urgency: q.urgency } : {},
      q.tower ? { towerNo: q.tower } : {},
      q.assigneeId ? { assigneeId: q.assigneeId } : {},
      q.escalated ? { escalated: q.escalated === 'true' } : {},
      q.search ? { OR: [{ text: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { flatId: { contains: q.search, mode: 'insensitive' } }] } : {},
      q.includeLinked === 'true' ? {} : { NOT: { id: { in: (await prisma.complaintLink.findMany({ select: { childId: true } })).map((l) => l.childId) } } },
    ],
  }
  const [rows, total] = await Promise.all([
    prisma.complaint.findMany({ where, include: INCLUDE, orderBy: [{ escalated: 'desc' }, { createdAt: 'desc' }], skip: q.skip, take: q.take }),
    prisma.complaint.count({ where }),
  ])
  return { total, items: await hydrate(rows, user) }
}

async function load(user: AuthUser, code: string): Promise<Full> {
  const c = await prisma.complaint.findFirst({ where: { AND: [{ code }, scopeWhere(user)] }, include: INCLUDE })
  if (!c) throw notFound('Complaint not found') // also what a resident gets for someone else's complaint
  return c
}

export async function getComplaint(user: AuthUser, code: string) {
  const c = await load(user, code)
  const [v] = await hydrate([c], user)
  const kids = await prisma.complaintLink.findMany({ where: { parentId: c.id } })
  const linked = kids.length ? await prisma.complaint.findMany({ where: { id: { in: kids.map((k) => k.childId) } }, select: { code: true, flatId: true, createdAt: true }, orderBy: { createdAt: 'asc' } }) : []
  return { ...v, linked: isOps(user) ? linked.map((l) => ({ id: l.code, flatId: l.flatId, createdAt: l.createdAt.toISOString() })) : undefined }
}

export async function photoFor(code: string) {
  const c = await prisma.complaint.findUnique({ where: { code }, select: { photoPath: true } })
  if (!c?.photoPath) throw notFound('No photo')
  const buf = await storage.get(c.photoPath)
  if (!buf) throw notFound('No photo')
  return { buf, mime: requireImage(buf).mime }
}

// ---- writes -----------------------------------------------------------------------------------

export async function addComment(user: AuthUser, code: string, text: string) {
  const c = await load(user, code)
  const staff = isOps(user)
  await prisma.$transaction(async (tx) => {
    await tx.complaintUpdate.create({ data: { complaintId: c.id, authorId: user.id, authorName: user.name, staff, kind: 'comment', text } })
    if (staff && !c.firstResponseAt) await tx.complaint.update({ where: { id: c.id }, data: { firstResponseAt: new Date() } })
  })
  return getComplaint(user, code)
}

export async function assign(user: AuthUser, actor: Actor, code: string, assigneeId: string) {
  const c = await load(user, code)
  const to = await prisma.staffMember.findUnique({ where: { id: assigneeId } })
  if (!to) throw notFound('Staff member not found')
  await prisma.$transaction(async (tx) => {
    if (c.assigneeId && c.assigneeId !== to.id && c.status !== 'RESOLVED') await tx.staffMember.update({ where: { id: c.assigneeId }, data: { openLoad: { decrement: 1 } } })
    if (c.assigneeId !== to.id && c.status !== 'RESOLVED') await tx.staffMember.update({ where: { id: to.id }, data: { openLoad: { increment: 1 } } })
    await tx.complaint.update({
      where: { id: c.id },
      data: { assigneeId: to.id, status: c.status === 'NEW' || c.status === 'REOPENED' ? 'ASSIGNED' : c.status, firstResponseAt: c.firstResponseAt ?? new Date() },
    })
    await tx.complaintUpdate.create({ data: { complaintId: c.id, authorId: user.id, authorName: user.name, staff: true, kind: 'status', text: 'assigned' } })
    await writeAudit(tx, actor, { action: 'complaint.assign', entity: 'Complaint', entityId: code, before: { assigneeId: c.assigneeId }, after: { assigneeId: to.id }, detail: `Assigned to ${to.name}` })
  })
  return getComplaint(user, code)
}

/**
 * Category and urgency changes. Residents may only change the category of their own new complaint.
 * Safety escalations are locked: nobody can lower the urgency or clear the flag, and the attempt is logged.
 */
export async function patch(user: AuthUser, actor: Actor, code: string, b: { category?: Category; urgency?: Urgency; escalated?: boolean }) {
  const c = await load(user, code)
  const ops = isOps(user)
  if (!ops) {
    if (b.urgency !== undefined || b.escalated !== undefined) throw forbidden('Only the help desk can change urgency')
    if (c.status !== 'NEW' && c.status !== 'ASSIGNED') throw conflict('This complaint is already being handled. Ask the help desk to change the category.')
  }
  if (c.escalated && ((b.escalated === false) || (b.urgency !== undefined && b.urgency !== 'CRITICAL'))) {
    await writeAudit(prisma, actor, { action: 'complaint.escalation_removal_blocked', entity: 'Complaint', entityId: code, before: { urgency: c.urgency, escalated: true }, after: b, detail: c.escalatedReason ?? 'Safety escalation' })
    throw conflict('Safety escalations cannot be removed or lowered')
  }
  const data: Prisma.ComplaintUpdateInput = {}
  if (b.category && b.category !== c.category) data.category = b.category
  if (b.urgency && b.urgency !== c.urgency) {
    data.urgency = b.urgency
    data.responseDueAt = new Date(c.createdAt.getTime() + (await slaFor(prisma, b.urgency)) * 60_000)
  }
  if (b.escalated === true && !c.escalated) { data.escalated = true; data.urgency = 'CRITICAL'; data.escalatedReason = 'Raised manually by the help desk' }
  if (!Object.keys(data).length) return getComplaint(user, code)
  await prisma.$transaction(async (tx) => {
    await tx.complaint.update({ where: { id: c.id }, data })
    await tx.complaintUpdate.create({ data: { complaintId: c.id, authorId: user.id, authorName: user.name, staff: ops, kind: 'category', text: `Category ${c.category} -> ${b.category ?? c.category}` } })
    await writeAudit(tx, actor, { action: b.category ? 'complaint.category_change' : 'complaint.update', entity: 'Complaint', entityId: code, before: { category: c.category, urgency: c.urgency, ai: c.aiCategory }, after: b })
  })
  return getComplaint(user, code)
}

export async function setStatus(user: AuthUser, actor: Actor, code: string, status: 'IN_PROGRESS' | 'RESOLVED', note?: string) {
  const c = await load(user, code)
  if (c.status === 'RESOLVED') throw conflict('Already resolved')
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id: c.id },
      data: { status, firstResponseAt: c.firstResponseAt ?? now, ...(status === 'RESOLVED' ? { resolvedAt: now } : {}) },
    })
    if (status === 'RESOLVED' && c.assigneeId) await tx.staffMember.update({ where: { id: c.assigneeId }, data: { openLoad: { decrement: 1 } } })
    await tx.complaintUpdate.create({ data: { complaintId: c.id, authorId: user.id, authorName: user.name, staff: true, kind: 'status', text: status === 'RESOLVED' ? 'resolved' : 'in_progress' } })
    if (note) await tx.complaintUpdate.create({ data: { complaintId: c.id, authorId: user.id, authorName: user.name, staff: true, kind: 'comment', text: note } })
    await writeAudit(tx, actor, { action: 'complaint.status', entity: 'Complaint', entityId: code, before: { status: c.status }, after: { status } })
  })
  return getComplaint(user, code)
}

export async function reopen(user: AuthUser, actor: Actor, code: string, now = new Date()) {
  const c = await load(user, code)
  if (c.status !== 'RESOLVED') throw conflict('Only a resolved complaint can be reopened')
  const sla = await slaFor(prisma, c.urgency)
  await prisma.$transaction(async (tx) => {
    await tx.complaint.update({
      where: { id: c.id },
      data: { status: 'REOPENED', reopenedCount: { increment: 1 }, resolvedAt: null, rating: null, overdueAt: null, responseDueAt: new Date(now.getTime() + sla * 60_000) },
    })
    if (c.assigneeId) await tx.staffMember.update({ where: { id: c.assigneeId }, data: { openLoad: { increment: 1 } } })
    await tx.complaintUpdate.create({ data: { complaintId: c.id, authorId: user.id, authorName: user.name, staff: isOps(user), kind: 'status', text: 'reopened' } })
    await writeAudit(tx, actor, { action: 'complaint.reopen', entity: 'Complaint', entityId: code })
  })
  return getComplaint(user, code)
}

export async function rate(user: AuthUser, code: string, rating: number) {
  const c = await load(user, code)
  if (user.role !== 'RESIDENT') throw forbidden('Only the resident rates a resolution')
  if (c.status !== 'RESOLVED') throw conflict('You can rate once it is resolved')
  await prisma.complaint.update({ where: { id: c.id }, data: { rating } })
  return getComplaint(user, code)
}

export async function link(user: AuthUser, actor: Actor, code: string, parentCode: string) {
  if (code === parentCode) throw badRequest('A complaint cannot be linked to itself')
  const [child, parent] = await Promise.all([load(user, code), load(user, parentCode)])
  const parentIsChild = await prisma.complaintLink.findUnique({ where: { childId: parent.id } })
  if (parentIsChild) throw conflict('That complaint is itself linked under another one')
  const hasKids = await prisma.complaintLink.count({ where: { parentId: child.id } })
  if (hasKids) throw conflict('This complaint already has duplicates linked under it')
  await prisma.$transaction(async (tx) => {
    await tx.complaintLink.upsert({ where: { childId: child.id }, update: { parentId: parent.id }, create: { parentId: parent.id, childId: child.id } })
    await writeAudit(tx, actor, { action: 'complaint.link', entity: 'Complaint', entityId: code, after: { parent: parentCode }, detail: 'Linked as duplicate. Nothing was closed.' })
  })
  return getComplaint(user, code)
}

export async function unlink(user: AuthUser, actor: Actor, code: string) {
  const c = await load(user, code)
  const l = await prisma.complaintLink.findUnique({ where: { childId: c.id } })
  if (!l) throw conflict('Not linked')
  await prisma.$transaction(async (tx) => {
    await tx.complaintLink.delete({ where: { childId: c.id } })
    await writeAudit(tx, actor, { action: 'complaint.unlink', entity: 'Complaint', entityId: code })
  })
  return getComplaint(user, code)
}

export async function listStaff() {
  const rows = await prisma.staffMember.findMany({ orderBy: { name: 'asc' } })
  return rows.map((s) => ({ id: s.id, name: s.name, skills: s.skills, isDutyManager: s.isDutyManager, openLoad: s.openLoad }))
}

/** Job: a complaint with no first response after its due time is marked overdue once, for the metrics. */
export async function markOverdue(now = new Date()) {
  const r = await prisma.complaint.updateMany({
    where: { responseDueAt: { lt: now }, firstResponseAt: null, overdueAt: null, status: { not: 'RESOLVED' } },
    data: { overdueAt: now },
  })
  return { marked: r.count }
}
