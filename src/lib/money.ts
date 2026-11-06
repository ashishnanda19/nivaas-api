// All amounts are integer paise.

export const RUPEE = 100

/** Maintenance = area x rate per sq ft, rounded to the nearest whole rupee. */
export function calcMaintenance(areaSqft: number, ratePaisePerSqft: number): number {
  if (!Number.isInteger(areaSqft) || areaSqft <= 0) throw new Error('area must be a positive integer')
  if (!Number.isInteger(ratePaisePerSqft) || ratePaisePerSqft < 0) throw new Error('invalid rate')
  const rupees = Math.round((areaSqft * ratePaisePerSqft) / RUPEE)
  return rupees * RUPEE
}

export interface LateFeeConfig {
  graceDays: number
  mode: 'FLAT' | 'MONTHLY_INTEREST'
  flatPaise: number
  /** Basis points per month (175 = 1.75 % a month). Simple interest, pro rata by day. */
  monthlyBp: number
}

/**
 * Total late fee accrued on an unpaid amount, `daysOverdue` days after the due date.
 *  - Nothing is charged until the grace period has passed.
 *  - FLAT: one flat fee once the grace period has passed.
 *  - MONTHLY_INTEREST: simple interest at monthlyBp per 30 days, accrued per day
 *    from the due date once the grace period is over (grace waives the fee, not the clock).
 */
export function calcLateFee(unpaidPaise: number, daysOverdue: number, cfg: LateFeeConfig): number {
  if (unpaidPaise <= 0 || daysOverdue <= cfg.graceDays) return 0
  if (cfg.mode === 'FLAT') return cfg.flatPaise
  return Math.round((unpaidPaise * cfg.monthlyBp * daysOverdue) / (10000 * 30))
}

export const toRupees = (paise: number) => paise / RUPEE

/** Whole days between two dates, ignoring time of day (UTC). */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / 86400000)
}
