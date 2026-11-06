import PDFDocument from 'pdfkit'
import type { monthlyReport } from './service.js'

type Report = Awaited<ReturnType<typeof monthlyReport>>
const inr = (p: number) => `Rs ${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const csvCell = (v: string | number) => {
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}` // stop spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function reportCsv(r: Report): string {
  const rows: (string | number)[][] = [
    ['Section', 'Item', 'Value'],
    ['Summary', 'Society', r.society],
    ['Summary', 'Period', r.period],
    ['Collections', 'Bills raised', r.billed.count],
    ['Collections', 'Billed (INR)', r.billed.totalPaise / 100],
    ['Collections', 'Payments received', r.collected.count],
    ['Collections', 'Collected (INR)', r.collected.totalPaise / 100],
    ['Collections', 'Outstanding now (INR)', r.outstandingPaise / 100],
    ...r.ageing.map((a) => ['Dues ageing (days overdue)', a.bucket, a.amountPaise / 100]),
    ...r.towers.map((t) => ['Top defaulting towers (INR)', t.tower, t.duesPaise / 100]),
    ['Complaints', 'Raised', r.complaints.raised],
    ['Complaints', 'Resolved', r.complaints.resolved],
    ['Complaints', 'Safety escalations', r.complaints.escalated],
    ['Complaints', 'Average first response (hours)', r.complaints.avgResponseHours],
    ['Complaints', 'Average resolution (hours)', r.complaints.avgResolutionHours],
    ['Complaints', 'Reopened', r.complaints.reopened],
  ]
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}

export function reportPdf(r: Report): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const h = (t: string) => doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).fillColor('#111').text(t).moveDown(0.2)
    const line = (k: string, v: string | number) => doc.font('Helvetica').fontSize(10).fillColor('#222').text(`${k}: `, { continued: true }).font('Helvetica-Bold').text(String(v))
    doc.font('Helvetica-Bold').fontSize(18).text(r.society)
    doc.font('Helvetica').fontSize(11).fillColor('#555').text(`Monthly report for ${r.period}`)
    h('Collections')
    line('Bills raised', r.billed.count); line('Billed', inr(r.billed.totalPaise))
    line('Payments received', r.collected.count); line('Collected', inr(r.collected.totalPaise)); line('Outstanding now', inr(r.outstandingPaise))
    h('Dues ageing (days overdue)')
    for (const a of r.ageing) line(a.bucket, inr(a.amountPaise))
    h('Top defaulting towers')
    if (!r.towers.length) line('None', '-')
    for (const t of r.towers) line(t.tower, inr(t.duesPaise))
    h('Complaints')
    line('Raised', r.complaints.raised); line('Resolved', r.complaints.resolved); line('Safety escalations', r.complaints.escalated)
    line('Average first response (hours)', r.complaints.avgResponseHours); line('Average resolution (hours)', r.complaints.avgResolutionHours); line('Reopened', r.complaints.reopened)
    doc.moveDown(2).fontSize(8).fillColor('#777').text(`Generated ${r.generatedAt}. Aggregate figures only, no resident details.`)
    doc.end()
  })
}
