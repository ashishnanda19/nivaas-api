import type { FastifyInstance, FastifyRequest } from 'fastify'
import { actorOf, assertFlatAccess, guard, OPS, verifyFileToken } from '../../lib/auth.js'
import { badRequest, forbidden } from '../../lib/errors.js'
import { pageArgs } from '../../lib/pagination.js'
import { parse } from '../../lib/validate.js'
import * as s from './schema.js'
import * as svc from './service.js'

const MAX_PHOTO = 5 * 1024 * 1024

/** Accepts JSON, or multipart with text fields and one optional "photo" file. */
async function readCreate(req: FastifyRequest) {
  if (!req.isMultipart()) return { fields: req.body, photo: undefined as Buffer | undefined }
  const fields: Record<string, string> = {}
  let photo: Buffer | undefined
  for await (const part of req.parts({ limits: { fileSize: MAX_PHOTO, files: 1 } })) {
    if (part.type === 'file') {
      if (part.fieldname !== 'photo') throw badRequest('Unexpected file field')
      photo = await part.toBuffer()
      if (part.file.truncated) throw badRequest('Photo is too large (limit 5 MB)')
    } else fields[part.fieldname] = String(part.value)
  }
  return { fields, photo }
}

export async function complaintRoutes(app: FastifyInstance) {
  const res = { preHandler: guard({ roles: ['RESIDENT', 'HELPDESK'] }) }
  const ops = { preHandler: guard({ roles: OPS }) }
  const code = (req: FastifyRequest) => (req.params as { code: string }).code

  app.post('/complaints/classify', { ...res, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req) => {
    const { text } = parse(s.classifyBody, req.body)
    return svc.classifyOnly(req.user!, text)
  })

  app.post('/complaints', { ...res, bodyLimit: 7_000_000, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const { fields, photo } = await readCreate(req)
    const b = parse(s.createBody, fields)
    assertFlatAccess(req.user!, b.flatId)
    const r = await svc.createComplaint(req.user!, { ...b, photo })
    return { ...(await svc.getComplaint(req.user!, r.code)), suggestion: { source: r.classification.source, fellBackFrom: r.classification.fellBackFrom } }
  })

  app.get('/complaints', res, async (req) => {
    const q = parse(s.listQuery, req.query)
    if (q.flatId) assertFlatAccess(req.user!, q.flatId)
    const r = await svc.listComplaints(req.user!, { ...q, ...pageArgs(q) })
    return { items: r.items, page: q.page, pageSize: q.pageSize, total: r.total }
  })

  app.get('/complaints/:code', res, async (req) => svc.getComplaint(req.user!, code(req)))
  app.post('/complaints/:code/comments', res, async (req) => svc.addComment(req.user!, code(req), parse(s.commentBody, req.body).text))
  app.patch('/complaints/:code', res, async (req) => svc.patch(req.user!, actorOf(req), code(req), parse(s.patchBody, req.body)))
  app.post('/complaints/:code/reopen', res, async (req) => svc.reopen(req.user!, actorOf(req), code(req)))
  app.post('/complaints/:code/rating', res, async (req) => svc.rate(req.user!, code(req), parse(s.ratingBody, req.body).rating))

  app.post('/complaints/:code/assign', ops, async (req) => svc.assign(req.user!, actorOf(req), code(req), parse(s.assignBody, req.body).assigneeId))
  app.post('/complaints/:code/status', ops, async (req) => {
    const b = parse(s.statusBody, req.body)
    return svc.setStatus(req.user!, actorOf(req), code(req), b.status, b.note)
  })
  app.post('/complaints/:code/link', ops, async (req) => svc.link(req.user!, actorOf(req), code(req), parse(s.linkBody, req.body).parentCode))
  app.delete('/complaints/:code/link', ops, async (req) => svc.unlink(req.user!, actorOf(req), code(req)))
  app.get('/staff', ops, async () => ({ items: await svc.listStaff() }))

  // Private photo behind a short-lived token, so an <img> tag works without an Authorization header.
  app.get('/files/complaints/:code', async (req, reply) => {
    const { t } = req.query as { t?: string }
    if (!t || !verifyFileToken(t, `complaint:${code(req)}`)) throw forbidden('Link expired')
    const { buf, mime } = await svc.photoFor(code(req))
    reply.header('content-type', mime).header('cache-control', 'private, max-age=300').header('x-content-type-options', 'nosniff')
    return reply.send(buf)
  })
}
