import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, assertFlatAccess, guard } from '../../lib/auth.js'
import { pageArgs, pageQuery } from '../../lib/pagination.js'
import { parse } from '../../lib/validate.js'
import * as svc from './service.js'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')

export const bookBody = z.object({ amenityId: z.string().max(40), flatId: z.string().min(3).max(12), date, start: z.string().regex(/^\d{2}:\d{2}$/) }).strict()

export async function amenityRoutes(app: FastifyInstance) {
  const g = { preHandler: guard({ roles: ['RESIDENT', 'HELPDESK'] }) }

  app.get('/amenities', g, async () => ({ items: await svc.listAmenities() }))
  app.get('/amenities/:id/availability', g, async (req) =>
    svc.availability((req.params as { id: string }).id, parse(z.object({ date }), req.query).date))

  app.post('/amenity-bookings', g, async (req) => {
    const b = parse(bookBody, req.body)
    assertFlatAccess(req.user!, b.flatId)
    return svc.book(req.user!, actorOf(req), b)
  })

  app.get('/amenity-bookings', g, async (req) => {
    const q = parse(z.object({ flatId: z.string().max(12).optional(), amenityId: z.string().max(40).optional(), date: date.optional(), includeCancelled: z.enum(['true', 'false']).optional() }).and(pageQuery), req.query)
    if (q.flatId) assertFlatAccess(req.user!, q.flatId)
    const r = await svc.listBookings(req.user!, { ...q, includeCancelled: q.includeCancelled === 'true', ...pageArgs(q) })
    return { items: r.items, page: q.page, pageSize: q.pageSize, total: r.total }
  })

  app.delete('/amenity-bookings/:id', g, async (req) => svc.cancel(req.user!, actorOf(req), (req.params as { id: string }).id))
}
