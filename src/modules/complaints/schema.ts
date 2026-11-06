import { z } from 'zod'
import { CATEGORIES, URGENCIES } from '../ai/classify.js'
import { pageQuery } from '../../lib/pagination.js'

export const createBody = z
  .object({
    flatId: z.string().min(3).max(12),
    text: z.string().trim().min(10, 'Please describe the problem in a few words').max(1500),
    category: z.enum(CATEGORIES).optional(),
  })
  .strict()

export const classifyBody = z.object({ text: z.string().trim().min(10).max(1500) }).strict()

export const listQuery = z
  .object({
    flatId: z.string().max(12).optional(),
    status: z.enum(['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED', 'OPEN']).optional(),
    category: z.enum(CATEGORIES).optional(),
    urgency: z.enum(URGENCIES).optional(),
    tower: z.coerce.number().int().min(1).max(28).optional(),
    assigneeId: z.string().max(40).optional(),
    escalated: z.enum(['true', 'false']).optional(),
    search: z.string().max(80).optional(),
    /** By default linked duplicates are folded under their parent. */
    includeLinked: z.enum(['true', 'false']).default('false'),
  })
  .and(pageQuery)

export const commentBody = z.object({ text: z.string().trim().min(1).max(1000) }).strict()
export const assignBody = z.object({ assigneeId: z.string().min(1).max(40) }).strict()
export const patchBody = z
  .object({ category: z.enum(CATEGORIES).optional(), urgency: z.enum(URGENCIES).optional(), escalated: z.boolean().optional() })
  .strict()
export const statusBody = z.object({ status: z.enum(['IN_PROGRESS', 'RESOLVED']), note: z.string().max(500).optional() }).strict()
export const ratingBody = z.object({ rating: z.number().int().min(1).max(5) }).strict()
export const linkBody = z.object({ parentCode: z.string().regex(/^C-\d+$/) }).strict()
