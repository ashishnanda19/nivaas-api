import crypto from 'node:crypto'
import type { Prisma, Visitor, VisitorStatus } from '@prisma/client'
import { prisma } from '../../lib/db.js'
import { config } from '../../lib/config.js'
import { AppError, badRequest, conflict, forbidden, notFound, tooMany } from '../../lib/errors.js'
import { isOps, signFileToken, type AuthUser } from '../../lib/auth.js'
import { maskPhone } from '../../lib/phone.js'
import { requireImage, storage } from '../../lib/storage.js'
import { writeAudit, systemActor, type Actor } from '../audit/service.js'
import { PHOTO_DAYS } from './schema.js'

const DAY = 86400000
export const MAX_OFFLINE_AGE_MS = 7 * DAY
const IST_OFFSET_MS = 5.5 * 3600 * 1000

export interface EntryInput {
  clientId?: string
  gateId: string
  flatId: string
  name: string
  phone: string
  purpose: string
  photo?: string
  createdAt?: Date
}

function decodePhoto(dataUrl: string): Buffer {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
  if (buf.length > 1_800_000) throw badRequest('Photo is too large')
  return buf
}

export const view = (v: Visitor, viewer: AuthUser, reveal = false) => {
  const own = viewer.flatIds.includes(v.flatId)
  return {
    id: v.id, clientId: v.clientId, gateId: v.gateId, flatId: v.flatId, name: v.name, purpose: v.purpose,
    phone: own || (isOps(viewer) && reveal) ? v.phone : maskPhone(v.phone),
    photoUrl: v.photoPath ? `/api/v1/files/visitors/${v.id}?t=${signFileToken(`visitor:${v.id}`)}` : null,
    status: v.status, source: v.source, createdOffline: v.createdOffline, createdAt: v.createdAt.toISOString(),
    decidedAt: v.decidedAt?.toISOString() ?? null,
  }
}

/** Create one entry. Idempotent on clientId: the same offline entry sent twice is stored once. */
export async function createEntry(guard: AuthUser, e: EntryInput, opts: { offline?: boolean; now?: Date } = {}): Promise<{ visitor: Visitor; created: boolean }> {
  const now = opts.now ?? new Date()
  if (e.clientId) {
    const existing = await prisma.visitor.findUnique({ where: { clientId: e.clientId } })
    if (existing) return { visitor: existing, created: false }
  }
  const [flat, gate] = await Promise.all([prisma.flat.findUnique({ where: { id: e.flatId } }), prisma.gate.findUnique({ where: { id: e.gateId } })])
  if (!flat) throw notFound(`Flat ${e.flatId} not found`)
  if (!gate) throw notFound(`Gate ${e.gateId} not found`)

  let createdAt = now
  if (e.createdAt) {
    const age = now.getTime() - e.createdAt.getTime()
    if (age < -5 * 60_000) throw badRequest('Entry time is in the future. Check the tablet clock.')
    if (age > MAX_OFFLINE_AGE_MS) throw badRequest('Entry is older than 7 days and was not accepted')
    createdAt = e.createdAt
  }
  let photoPath: string | null = null
  if (e.photo) {
    const buf = decodePhoto(e.photo)
    photoPath = await storage.put('visitors', buf, requireImage(buf).ext)
  }
  try {
    const visitor = await prisma.visitor.create({
      data: {
        clientId: e.clientId, gateId: e.gateId, flatId: e.flatId, name: e.name, phone: e.phone, purpose: e.purpose,
        photoPath, photoDeleteAfter: photoPath ? new Date(createdAt.getTime() + PHOTO_DAYS * DAY) : null,
        createdOffline: !!opts.offline, createdBy: guard.id, createdAt,
      },
    })
    return { visitor, created: true }
  } catch (err) {
    if (photoPath) await storage.delete(photoPath)
    // A concurrent request with the same clientId won the race.
    if (e.clientId && (err as { code?: string }).code === 'P2002') {
      const winner = await prisma.visitor.findUnique({ where: { clientId: e.clientId } })
      if (winner) return { visitor: winner, created: false }
    }
    throw err
  }
}

export async function syncEntries(guard: AuthUser, entries: EntryInput[]) {
  const results: { clientId: string | null; id?: string; result: 'created' | 'duplicate' | 'error'; error?: string }[] = []
  for (const e of entries) {
    if (!e.clientId) { results.push({ clientId: null, result: 'error', error: 'clientId is required for sync' }); continue }
    try {
      const r = await createEntry(guard, e, { offline: true })
      results.push({ clientId: e.clientId, id: r.visitor.id, result: r.created ? 'created' : 'duplicate' })
    } catch (err) {
      results.push({ clientId: e.clientId, result: 'error', error: (err as Error).message })
    }
  }
  return { results, created: results.filter((r) => r.result === 'created').length, duplicates: results.filter((r) => r.result === 'duplicate').length, errors: results.filter((r) => r.result === 'error').length }
}

