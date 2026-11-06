import type { ZodTypeAny, z } from 'zod'
import { badRequest } from './errors.js'

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data)
  if (!r.success) {
    throw badRequest(
      'Invalid request',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  return r.data
}
