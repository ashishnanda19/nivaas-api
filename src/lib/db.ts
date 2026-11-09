import { PrismaClient, Prisma } from '@prisma/client'
import { logger } from './logger.js'

/**
 * Pooled hosts (Supabase, Neon) close idle connections without telling the client, and the next query then hangs until a
 * timeout. Two defences: explicit connect and pool timeouts so a dead connection fails fast, and one retry of a read or write
 * that failed with a connection-class error (the query never reached the database, so repeating it is safe).
 */
const CONNECTION_ERRORS = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])

export function withTimeouts(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const u = new URL(url)
    if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '10')
    if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '10')
    return u.toString()
  } catch {
    return url
  }
}

export const isConnectionError = (e: unknown) =>
  (e instanceof Prisma.PrismaClientKnownRequestError && CONNECTION_ERRORS.has(e.code)) ||
  (e instanceof Prisma.PrismaClientInitializationError)

const base = new PrismaClient({ datasourceUrl: withTimeouts(process.env.DATABASE_URL) })

export const prisma = base.$extends({
  query: {
    async $allOperations({ args, query }) {
      try {
        return await query(args)
      } catch (e) {
        if (!isConnectionError(e)) throw e
        logger.warn({ code: (e as { code?: string }).code }, 'database connection error, retrying once')
        return query(args)
      }
    },
  },
}) as unknown as PrismaClient

export type Tx = Prisma.TransactionClient
export type Db = PrismaClient | Prisma.TransactionClient

/** Keeps a pooled connection warm while the process is awake. Safe to ignore a failure: the next real query retries. */
export function startDbKeepWarm(everyMs = 4 * 60_000) {
  const t = setInterval(() => { base.$queryRaw`SELECT 1`.catch(() => undefined) }, everyMs)
  t.unref()
  return () => clearInterval(t)
}
