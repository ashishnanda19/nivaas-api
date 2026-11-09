import type { BankStatementRow, Prisma, RowState } from '@prisma/client'
import { prisma } from '../../lib/db.js'
import { badRequest, conflict, notFound } from '../../lib/errors.js'
import { allocate, postPaymentEntries } from '../billing/ledger.js'
import { writeAudit, type Actor } from '../audit/service.js'
import { calcMaintenance } from '../../lib/money.js'
import { storage } from '../../lib/storage.js'
import { matchingRepo as repo } from './repo.js'
import { parseStatement } from './csv.js'
import { isBulkPostable, matchRows, norm, type FlatInfo, type MatchResult } from './engine.js'

/** Everything the engine needs about every flat, read in two queries. */
export async function loadFlatInfos(): Promise<FlatInfo[]> {
  const soc = await repo.society()
  const [flats, ledger, payers] = await Promise.all([
    repo.flatsWithResidents(),
    repo.allLedger(),
    repo.knownPayers(),
  ])
  const byFlat = new Map<string, typeof ledger>()
  for (const e of ledger) (byFlat.get(e.flatId) ?? byFlat.set(e.flatId, []).get(e.flatId)!).push(e)
  const upis = new Map<string, string[]>()
  const names = new Map<string, string[]>()
  for (const p of payers) {
    if (p.upiId) (upis.get(p.flatId) ?? upis.set(p.flatId, []).get(p.flatId)!).push(p.upiId)
    if (p.payerName) (names.get(p.flatId) ?? names.set(p.flatId, []).get(p.flatId)!).push(p.payerName)
  }
  return flats.map((f) => {
    const d = allocate(byFlat.get(f.id) ?? [])
    return {
      flatId: f.id, towerNo: f.towerNo, number: f.number, residentNames: f.members.map((m) => m.user.name),
      monthlyBillPaise: calcMaintenance(f.areaSqft, soc.ratePaisePerSqft),
      oldestOpenBillPaise: d.openBills[0]?.remainingPaise ?? 0,
      openBillsPaise: d.openBills.reduce((s, b) => s + b.remainingPaise, 0),
      balancePaise: d.balancePaise, knownUpiIds: upis.get(f.id) ?? [], knownPayerNames: names.get(f.id) ?? [],
    }
  })
}

export async function postedReferences(): Promise<Set<string>> {
  const rows = await repo.postedBankReferences()
  return new Set(rows.map((r) => norm(r.reference)))
}

export async function uploadStatement(filename: string, text: string, actor: Actor) {
  const parsed = parseStatement(text)
  // A file with nothing usable in it is refused before anything is stored, with the first reasons so the user can fix it.
  if (parsed.rows.length === 0) {
    throw badRequest('No valid rows were found in this file. Expected columns: Date, Amount, Reference (or Narration).', parsed.errors.slice(0, 5))
  }
  // Keep the original file as received, so a posting can always be traced back to the bank's own statement.
  const fileKey = await storage.put('statements', Buffer.from(text, 'utf8'), 'csv')
  const [flats, posted] = await Promise.all([loadFlatInfos(), postedReferences()])
  const results = matchRows({ rows: parsed.rows, flats, postedReferences: posted })
  const byLine = new Map(results.map((r) => [r.lineNo, r]))

  const upload = await prisma.$transaction(async (tx) => {
    const up = await tx.bankStatementUpload.create({
      data: { filename: filename.slice(0, 120), fileKey, uploadedBy: actor.id ?? 'system', parseErrors: parsed.errors as unknown as Prisma.InputJsonValue },
    })
    await tx.bankStatementRow.createMany({
      data: parsed.rows.map((r) => {
        const m = byLine.get(r.lineNo)!
        return {
          uploadId: up.id, lineNo: r.lineNo, date: r.date, amountPaise: r.amountPaise, narration: r.narration, reference: r.reference,
          upiId: r.upiId, payerName: r.payerName, suggestedFlatId: m.suggestedFlatId, confidence: m.confidence, label: m.label,
          reasons: { reasons: m.reasons, candidates: m.candidates, duplicateOf: m.duplicateOf } as unknown as Prisma.InputJsonValue,
          // Exact rows wait for a one-click confirm. Everything else goes straight to the Accounts queue.
          state: m.confidence === 'EXACT' && isBulkPostable(m) ? ('PENDING' as RowState) : ('QUEUED' as RowState),
        }
      }),
    })
    await writeAudit(tx, actor, { action: 'statement.upload', entity: 'BankStatementUpload', entityId: up.id, detail: `${parsed.rows.length} rows from ${filename}` })
    return up
  })
  return getUpload(upload.id, { skip: 0, take: 500 }, { skipped: parsed.skipped })
}

