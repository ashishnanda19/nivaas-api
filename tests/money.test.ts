import { describe, expect, it } from 'vitest'
import { calcLateFee, calcMaintenance, daysBetween, type LateFeeConfig } from '../src/lib/money.js'

describe('calcMaintenance', () => {
  it.each([
    [1150, 747500],
    [980, 637000],
    [1640, 1066000],
  ])('%i sq ft at Rs 6.50 is %i paise', (area, expected) => {
    expect(calcMaintenance(area, 650)).toBe(expected)
  })
  it('rounds to the nearest whole rupee', () => {
    expect(calcMaintenance(1001, 650)).toBe(650700) // 6506.5 -> 6507
    expect(calcMaintenance(1000, 655)).toBe(655000)
    expect(calcMaintenance(1003, 650) % 100).toBe(0)
  })
  it('rejects bad input', () => {
    expect(() => calcMaintenance(0, 650)).toThrow()
    expect(() => calcMaintenance(10.5, 650)).toThrow()
  })
})

const interest: LateFeeConfig = { graceDays: 5, mode: 'MONTHLY_INTEREST', flatPaise: 0, monthlyBp: 175 }
describe('calcLateFee', () => {
  it('is zero inside the grace period', () => {
    expect(calcLateFee(637000, 0, interest)).toBe(0)
    expect(calcLateFee(637000, 5, interest)).toBe(0)
  })
  it('accrues simple interest pro rata by day after grace', () => {
    // 6370 * 1.75 % * 47 / 30 = 174.64
    expect(calcLateFee(637000, 47, interest)).toBe(17464)
    // 1,000 paise-free sanity: 30 days is exactly one month of interest
    expect(calcLateFee(1_000_000, 30, interest)).toBe(17500)
  })
  it('charges a flat fee once grace is over', () => {
    const flat: LateFeeConfig = { ...interest, mode: 'FLAT', flatPaise: 50000 }
    expect(calcLateFee(637000, 6, flat)).toBe(50000)
    expect(calcLateFee(637000, 90, flat)).toBe(50000)
    expect(calcLateFee(637000, 3, flat)).toBe(0)
  })
  it('charges nothing when nothing is unpaid', () => {
    expect(calcLateFee(0, 60, interest)).toBe(0)
  })
})

describe('daysBetween', () => {
  it('ignores time of day', () => {
    expect(daysBetween(new Date('2026-10-10T23:59:00Z'), new Date('2026-10-11T00:01:00Z'))).toBe(1)
  })
})
