import { z } from 'zod'
import { phone } from '../auth/schema.js'
import { pageQuery } from '../../lib/pagination.js'

export const PHOTO_DAYS = 90
const dataUrl = z
  .string()
  .max(2_500_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Photo must be a JPEG, PNG or WebP data URL')

export const entry = z
  .object({
    clientId: z.string().min(8).max(64).regex(/^[\w-]+$/).optional(),
    gateId: z.string().min(1).max(20),
    flatId: z.string().min(3).max(12),
    name: z.string().trim().min(2).max(80),
    phone,
    purpose: z.string().trim().min(2).max(80),
    photo: dataUrl.optional(),
    /** Device time when the entry was written. Used for offline entries. */
    createdAt: z.coerce.date().optional(),
  })
  .strict()

export const syncBody = z.object({ entries: z.array(entry).min(1).max(100) }).strict()
export const decisionBody = z.object({ decision: z.enum(['APPROVED', 'DENIED']) }).strict()
export const gateStatusBody = z.object({ status: z.enum(['CHECKED_IN', 'CHECKED_OUT']) }).strict()
export const listQuery = z
  .object({
    flatId: z.string().max(12).optional(),
    gateId: z.string().max(20).optional(),
    status: z.enum(['WAITING', 'APPROVED', 'DENIED', 'CHECKED_IN', 'CHECKED_OUT']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    reveal: z.enum(['true', 'false']).optional(),
  })
  .and(pageQuery)

export const preApprovalBody = z
  .object({ flatId: z.string().min(3).max(12), guestName: z.string().trim().min(2).max(80), date: z.coerce.date() })
  .strict()
export const verifyBody = z.object({ code: z.string().regex(/^\d{6}$/), gateId: z.string().min(1).max(20) }).strict()