export async function getUpload(id: string, page: { skip: number; take: number }, extra: { skipped?: number } = {}) {
  const up = await repo.uploadById(id)
  if (!up) throw notFound('Upload not found')
  const [rows, total, counts] = await repo.rowsPage(id, page.skip, page.take)
  return {
    id: up.id, filename: up.filename, createdAt: up.createdAt.toISOString(), parseErrors: up.parseErrors, skipped: extra.skipped ?? 0,
    total, summary: counts.map((c) => ({ confidence: c.confidence, state: c.state, count: c._count })), rows: rows.map(rowView),
  }
}

export const rowView = (r: BankStatementRow) => {
  const why = (r.reasons ?? {}) as { reasons?: string[]; candidates?: string[]; duplicateOf?: string | null }
  return {
    id: r.id, uploadId: r.uploadId, lineNo: r.lineNo, date: r.date.toISOString().slice(0, 10), amountPaise: r.amountPaise,
    narration: r.narration, reference: r.reference, upiId: r.upiId, suggestedFlatId: r.suggestedFlatId, confidence: r.confidence,
    label: r.label, reasons: why.reasons ?? [], candidates: why.candidates ?? [], duplicateOf: why.duplicateOf ?? null,
    state: r.state, matchedFlatId: r.matchedFlatId, postedAt: r.postedAt?.toISOString() ?? null,
  }
}

/** The original CSV exactly as uploaded. Reading it is audited, because it holds payers' names and account details. */
export async function uploadFile(id: string, actor: Actor) {
  const up = await repo.uploadById(id)
  if (!up) throw notFound('Upload not found')
  const data = up.fileKey ? await storage.get(up.fileKey) : null
  if (!data) throw notFound('The original file was not kept for this upload')
  await writeAudit(prisma, actor, { action: 'statement.download', entity: 'BankStatementUpload', entityId: id, detail: up.filename })
  return { filename: up.filename, data }
}

export async function listUploads(page: { skip: number; take: number }) {
  const [items, total] = await repo.uploadsPage(page.skip, page.take)
  return { total, items: items.map((u) => ({ id: u.id, filename: u.filename, createdAt: u.createdAt.toISOString(), rows: u._count.rows })) }
}

export async function accountsQueue(page: { skip: number; take: number }) {
  const [rows, total] = await repo.queuePage(page.skip, page.take)
  return { total, items: rows.map(rowView) }
}

export interface PostOpts {
  flatId?: string
  allowDuplicate?: boolean
}

/**
 * Post one row. Only ever called after a help-desk user confirms it.
 * One transaction: payment, ledger entries, receipt, row state, known payer and audit all commit or none do.
 * Idempotent: posting an already posted row returns the same payment.
 */
