/** Tiny single-page PDF writer (Helvetica, text only). Enough for receipts and reports without a dependency. */
const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1')

export function makePdf(title: string, lines: string[]): Blob {
  const content: string[] = ['BT', '/F2 20 Tf', '56 780 Td', `(${esc(title)}) Tj`, 'ET']
  let y = 745
  for (const line of lines) {
    const bold = line.startsWith('# ')
    const text = bold ? line.slice(2) : line
    content.push('BT', `${bold ? '/F2 12' : '/F1 11'} Tf`, `56 ${y} Td`, `(${esc(text)}) Tj`, 'ET')
    y -= bold ? 26 : 18
  }
  const stream = content.join('\n')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((o) => (out += `${String(o).padStart(10, '0')} 00000 n \n`))
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([out], { type: 'application/pdf' })
}
