import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import type { Role } from '@prisma/client'
import { config } from './config.js'
import { prisma } from './db.js'
import { forbidden, unauthorized } from './errors.js'
import type { Actor } from '../modules/audit/service.js'

export interface AuthUser {
  id: string
  name: string
  role: Role
  consentAt: Date | null
  /** Flats the user is an active member of. Empty for staff. */
  flatIds: string[]
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
}

export const ACCESS_TTL_SEC = 15 * 60
export const REFRESH_TTL_SEC = 30 * 24 * 3600

export const signAccess = (userId: string) =>
  jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: ACCESS_TTL_SEC })

export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex')
export const newRefreshToken = () => crypto.randomBytes(48).toString('base64url')

export async function loadUser(req: FastifyRequest): Promise<AuthUser> {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) throw unauthorized()
  let sub: string
  try {
    const p = jwt.verify(h.slice(7), config.JWT_SECRET) as { sub: string }
    sub = p.sub
  } catch {
    throw unauthorized('Session expired')
  }
  const u = await prisma.user.findUnique({
    where: { id: sub },
    include: { members: { where: { active: true }, select: { flatId: true } } },
  })
  if (!u) throw unauthorized()
  return { id: u.id, name: u.name, role: u.role, consentAt: u.consentAt, flatIds: u.members.map((m) => m.flatId) }
}

export interface GuardOpts {
  roles?: Role[]
  /** Skip the consent check (only the consent endpoint itself and /me use this). */
  allowNoConsent?: boolean
}

/** Route guard factory. Deny by default: a route with no guard is a bug, so every route calls this. */
export function guard(opts: GuardOpts = {}) {
  return async (req: FastifyRequest) => {
    const user = await loadUser(req)
    if (!opts.allowNoConsent && !user.consentAt)
      throw forbidden('Consent to the privacy notice is required before using the app')
    if (opts.roles && !opts.roles.includes(user.role) && user.role !== 'ADMIN') throw forbidden()
    req.user = user
  }
}

export const STAFF: Role[] = ['HELPDESK', 'COMMITTEE', 'ADMIN']
export const OPS: Role[] = ['HELPDESK', 'ADMIN']

export const isStaff = (u: AuthUser) => u.role !== 'RESIDENT' && u.role !== 'GUARD'
export const isOps = (u: AuthUser) => u.role === 'HELPDESK' || u.role === 'ADMIN'

export function actorOf(req: FastifyRequest): Actor {
  const u = req.user!
  return { id: u.id, name: u.name, role: u.role, ip: req.ip }
}

/**
 * Query-level ownership scope. Residents are limited to their own flats; ops staff see all.
 * Returns a Prisma `where` fragment for models with a `flatId` column.
 */
export function flatScope(u: AuthUser): { flatId?: { in: string[] } } {
  if (isOps(u)) return {}
  if (u.role === 'RESIDENT') return { flatId: { in: u.flatIds } }
  return { flatId: { in: [] } } // committee and guard have no row-level flat access by default
}

export function assertFlatAccess(u: AuthUser, flatId: string) {
  if (isOps(u)) return
  if (u.role === 'RESIDENT' && u.flatIds.includes(flatId)) return
  throw forbidden()
}
