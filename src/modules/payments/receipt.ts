import PDFDocument from 'pdfkit'

export function renderReceipt(d: { number: string; flatId: string; residentName: string; amountPaise: number; mode: string; reference: string; paidAt: Date; society: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const inr = (p: number) => `Rs ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    doc.fontSize(18).text(d.society, { align: 'left' })
    doc.fontSize(10).fillColor('#555').text('Maintenance payment receipt').moveDown(1.5)
    doc.fillColor('#000').fontSize(11)
    const rows: [string, string][] = [
      ['Receipt no.', d.number],
      ['Date', d.paidAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
      ['Flat', d.flatId],
      ['Received from', d.residentName],
      ['Mode', d.mode],
      ['Reference', d.reference],
    ]
    for (const [k, v] of rows) doc.font('Helvetica-Bold').text(k, { continued: true }).font('Helvetica').text(`  ${v}`)
    doc.moveDown().fontSize(16).font('Helvetica-Bold').text(`Amount received  ${inr(d.amountPaise)}`)
    doc.moveDown(2).fontSize(8).font('Helvetica').fillColor('#666').text('Computer generated receipt. Test payment gateway.')
    doc.end()
  })
}