function scope(user: AuthUser): Prisma.VisitorWhereInput {
  if (isOps(user)) return {}
  if (user.role === 'RESIDENT') return { flatId: { in: user.flatIds } }
  if (user.role === 'GUARD') return { createdAt: { gte: new Date(Date.now() - DAY) } } // the gate log: last 24 hours only
  return { id: { in: [] } }
}

export async function listVisitors(user: AuthUser, actor: Actor, q: { flatId?: string; gateId?: string; status?: VisitorStatus; from?: Date; to?: Date; reveal?: string; skip: number; take: number }) {
  const where: Prisma.VisitorWhereInput = {
    AND: [
      scope(user),
      q.flatId ? { flatId: q.flatId } : {}, q.gateId ? { gateId: q.gateId } : {}, q.status ? { status: q.status } : {},
      q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {},
    ],
  }
  const reveal = q.reveal === 'true'
  const [rows, total] = await Promise.all([
    prisma.visitor.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take }),
    prisma.visitor.count({ where }),
  ])
  if (isOps(user) && reveal && rows.length) await writeAudit(prisma, actor, { action: 'pii.view', entity: 'Visitor', entityId: 'list', detail: `Viewed ${rows.length} visitor phone numbers` })
  return { total, items: rows.map((v) => view(v, user, reveal)) }
}

async function loadScoped(user: AuthUser, id: string) {
  const v = await prisma.visitor.findFirst({ where: { AND: [{ id }, scope(user)] } })
  if (!v) throw notFound('Visitor not found')
  return v
}

export async function getVisitor(user: AuthUser, id: string) {
  return view(await loadScoped(user, id), user)
}

/** A resident of the flat approves or denies. Repeating the same answer is fine, flipping it is not. */
export async function decide(user: AuthUser, actor: Actor, id: string, decision: 'APPROVED' | 'DENIED') {
  if (user.role !== 'RESIDENT') throw forbidden('Only a resident of the flat can approve or deny a visitor')
  const v = await loadScoped(user, id)
  if (v.status === decision) return view(v, user)
  if (v.status !== 'WAITING') throw conflict(`This visitor is already ${v.status.toLowerCase().replace('_', ' ')}`)
  const upd = await prisma.visitor.updateMany({ where: { id, status: 'WAITING' }, data: { status: decision, decidedAt: new Date() } })
  if (upd.count === 0) throw conflict('This visitor was already answered')
  await writeAudit(prisma, actor, { action: 'visitor.decision', entity: 'Visitor', entityId: id, before: { status: 'WAITING' }, after: { status: decision } })
  return getVisitor(user, id)
}

const NEXT: Partial<Record<VisitorStatus, VisitorStatus>> = { APPROVED: 'CHECKED_IN', CHECKED_IN: 'CHECKED_OUT' }
export async function gateStatus(user: AuthUser, actor: Actor, id: string, status: 'CHECKED_IN' | 'CHECKED_OUT') {
  const v = await loadScoped(user, id)
  if (v.status === status) return view(v, user)
  if (NEXT[v.status] !== status) throw conflict(`A visitor who is ${v.status.toLowerCase().replace('_', ' ')} cannot be marked ${status.toLowerCase().replace('_', ' ')}`)
  const upd = await prisma.visitor.updateMany({ where: { id, status: v.status }, data: { status } })
  if (upd.count === 0) throw conflict('Visitor status changed, refresh and try again')
  await writeAudit(prisma, actor, { action: 'visitor.gate_status', entity: 'Visitor', entityId: id, before: { status: v.status }, after: { status } })
  return getVisitor(user, id)
}

export async function photoFor(id: string) {
  const v = await prisma.visitor.findUnique({ where: { id }, select: { photoPath: true } })
  if (!v?.photoPath) throw notFound('No photo')
  const buf = await storage.get(v.photoPath)
  if (!buf) throw notFound('No photo')
  return { buf, mime: requireImage(buf).mime }
}

// ---- pre-approvals ----------------------------------------------------------------------------

export const hashCode = (code: string) => crypto.createHmac('sha256', config.JWT_SECRET).update(`preapproval:${code}`).digest('hex')
const istDay = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)

