const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** ₹1,06,600 style: Indian grouping, rupee sign, no decimals unless asked. */
export function inr(value: number, fractionDigits = 0): string {
  const abs = Math.abs(value)
  const body =
    fractionDigits > 0
      ? new Intl.NumberFormat('en-IN', {
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        }).format(abs)
      : nf.format(Math.round(abs))
  return `${value < 0 ? '-' : ''}₹${body}`
}

/** ₹1.8 Cr, ₹64.8 L for big dashboard numbers. */
export function inrCompact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(1).replace(/\.0$/, '')} L`
  return inr(value)
}

export const LATE_FEE_RATE_PA = 0.21 // 21% p.a. simple interest, per the society bye-laws (demo)

/** Late fee on the outstanding principal, simple interest by day, rounded to the rupee. */
export function calcLateFee(outstanding: number, daysOverdue: number, ratePa = LATE_FEE_RATE_PA): number {
  if (outstanding <= 0 || daysOverdue <= 0) return 0
  return Math.round((outstanding * ratePa * daysOverdue) / 365)
}

/** Human line for the bill breakup, e.g. "21% a year for 47 days". */
export function lateFeeNote(daysOverdue: number, ratePa = LATE_FEE_RATE_PA): string {
  return `${Math.round(ratePa * 100)}% a year for ${daysOverdue} ${daysOverdue === 1 ? 'day' : 'days'}`
}

const LOCALES: Record<string, string> = { en: 'en-IN', hi: 'hi-IN-u-nu-latn', mr: 'mr-IN-u-nu-latn' }

export function fmtDate(iso: string | number | Date, lang = 'en', withYear = true): string {
  return new Intl.DateTimeFormat(LOCALES[lang] ?? 'en-IN', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(new Date(iso))
}

export function fmtTime(iso: string | number | Date, lang = 'en'): string {
  return new Intl.DateTimeFormat(LOCALES[lang] ?? 'en-IN', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  )
}

export function fmtMonth(iso: string | number | Date, lang = 'en'): string {
  return new Intl.DateTimeFormat(LOCALES[lang] ?? 'en-IN', { month: 'long', year: 'numeric' }).format(
    new Date(iso),
  )
}

/** "5 m", "3 h", "2 d" */
export function ageLabel(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** "1h 20m left" / "Overdue by 2h" */
export function countdownLabel(msLeft: number): string {
  const abs = Math.abs(msLeft)
  const h = Math.floor(abs / 3600000)
  const m = Math.floor((abs % 3600000) / 60000)
  const txt = h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  return msLeft >= 0 ? `${txt} left` : `Overdue ${txt}`
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

/** Today and the next n-1 days. */
export function nextDays(n: number): Date[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() + i)
    return d
  })
}

export const isoDay = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}
