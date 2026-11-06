import { prisma } from '../../lib/db.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js'
import { maskPhone } from '../../lib/phone.js'
import { currentBill } from '../billing/service.js'
import { flatDues } from '../billing/ledger.js'
import { writeAudit, type Actor } from '../audit/service.js'
import type { AuthUser } from '../../lib/auth.js'
import { isOps } from '../../lib/auth.js'
import type { MemberRelation } from '@prisma/client'
import { daysBetween } from '../../lib/money.js'

export async function listFlats(q: { search?: string; tower?: number; skip: number; take: number }) {
  const where = {
    ...(q.tower ? { towerNo: q.tower } : {}),
    ...(q.search
      ? { OR: [{ id: { contains: q.search, mode: 'insensitive' as const } }, { members: { some: { user: { name: { contains: q.search, mode: 'insensitive' as const } } } } }] }
      : {}),
  }
  const [flats, total] = await Promise.all([
    prisma.flat.findMany({
      where, orderBy: [{ towerNo: 'asc' }, { number: 'asc' }], skip: q.skip, take: q.take,
      include: { members: { where: { active: true }, include: { user: { select: { name: true } } } }, knownPayers: { select: { upiId: true } } },
    }),
    prisma.flat.count({ where }),
  ])
  const ids = flats.map((f) => f.id)
  const sums = await prisma.ledgerEntry.groupBy({ by: ['flatId'], where: { flatId: { in: ids } }, _sum: { amountPaise: true } })
  const bal = new Map(sums.map((s) => [s.flatId, s._sum.amountPaise ?? 0]))
  const oldest = await prisma.bill.findMany({ where: { flatId: { in: ids }, status: { not: 'PAID' } }, orderBy: { dueDate: 'asc' }, distinct: ['flatId'] })
  const now = new Date()
  const od = new Map(oldest.map((b) => [b.flatId, Math.max(0, daysBetween(b.dueDate, now))]))
  return {
    total,
    items: flats.map((f) => {
      const primary = f.members.find((m) => m.relation !== 'FAMILY') ?? f.members[0]
      return {
        id: f.id, towerNo: f.towerNo, areaSqft: f.areaSqft,
        residentName: primary?.user.name ?? 'Unassigned', tenant: primary?.relation === 'TENANT',
        balancePaise: bal.get(f.id) ?? 0, daysOverdue: od.get(f.id) ?? 0,
        upiIds: f.knownPayers.map((k) => k.upiId).filter(Boolean) as string[],
      }
    }),
  }
}

export async function flatSummary(flatId: string) {
  const flat = await prisma.flat.findUnique({ where: { id: flatId } })
  if (!flat) throw notFound('Flat not found')
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0)
  const [bill, dues, openComplaints, visitorsToday, waiting] = await Promise.all([
    currentBill(flatId),
    flatDues(prisma, flatId),
    prisma.complaint.count({ where: { flatId, status: { not: 'RESOLVED' } } }),
    prisma.visitor.count({ where: { flatId, createdAt: { gte: startOfDay } } }),
    prisma.visitor.count({ where: { flatId, status: 'WAITING' } }),
  ])
  return {
    flat: { id: flat.id, towerNo: flat.towerNo, areaSqft: flat.areaSqft },
    balancePaise: dues.balancePaise, advancePaise: dues.advancePaise, bill, openComplaints, visitorsToday, waitingVisitors: waiting,
  }
}

export async function listMembers(flatId: string, viewer: AuthUser, actor: Actor, reveal: boolean) {
  const rows = await prisma.flatMember.findMany({ where: { flatId, active: true }, include: { user: true }, orderBy: { id: 'asc' } })
  const own = viewer.flatIds.includes(flatId)
  if (isOps(viewer) && reveal) {
    await writeAudit(prisma, actor, { action: 'pii.view', entity: 'Flat', entityId: flatId, detail: 'Viewed member phone numbers' })
  }
  return rows.map((m) => ({
    id: m.id, flatId, name: m.user.name, relation: m.relation,
    phone: own || (isOps(viewer) && reveal) ? m.user.phone : maskPhone(m.user.phone),
  }))
}

async function canManage(viewer: AuthUser, flatId: string) {
  if (isOps(viewer)) return
  const m = await prisma.flatMember.findFirst({ where: { flatId, userId: viewer.id, active: true } })
  if (!m || m.relation === 'FAMILY') throw forbidden('Only the owner or tenant can manage members')
}

export async function addMember(flatId: string, viewer: AuthUser, actor: Actor, b: { name: string; phone: string; relation: MemberRelation }) {
  await canManage(viewer, flatId)
  if (!(await prisma.flat.findUnique({ where: { id: flatId } }))) throw notFound('Flat not found')
  if (b.relation === 'OWNER' && !isOps(viewer)) throw forbidden('Only the help desk can add an owner')
  const user = await prisma.user.upsert({ where: { phone: b.phone }, update: {}, create: { phone: b.phone, name: b.name, role: 'RESIDENT' } })
  if (user.role !== 'RESIDENT') throw conflict('This number belongs to a staff account')
  const existing = await prisma.flatMember.findUnique({ where: { userId_flatId: { userId: user.id, flatId } } })
  if (existing?.active) throw conflict('Already a member of this flat')
  const m = existing
    ? await prisma.flatMember.update({ where: { id: existing.id }, data: { active: true, relation: b.relation } })
    : await prisma.flatMember.create({ data: { userId: user.id, flatId, relation: b.relation } })
  await writeAudit(prisma, actor, { action: 'member.add', entity: 'Flat', entityId: flatId, after: { memberId: m.id, relation: b.relation } })
  return { id: m.id, flatId, name: user.name, relation: m.relation, phone: user.phone }
}

export async function removeMember(flatId: string, memberId: string, viewer: AuthUser, actor: Actor) {
  await canManage(viewer, flatId)
  const m = await prisma.flatMember.findFirst({ where: { id: memberId, flatId, active: true } })
  if (!m) throw notFound('Member not found')
  if (m.userId === viewer.id) throw badRequest('You cannot remove yourself')
  await prisma.flatMember.update({ where: { id: m.id }, data: { active: false } })
  await writeAudit(prisma, actor, { action: 'member.remove', entity: 'Flat', entityId: flatId, before: { memberId: m.id } })
  return { ok: true }
}