export async function createPreApproval(user: AuthUser, b: { flatId: string; guestName: string; date: Date }) {
  const today = istDay(new Date())
  if (istDay(b.date) < today) throw badRequest('The date cannot be in the past')
  for (let i = 0; i < 10; i++) {
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
    try {
      const p = await prisma.preApproval.create({ data: { flatId: b.flatId, guestName: b.guestName, date: new Date(`${istDay(b.date)}T00:00:00.000Z`), codeHash: hashCode(code), createdBy: user.id } })
      // The plain code exists only in this response. Only its hash is stored.
      return { id: p.id, flatId: p.flatId, guestName: p.guestName, date: istDay(p.date), code, used: false }
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e
    }
  }
  throw conflict('Could not generate a unique code, try again')
}

export async function listPreApprovals(flatId: string) {
  const rows = await prisma.preApproval.findMany({ where: { flatId }, orderBy: { date: 'desc' }, take: 50 })
  return rows.map((p) => ({ id: p.id, flatId: p.flatId, guestName: p.guestName, date: istDay(p.date), used: p.used }))
}

const attempts = new Map<string, number[]>()
export const VERIFY_LIMIT = 10
export const resetVerifyLimits = () => attempts.clear()

/** Guard types the code a guest shows. Valid only on the day, only once. A burst of wrong codes locks the guard out for a while. */
export async function verifyCode(guard: AuthUser, actor: Actor, code: string, gateId: string, now = new Date()) {
  const recent = (attempts.get(guard.id) ?? []).filter((t) => now.getTime() - t < 10 * 60_000)
  if (recent.length >= VERIFY_LIMIT) throw tooMany('Too many wrong codes. Wait a few minutes or call the help desk.')
  const gate = await prisma.gate.findUnique({ where: { id: gateId } })
  if (!gate) throw notFound('Gate not found')
  const p = await prisma.preApproval.findUnique({ where: { codeHash: hashCode(code) } })
  const valid = !!p && !p.used && istDay(p.date) === istDay(now)
  if (!valid) {
    recent.push(now.getTime())
    attempts.set(guard.id, recent)
    throw new AppError(404, 'CODE_INVALID', p?.used ? 'This code was already used' : p ? 'This code is for a different day' : 'Code not recognised')
  }
  const visitor = await prisma.$transaction(async (tx) => {
    const claim = await tx.preApproval.updateMany({ where: { id: p!.id, used: false }, data: { used: true } })
    if (claim.count === 0) throw conflict('This code was already used')
    const v = await tx.visitor.create({
      data: { gateId, flatId: p!.flatId, name: p!.guestName, phone: '0000000000', purpose: 'Pre-approved guest', status: 'APPROVED', source: 'code', decidedAt: now, createdBy: guard.id },
    })
    await writeAudit(tx, actor, { action: 'visitor.preapproval_used', entity: 'PreApproval', entityId: p!.id, after: { visitorId: v.id } })
    return v
  })
  return view(visitor, guard)
}

// ---- retention --------------------------------------------------------------------------------

/** DPDP: visitor photos are removed once their delete-after date has passed. The visit record stays, the photo goes. */
export async function purgeExpiredPhotos(now = new Date()) {
  const due = await prisma.visitor.findMany({ where: { photoPath: { not: null }, photoDeleteAfter: { lt: now } }, select: { id: true, photoPath: true } })
  for (const v of due) {
    await storage.delete(v.photoPath!)
    await prisma.visitor.update({ where: { id: v.id }, data: { photoPath: null } })
  }
  if (due.length) await writeAudit(prisma, systemActor, { action: 'retention.visitor_photos_deleted', entity: 'Visitor', entityId: 'batch', after: { count: due.length }, detail: `Deleted ${due.length} photos older than ${PHOTO_DAYS} days` })
  return { deleted: due.length }
}

export const listGates = () => prisma.gate.findMany({ orderBy: { id: 'asc' } })

/** "Neeraj Kulkarni" -> "Neeraj K." The gate needs to recognise a flat, not to learn full names. */
export const shortName = (full: string) => {
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]
}

export async function gateFlats(page: { skip: number; take: number }) {
  const [rows, total] = await Promise.all([
    prisma.flat.findMany({
      orderBy: [{ towerNo: 'asc' }, { number: 'asc' }], ...page,
      include: { members: { where: { active: true, relation: { in: ['OWNER', 'TENANT'] } }, include: { user: { select: { name: true } } }, take: 1 } },
    }),
    prisma.flat.count(),
  ])
  return { total, items: rows.map((f) => ({ id: f.id, towerNo: f.towerNo, residentName: f.members[0] ? shortName(f.members[0].user.name) : '' })) }
}
