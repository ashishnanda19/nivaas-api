import type { Db } from '../../lib/db.js'

export interface Actor {
  id: string | null
  name: string
  role: string
  ip?: string | null
}

export const systemActor: Actor = { id: null, name: 'System', role: 'SYSTEM' }

export interface AuditInput {
  action: string
  entity: string
  entityId: string
  before?: unknown
  after?: unknown
  detail?: string
}

export async function writeAudit(db: Db, actor: Actor, a: AuditInput) {
  return db.auditLog.create({
    data: {
      actorId: actor.id,
      actorName: actor.name,
      role: actor.role,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      before: (a.before ?? undefined) as never,
      after: (a.after ?? undefined) as never,
      detail: a.detail ?? '',
      ip: actor.ip ?? null,
    },
  })
}