export async function postRow(rowId: string, opts: PostOpts, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BankStatementRow" WHERE id = ${rowId} FOR UPDATE`
    const row = await tx.bankStatementRow.findUnique({ where: { id: rowId } })
    if (!row) throw notFound('Row not found')
    if (row.state === 'POSTED') return { rowId, paymentId: row.paymentId!, flatId: row.matchedFlatId!, alreadyPosted: true }
    if (row.state === 'REJECTED') throw conflict('This row was rejected')

    const why = (row.reasons ?? {}) as { duplicateOf?: string | null }
    // Exact rows may use the suggestion. Anything else needs the flat chosen by a person.
    const flatId = opts.flatId ?? (row.confidence === 'EXACT' ? row.suggestedFlatId : null)
    if (!flatId) throw badRequest('Choose the flat this payment belongs to')
    if (!(await tx.flat.findUnique({ where: { id: flatId } }))) throw notFound('Flat not found')
    if ((row.label === 'duplicate' || why.duplicateOf) && !opts.allowDuplicate)
      throw conflict('This looks like a duplicate. Confirm explicitly to post it anyway.', { duplicateOf: why.duplicateOf })

    const reference = row.reference || `CSV-${row.id}`
    const pay = await tx.payment.create({
      data: {
        flatId, amountPaise: row.amountPaise, mode: row.upiId ? 'UPI' : 'TRANSFER', reference, upiId: row.upiId,
        source: 'BANK_CSV', status: 'SUCCESS', paidAt: row.date,
      },
    })
    await postPaymentEntries(tx, { flatId, paymentId: pay.id, amountPaise: row.amountPaise, label: `Bank transfer ${reference}` })
    await tx.receipt.create({ data: { paymentId: pay.id, number: `NIV-${new Date().getUTCFullYear()}-B${String(await tx.receipt.count() + 1).padStart(6, '0')}` } })
    await tx.bankStatementRow.update({ where: { id: row.id }, data: { state: 'POSTED', matchedFlatId: flatId, postedBy: actor.id, postedAt: new Date(), paymentId: pay.id } })
    // Learn the payer only from a confirmed posting.
    if (row.upiId) {
      await tx.knownPayer.upsert({ where: { flatId_upiId: { flatId, upiId: row.upiId } }, update: row.payerName ? { payerName: row.payerName } : {}, create: { flatId, upiId: row.upiId, payerName: row.payerName } })
    } else if (row.payerName && !(await tx.knownPayer.findFirst({ where: { flatId, upiId: null, payerName: row.payerName } }))) {
      // A transfer with no UPI ID still teaches the payer's name, so the next one is recognised.
      await tx.knownPayer.create({ data: { flatId, payerName: row.payerName } })
    }
    await writeAudit(tx, actor, {
      action: 'statement.post', entity: 'BankStatementRow', entityId: row.id,
      before: { suggestedFlatId: row.suggestedFlatId, confidence: row.confidence, label: row.label },
      after: { flatId, paymentId: pay.id, amountPaise: row.amountPaise },
      detail: opts.flatId && opts.flatId !== row.suggestedFlatId ? 'Flat chosen manually' : 'Confirmed suggestion',
    })
    return { rowId, paymentId: pay.id, flatId, alreadyPosted: false }
  })
}

export async function rejectRow(rowId: string, reason: string, actor: Actor) {
  const row = await repo.rowById(rowId)
  if (!row) throw notFound('Row not found')
  if (row.state === 'POSTED') throw conflict('A posted row cannot be rejected. Reverse the ledger entry instead.')
  await repo.setRowState(rowId, 'REJECTED')
  await writeAudit(prisma, actor, { action: 'statement.reject', entity: 'BankStatementRow', entityId: rowId, detail: reason })
  return { ok: true }
}

/**
 * Post every EXACT row of an upload and nothing else. Each row is re-checked against today's dues first, so a
 * row whose bill was paid in the meantime is skipped rather than posted blindly.
 */
export async function postAllExact(uploadId: string, actor: Actor) {
  if (!(await repo.uploadById(uploadId))) throw notFound('Upload not found')
  const rows = await repo.pendingExactRows(uploadId)
  const [flats, posted] = await Promise.all([loadFlatInfos(), postedReferences()])
  const out = { posted: 0, skipped: [] as { rowId: string; lineNo: number; reason: string }[] }
  for (const r of rows) {
    const fresh: MatchResult = matchRows({
      rows: [{ lineNo: r.lineNo, date: r.date, amountPaise: r.amountPaise, narration: r.narration, reference: r.reference, upiId: r.upiId, payerName: r.payerName }],
      flats, postedReferences: posted,
    })[0]
    if (!isBulkPostable(fresh) || fresh.suggestedFlatId !== r.suggestedFlatId) {
      out.skipped.push({ rowId: r.id, lineNo: r.lineNo, reason: 'Dues changed since the upload, review this row by hand' })
      await repo.setRowState(r.id, 'QUEUED')
      continue
    }
    try {
      const res = await postRow(r.id, {}, actor)
      if (!res.alreadyPosted) out.posted++
      if (r.reference) posted.add(norm(r.reference))
    } catch (e) {
      out.skipped.push({ rowId: r.id, lineNo: r.lineNo, reason: (e as Error).message })
    }
  }
  await writeAudit(prisma, actor, { action: 'statement.post_all_exact', entity: 'BankStatementUpload', entityId: uploadId, after: { posted: out.posted, skipped: out.skipped.length } })
  return out
}
