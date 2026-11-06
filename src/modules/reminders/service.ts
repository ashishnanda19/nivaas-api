import type { Reminder, ReminderKind } from '@prisma/client'
import { prisma } from '../../lib/db.js'
import { logger } from '../../lib/logger.js'
import { maskPhone } from '../../lib/phone.js'
import { writeAudit, systemActor, type Actor } from '../audit/service.js'
import { flatDues } from '../billing/ledger.js'
import { periodLabel } from '../billing/service.js'
import type { MessageProvider } from '../auth/messages.js'
import { reminderText } from './messages.js'
import { reminderRepo as repo } from './repo.js'

/** Days before the due date on which the first reminder goes out, and days after it on which the overdue one does. */
export const REMIND_BEFORE_DAYS = 3
export const REMIND_OVERDUE_AFTER_DAYS = 5

const DAY = 86_400_000
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10)
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY)

/**
 * Which reminder, if any, a bill is due today (India time). A reminder of each kind is sent once per bill and person.
 * 3 days to 1 day before: BEFORE_DUE. On the due date: ON_DUE. From day 5 overdue: OVERDUE. Other days: nothing.
 */
export function reminderKindFor(dueDate: Date, now: Date): { kind: ReminderKind; daysOverdue: number } | null {
  const daysToDue = dayNumber(dueDate.toISOString().slice(0, 10)) - dayNumber(istDay(now))
  const daysOverdue = -daysToDue
  if (daysToDue >= 1 && daysToDue <= REMIND_BEFORE_DAYS) return { kind: 'BEFORE_DUE', daysOverdue: 0 }
  if (daysToDue === 0) return { kind: 'ON_DUE', daysOverdue: 0 }
  if (daysOverdue >= REMIND_OVERDUE_AFTER_DAYS) return { kind: 'OVERDUE', daysOverdue }
  return null
}

/** Daily job. Safe to run again the same day: each bill, person and kind is sent once. A failed send is retried on the next run. */
export async function runReminders(sms: MessageProvider, now = new Date(), actor: Actor = systemActor) {
  const bills = await repo.unpaidBills()
  const flatIds = [...new Set(bills.map((b) => b.flatId))]
  const payers = await repo.payers(flatIds)
  const byFlat = new Map<string, typeof payers>()
  for (const p of payers) (byFlat.get(p.flatId) ?? byFlat.set(p.flatId, []).get(p.flatId)!).push(p)

  const out = { checked: 0, sent: 0, failed: 0, skipped: 0, held: 0 }
  for (const flatId of flatIds) {
    const dues = await flatDues(prisma, flatId)
    for (const bill of bills.filter((b) => b.flatId === flatId)) {
      const due = reminderKindFor(bill.dueDate, now)
      const charge = dues.charges.find((c) => c.ref === `BILL:${bill.period}`)
      if (!due || !charge || charge.remainingPaise <= 0) continue
      const lateDue = dues.charges.filter((c) => c.type === 'LATE_FEE' && c.ref.startsWith(`LF:${bill.id}:`)).reduce((s, c) => s + c.remainingPaise, 0)
      for (const m of byFlat.get(flatId) ?? []) {
        out.checked++
        const existing = await repo.find(bill.id, m.user.id, due.kind)
        if (existing && existing.status === 'SENT') { out.skipped++; continue }
        const message = reminderText(due.kind, m.user.language, {
          name: m.user.name, flatId, period: periodLabel(bill.period), amountPaise: charge.remainingPaise + lateDue,
          dueDate: bill.dueDate.toISOString().slice(0, 10).split('-').reverse().join('/'), daysOverdue: due.daysOverdue,
        })
        // SENT: handed to the provider. FAILED: the provider refused or was unreachable. SKIPPED: deliberately not sent
        // (the number is not on the allow-list, or it is a demo account). FAILED and SKIPPED are looked at again on the next run.
        let status = 'SENT'
        try {
          if ((await sms.sendSms(m.user.phone, message)) === 'skipped') status = 'SKIPPED'
        } catch (e) {
          status = 'FAILED'
          logger.warn({ flatId, kind: due.kind, err: (e as Error).message }, 'reminder send failed')
        }
        const data = { billId: bill.id, flatId, userId: m.user.id, period: bill.period, kind: due.kind, language: m.user.language, phone: m.user.phone, message, status, sentAt: now }
        if (existing) {
          if (existing.status !== status || status === 'FAILED') await repo.update(existing.id, { status, message, sentAt: now })
        } else await repo.create(data)
        if (status === 'SENT') out.sent++
        else if (status === 'SKIPPED') out.held++
        else out.failed++
      }
    }
  }
  if (out.sent || out.failed || out.held) await writeAudit(prisma, actor, { action: 'reminders.run', entity: 'Reminder', entityId: istDay(now), after: out, detail: `${out.sent} reminders sent, ${out.failed} failed, ${out.held} not sent (not allowed)` })
  return out
}

export const reminderView = (r: Reminder) => ({
  id: r.id, flatId: r.flatId, period: r.period, kind: r.kind, language: r.language, phone: maskPhone(r.phone), message: r.message, status: r.status, sentAt: r.sentAt.toISOString(),
})

export async function listReminders(q: { kind?: ReminderKind; flatId?: string; skip: number; take: number }) {
  const where = { ...(q.kind ? { kind: q.kind } : {}), ...(q.flatId ? { flatId: q.flatId } : {}) }
  const [rows, total, groups] = await repo.page(where, q.skip, q.take)
  return { total, items: rows.map(reminderView), summary: groups.map((g) => ({ kind: g.kind, status: g.status, count: g._count })) }
}
