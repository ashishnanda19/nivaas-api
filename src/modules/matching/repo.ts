import type { RowState } from '@prisma/client'
import { prisma } from '../../lib/db.js'

export const matchingRepo = {
  society: () => prisma.society.findFirstOrThrow(),
  flatsWithResidents: () =>
    prisma.flat.findMany({ include: { members: { where: { active: true, relation: { in: ['OWNER', 'TENANT'] } }, include: { user: { select: { name: true } } } } } }),
  allLedger: () => prisma.ledgerEntry.findMany({ orderBy: [{ flatId: 'asc' }, { seq: 'asc' }], select: { flatId: true, type: true, amountPaise: true, ref: true, period: true } }),
  upiPayers: () => prisma.knownPayer.findMany({ where: { upiId: { not: null } } }),
  postedBankReferences: () => prisma.payment.findMany({ where: { source: 'BANK_CSV', status: 'SUCCESS' }, select: { reference: true } }),

  uploadById: (id: string) => prisma.bankStatementUpload.findUnique({ where: { id } }),
  uploadsPage: (skip: number, take: number) =>
    Promise.all([
      prisma.bankStatementUpload.findMany({ orderBy: { createdAt: 'desc' }, skip, take, include: { _count: { select: { rows: true } } } }),
      prisma.bankStatementUpload.count(),
    ]),
  rowsPage: (uploadId: string, skip: number, take: number) =>
    Promise.all([
      prisma.bankStatementRow.findMany({ where: { uploadId }, orderBy: { lineNo: 'asc' }, skip, take }),
      prisma.bankStatementRow.count({ where: { uploadId } }),
      prisma.bankStatementRow.groupBy({ by: ['confidence', 'state'], where: { uploadId }, _count: true }),
    ]),
  queuePage: (skip: number, take: number) => {
    const where = { state: 'QUEUED' as RowState }
    return Promise.all([prisma.bankStatementRow.findMany({ where, orderBy: [{ date: 'desc' }, { lineNo: 'asc' }], skip, take }), prisma.bankStatementRow.count({ where })])
  },
  rowById: (id: string) => prisma.bankStatementRow.findUnique({ where: { id } }),
  setRowState: (id: string, state: RowState) => prisma.bankStatementRow.update({ where: { id }, data: { state } }),
  pendingExactRows: (uploadId: string) =>
    prisma.bankStatementRow.findMany({ where: { uploadId, state: 'PENDING', confidence: 'EXACT', label: null }, orderBy: { lineNo: 'asc' } }),
}
