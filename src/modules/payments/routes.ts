import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { assertFlatAccess, guard } from '../../lib/auth.js'
import { parse } from '../../lib/validate.js'
import { pageArgs, pageQuery } from '../../lib/pagination.js'
import { AppError, badRequest, forbidden } from '../../lib/errors.js'
import { prisma } from '../../lib/db.js'
import * as svc from './service.js'
import { renderReceipt } from './receipt.js'

const intentBody = z
  .object({
    flatId: z.string().min(3).max(12),
    amountPaise: z.number().int().positive(),
    mode: z.enum(['UPI', 'CARD', 'NETBANKING']),
  })
  .strict()

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string
  }
}

export async function paymentRoutes(app: FastifyInstance) {
  const g = { preHandler: guard({ roles: ['RESIDENT', 'HELPDESK'] }) }

  app.post('/payments/intents', g, async (req) => {
    const b = parse(intentBody, req.body)
    assertFlatAccess(req.user!, b.flatId)
    const key = req.headers['idempotency-key']
    return svc.createIntent({ ...b, userId: req.user!.id, idempotencyKey: typeof key === 'string' ? key.slice(0, 100) : undefined })
  })

  // Test-mode gateway: the signed payload goes through the same handler a real gateway webhook would use.
  app.post('/gateway/pay/:id', g, async (req) => {
    const { id } = req.params as { id: string }
    const { outcome } = parse(z.object({ outcome: z.enum(['success', 'failure']) }).strict(), req.body)
    const pay = await svc.getPayment(id)
    assertFlatAccess(req.user!, pay.flatId)
    const payload = JSON.stringify({ paymentId: id, status: outcome, gatewayRef: pay.reference })
    const res = await app.inject({
      method: 'POST', url: '/api/v1/payments/webhook', payload,
      headers: { 'content-type': 'application/json', 'x-signature': svc.sign(payload) },
    })
    if (res.statusCode >= 400) throw new AppError(res.statusCode, 'GATEWAY_ERROR', 'Gateway rejected the confirmation')
    const done = await svc.getPayment(id)
    return { ...svc.paymentView(done) }
  })

  app.post('/payments/webhook', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    if (!svc.verifySignature(req.rawBody ?? '', req.headers['x-signature'] as string | undefined)) throw forbidden('Bad signature')
    const b = parse(z.object({ paymentId: z.string(), status: z.enum(['success', 'failure']), gatewayRef: z.string().optional() }).strict(), req.body)
    const r = await svc.confirmPayment(b.paymentId, b.status, b.gatewayRef)
    return { ok: true, status: r.payment.status }
  })

  app.get('/payments', g, async (req) => {
    const q = parse(z.object({ flatId: z.string() }).and(pageQuery), req.query)
    assertFlatAccess(req.user!, q.flatId)
    const r = await svc.listPayments(q.flatId, pageArgs(q).skip, pageArgs(q).take)
    return { items: r.items, page: q.page, pageSize: q.pageSize, total: r.total }
  })

  app.get('/payments/:id', g, async (req) => {
    const p = await svc.getPayment((req.params as { id: string }).id)
    assertFlatAccess(req.user!, p.flatId)
    return svc.paymentView(p)
  })

  app.get('/payments/:id/receipt.pdf', g, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const p = await svc.getPayment(id)
    assertFlatAccess(req.user!, p.flatId)
    if (!p.receipt) throw badRequest('No receipt yet')
    const d = await svc.receiptData(id)
    const soc = await prisma.society.findFirstOrThrow()
    const pdf = await renderReceipt({
      number: p.receipt.number, flatId: p.flatId, residentName: d.residentName, amountPaise: p.amountPaise,
      mode: p.mode, reference: p.reference, paidAt: p.paidAt ?? p.createdAt, society: soc.name,
    })
    reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${p.receipt.number}.pdf"`)
    return reply.send(pdf)
  })
}
