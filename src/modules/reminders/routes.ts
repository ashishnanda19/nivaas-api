import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { actorOf, guard } from '../../lib/auth.js'
import { pageArgs, pageQuery } from '../../lib/pagination.js'
import { parse } from '../../lib/validate.js'
import type { MessageProvider } from '../auth/messages.js'
import * as svc from './service.js'

export const remindersRoutes = (sms: MessageProvider) =>
  async function (app: FastifyInstance) {
    app.get('/reminders', { preHandler: guard({ roles: ['HELPDESK', 'COMMITTEE'] }) }, async (req) => {
      const q = parse(z.object({ kind: z.enum(['BEFORE_DUE', 'ON_DUE', 'OVERDUE']).optional(), flatId: z.string().max(12).optional() }).and(pageQuery), req.query)
      const r = await svc.listReminders({ kind: q.kind, flatId: q.flatId, ...pageArgs(q) })
      return { ...r, page: q.page, pageSize: q.pageSize }
    })

    // The same job the scheduler runs daily. Safe to press twice: nothing is sent a second time.
    app.post('/reminders/run', { preHandler: guard({ roles: ['HELPDESK'] }), config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) =>
      svc.runReminders(sms, new Date(), actorOf(req)))
  }
