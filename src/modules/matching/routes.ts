import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, guard, OPS } from '../../lib/auth.js'
import { badRequest } from '../../lib/errors.js'
import { pageArgs, pageQuery } from '../../lib/pagination.js'
import { parse } from '../../lib/validate.js'
import { MAX_STATEMENT_BYTES } from './csv.js'
import * as svc from './service.js'

export const postRowBody = z.object({ flatId: z.string().min(3).max(12).optional(), allowDuplicate: z.boolean().optional() }).strict()
export const rejectBody = z.object({ reason: z.string().min(3).max(200) }).strict()

export async function matchingRoutes(app: FastifyInstance) {
  const ops = { preHandler: guard({ roles: OPS }) }

  app.post('/matching/uploads', { ...ops, bodyLimit: 2_000_000, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const file = await req.file({ limits: { fileSize: MAX_STATEMENT_BYTES } })
    if (!file) throw badRequest('Attach a CSV file')
    const name = (file.filename ?? 'statement.csv').replace(/[^\w.\- ]+/g, '_')
    if (!/\.csv$/i.test(name) || !['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/octet-stream'].includes(file.mimetype))
      throw badRequest('Only .csv files are accepted')
    const buf = await file.toBuffer()
    if (file.file.truncated) throw badRequest('File is too large (limit 1 MB)')
    if (buf.includes(0)) throw badRequest('This does not look like a text CSV file')
    return svc.uploadStatement(name, buf.toString('utf8'), actorOf(req))
  })

  app.get('/matching/uploads', ops, async (req) => {
    const q = parse(pageQuery, req.query)
    const r = await svc.listUploads(pageArgs(q))
    return { items: r.items, page: q.page, pageSize: q.pageSize, total: r.total }
  })

  app.get('/matching/uploads/:id', ops, async (req) => {
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(100) }), req.query)
    return svc.getUpload((req.params as { id: string }).id, pageArgs(q))
  })

  app.get('/matching/queue', ops, async (req) => {
    const q = parse(pageQuery, req.query)
    const r = await svc.accountsQueue(pageArgs(q))
    return { items: r.items, page: q.page, pageSize: q.pageSize, total: r.total }
  })

  app.post('/matching/rows/:id/post', ops, async (req) => {
    const b = parse(postRowBody, req.body ?? {})
    return svc.postRow((req.params as { id: string }).id, b, actorOf(req))
  })

  app.post('/matching/rows/:id/reject', ops, async (req) => {
    const b = parse(rejectBody, req.body)
    return svc.rejectRow((req.params as { id: string }).id, b.reason, actorOf(req))
  })

  app.post('/matching/uploads/:id/post-all-exact', ops, async (req) => svc.postAllExact((req.params as { id: string }).id, actorOf(req)))
}
