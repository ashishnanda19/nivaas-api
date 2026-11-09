import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { isConnectionError, withTimeouts } from '../src/lib/db.js'

describe('database client hardening', () => {
  it('adds connect and pool timeouts without overriding explicit ones', () => {
    const u = new URL(withTimeouts('postgresql://u:p@host:5432/db')!)
    expect(u.searchParams.get('connect_timeout')).toBe('10')
    expect(u.searchParams.get('pool_timeout')).toBe('10')
    const keep = new URL(withTimeouts('postgresql://u:p@host:5432/db?connect_timeout=3&pgbouncer=true')!)
    expect(keep.searchParams.get('connect_timeout')).toBe('3')
    expect(keep.searchParams.get('pgbouncer')).toBe('true')
  })

  it('leaves an empty or unparseable url alone', () => {
    expect(withTimeouts(undefined)).toBeUndefined()
    expect(withTimeouts('not a url')).toBe('not a url')
  })

  it('retries only connection-class errors, never constraint or validation errors', () => {
    const known = (code: string) => new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test' })
    for (const c of ['P1001', 'P1002', 'P1008', 'P1017', 'P2024']) expect(isConnectionError(known(c)), c).toBe(true)
    for (const c of ['P2002', 'P2025', 'P2003']) expect(isConnectionError(known(c)), c).toBe(false)
    expect(isConnectionError(new Error('boom'))).toBe(false)
  })
})
