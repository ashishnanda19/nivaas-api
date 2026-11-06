/**
 * Strip personal data before text leaves the server for an external model.
 * Removes phone numbers, emails, ID-like long digit runs, flat codes and any name we know belongs to the flat.
 */
export function redact(text: string, knownNames: string[] = []): string {
  let t = text
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
  t = t.replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]')
  t = t.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[id]')
  t = t.replace(/\bT\s?-?\d{1,2}[\s-]?\d{3,4}\b/gi, '[flat]')
  const parts = new Set<string>()
  for (const n of knownNames) for (const p of n.split(/\s+/)) if (p.length >= 3) parts.add(p)
  for (const p of parts) t = t.replace(new RegExp(`(?<![\\p{L}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu'), '[name]')
  return t
}
