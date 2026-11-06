import crypto from 'node:crypto'
import { prisma } from '../../lib/db.js'
import { config } from '../../lib/config.js'
import { AppError, badRequest, notFound } from '../../lib/errors.js'
import { postPaymentEntries } from '../billing/ledger.js'
import { writeAudit, systemActor, type Actor } from '../audit/service.js'
import type { PayMode } from '@prisma/client'

export const sign = (raw: string) => crypto.createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET).update(raw).digest('hex')

export function verifySignature(raw: string, given: string | undefined): boolean {
  if (!given) return false
  const a = Buffer.from(sign(raw))
  const b = Buffer.from(given)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function createIntent(p: { flatId: string; userId: string; amountPaise: number; mode: PayMode; idempotencyKey?: string }) {
  if (p.amountPaise < 100) throw badRequest('Minimum payment is Rs 1')
  if (p.amountPaise > 1_000_000_00) throw badRequest('Amount is too large for one payment')
  const key = p.idempotencyKey ? `${p.userId}:${p.idempotencyKey}` : undefined
  if (key) {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: key } })
    if (existing) return toIntent(existing)
  }
  try {
    const pay = await prisma.payment.create({
      data: {
        flatId: p.flatId, amountPaise: p.amountPaise, mode: p.mode, source: 'TEST_GATEWAY',
        reference: `TG${crypto.randomBytes(5).toString('hex').toUpperCase()}`, idempotencyKey: key,
      },
    })
    return toIntent(pay)
  } catch (e) {
    // Two requests with the same key raced: return the winner.
    if (key && (e as { code?: string }).code === 'P2002') {
      const winner = await prisma.payment.findUnique({ where: { idempotencyKey: key } })
      if (winner) return toIntent(winner)
    }
    throw e
  }
}

const toIntent = (p: { id: string; status: string; amountPaise: number; flatId: string; reference: string }) => ({
  paymentId: p.id, status: p.status, amountPaise: p.amountPaise, flatId: p.flatId, reference: p.reference,
  gatewayUrl: `/api/v1/gateway/pay/${p.id}`,
})

/** Idempotent. Success posts the ledger entry and receipt exactly once. */
export async function confirmPayment(paymentId: string, outcome: 'success' | 'failure', gatewayRef?: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`
    const pay = await tx.payment.findUnique({ where: { id: paymentId } })
    if (!pay) throw notFound('Payment not found')
    if (pay.status !== 'PENDING') return { payment: pay, receipt: await tx.receipt.findUnique({ where: { paymentId } }), changed: false }
    if (outcome === 'failure') {
      const failed = await tx.payment.update({ where: { id: paymentId }, data: { status: 'FAILED' } })
      return { payment: failed, receipt: null, changed: true }
    }
    const done = await tx.payment.update({
      where: { id: paymentId }, data: { status: 'SUCCESS', paidAt: new Date(), reference: gatewayRef ?? pay.reference },
    })
    await postPaymentEntries(tx, { flatId: pay.flatId, paymentId, amountPaise: pay.amountPaise, label: `Payment ${done.mode} ${done.reference}` })
    const n = await tx.receipt.count()
    const receipt = await tx.receipt.create({
      data: { paymentId, number: `NIV-${new Date().getUTCFullYear()}-${String(n + 1).padStart(6, '0')}` },
    })
    await writeAudit(tx, systemActor, { action: 'payment.confirm', entity: 'Payment', entityId: paymentId, after: { amountPaise: pay.amountPaise } })
    return { payment: done, receipt, changed: true }
  })
}

export async function getPayment(id: string) {
  const p = await prisma.payment.findUnique({ where: { id }, include: { receipt: true } })
  if (!p) throw notFound('Payment not found')
  return p
}

export async function listPayments(flatId: string, skip: number, take: number) {
  const where = { flatId, status: 'SUCCESS' as const }
  const [items, total] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { paidAt: 'desc' }, skip, take, include: { receipt: true } }),
    prisma.payment.count({ where }),
  ])
  return { items: items.map(paymentView), total }
}

export const paymentView = (p: Awaited<ReturnType<typeof getPayment>>) => ({
  id: p.id, flatId: p.flatId, amountPaise: p.amountPaise, mode: p.mode, reference: p.reference, status: p.status,
  source: p.source, paidAt: p.paidAt?.toISOString() ?? null, receiptNumber: p.receipt?.number ?? null,
})

export async function receiptData(paymentId: string) {
  const p = await getPayment(paymentId)
  if (p.status !== 'SUCCESS' || !p.receipt) throw new AppError(409, 'NO_RECEIPT', 'No receipt for this payment')
  const member = await prisma.flatMember.findFirst({
    where: { flatId: p.flatId, active: true }, include: { user: { select: { name: true } } }, orderBy: { relation: 'asc' },
  })
  return { payment: p, residentName: member?.user.name ?? 'Resident' }
}

export type { Actor }
