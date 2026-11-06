import type { FastifyInstance } from 'fastify'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ZodTypeAny } from 'zod'
import * as authS from '../modules/auth/schema.js'
import * as cS from '../modules/complaints/schema.js'
import * as vS from '../modules/visitors/schema.js'

/**
 * OpenAPI document built from the real route table (so paths cannot drift) plus the Zod schemas the
 * handlers actually validate with (so bodies cannot drift). Served at /docs outside production only.
 */
const BODIES: Record<string, ZodTypeAny> = {
  'POST /api/v1/auth/otp/request': authS.otpRequest,
  'POST /api/v1/auth/otp/verify': authS.otpVerify,
  'POST /api/v1/auth/consent': authS.consentBody,
  'PATCH /api/v1/auth/language': authS.languageBody,
  'POST /api/v1/complaints': cS.createBody,
  'POST /api/v1/complaints/classify': cS.classifyBody,
  'POST /api/v1/complaints/:code/comments': cS.commentBody,
  'POST /api/v1/complaints/:code/assign': cS.assignBody,
  'PATCH /api/v1/complaints/:code': cS.patchBody,
  'POST /api/v1/complaints/:code/status': cS.statusBody,
  'POST /api/v1/complaints/:code/rating': cS.ratingBody,
  'POST /api/v1/complaints/:code/link': cS.linkBody,
  'POST /api/v1/visitors': vS.entry,
  'POST /api/v1/visitors/sync': vS.syncBody,
  'POST /api/v1/visitors/:id/decision': vS.decisionBody,
  'POST /api/v1/visitors/:id/status': vS.gateStatusBody,
  'POST /api/v1/pre-approvals': vS.preApprovalBody,
  'POST /api/v1/pre-approvals/verify': vS.verifyBody,
}
const PUBLIC = [/\/auth\/(otp|refresh|logout)/, /\/payments\/webhook$/, /\/files\//]

export function openApiDoc() {
  return {
    openapi: '3.0.3',
    info: { title: 'Nivaas API', version: '0.1.0', description: 'Resident app and operations console for a gated township. Money is integer paise. Errors: { error: { code, message, details? } }.' },
    servers: [{ url: '/' }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    paths: {} as Record<string, Record<string, unknown>>,
  }
}

export function collectRoutes(app: FastifyInstance, doc: ReturnType<typeof openApiDoc>) {
  app.addHook('onRoute', (route) => {
    if (route.method === 'HEAD' || route.method === 'OPTIONS' || !route.url.startsWith('/api/v1')) return
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const m of methods) {
      const path = route.url.replace(/:(\w+)/g, '{$1}')
      const params = [...route.url.matchAll(/:(\w+)/g)].map((x) => ({ name: x[1], in: 'path', required: true, schema: { type: 'string' } }))
      const body = BODIES[`${m} ${route.url}`]
      const isPublic = PUBLIC.some((re) => re.test(route.url))
      const tag = route.url.split('/')[3] ?? 'misc'
      ;(doc.paths[path] ??= {})[m.toLowerCase()] = {
        tags: [tag],
        summary: `${m} ${route.url.replace('/api/v1', '')}`,
        ...(params.length ? { parameters: params } : {}),
        ...(body
          ? { requestBody: { required: true, content: { 'application/json': { schema: zodToJsonSchema(body, { target: 'openApi3', $refStrategy: 'none' }) } } } }
          : {}),
        ...(isPublic ? {} : { security: [{ bearer: [] }] }),
        responses: { '200': { description: 'OK' }, '400': { description: 'Validation error' }, '401': { description: 'Not signed in' }, '403': { description: 'Not allowed' } },
      }
    }
  })
}
