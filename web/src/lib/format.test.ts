import { calcLateFee, inr, inrCompact, lateFeeNote } from './format'

describe('inr', () => {
  it('uses Indian grouping with the rupee sign', () => {
    expect(inr(7475)).toBe('₹7,475')
    expect(inr(106600)).toBe('₹1,06,600')
    expect(inr(12345678)).toBe('₹1,23,45,678')
  })
  it('handles zero, negatives and decimals', () => {
    expect(inr(0)).toBe('₹0')
    expect(inr(-5000)).toBe('-₹5,000')
    expect(inr(6.5, 2)).toBe('₹6.50')
  })
  it('compacts to lakh and crore', () => {
    expect(inrCompact(6480000)).toBe('₹64.8 L')
    expect(inrCompact(18000000)).toBe('₹1.8 Cr')
    expect(inrCompact(4500)).toBe('₹4,500')
  })
})

describe('late fee', () => {
  it('is simple interest by day, rounded to the rupee', () => {
    expect(calcLateFee(6370, 47)).toBe(172)
    expect(calcLateFee(5660, 18)).toBe(59)
  })
  it('is zero when nothing is owed or not overdue', () => {
    expect(calcLateFee(0, 30)).toBe(0)
    expect(calcLateFee(5000, 0)).toBe(0)
  })
  it('describes itself for the bill breakup', () => {
    expect(lateFeeNote(47)).toBe('21% a year for 47 days')
    expect(lateFeeNote(1)).toBe('21% a year for 1 day')
  })
})
