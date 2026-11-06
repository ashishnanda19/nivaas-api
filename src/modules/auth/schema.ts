import { z } from 'zod'

export const phone = z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10 digit Indian mobile number')

export const otpRequest = z.object({ phone }).strict()
export const otpVerify = z.object({ phone, code: z.string().regex(/^\d{6}$/) }).strict()
export const languageBody = z.object({ language: z.enum(['en', 'hi', 'mr']) }).strict()
export const consentBody = z.object({ accepted: z.literal(true) }).strict()
