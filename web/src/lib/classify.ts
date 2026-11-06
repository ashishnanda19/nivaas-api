import type { Category, Classification, Urgency } from './api/types'

/** Words that always escalate to the duty manager by rule, whatever the classifier says. */
export const SAFETY_PATTERNS: RegExp[] = [
  /\bfire\b/i,
  /\bgas\b/i,
  /lift (is )?stuck|stuck (in|inside) (the )?lift|lift (has )?stopped between/i,
  /\bshock\b|electric shock|sparking|short circuit/i,
  /आग|गैस|करंट|लिफ्ट.{0,12}(अटक|फंस)|आगीचा|लिफ्टमध्ये अडक/,
]
export const isSafety = (text: string) => SAFETY_PATTERNS.some((p) => p.test(text))

const RULES: { category: Category; words: RegExp; label: string }[] = [
  {
    category: 'plumbing',
    words: /leak|tap|pipe|water|drain|seepage|flush|tank|पानी|नल|गळ/i,
    label: 'water, leak or pipe',
  },
  {
    category: 'electrical',
    words: /light|power|electric|switch|fuse|wiring|bulb|mcb|बिजली|वीज/i,
    label: 'power or lighting',
  },
  { category: 'lift', words: /\blift\b|elevator|लिफ्ट/i, label: 'lift' },
  {
    category: 'security',
    words: /theft|stranger|guard|gate|cctv|suspicious|चोरी|सुरक्षा/i,
    label: 'security or gate',
  },
  {
    category: 'housekeeping',
    words: /garbage|dustbin|clean|sweep|trash|stairs dirty|कचरा|सफाई|स्वच्छ/i,
    label: 'cleaning or garbage',
  },
  { category: 'parking', words: /park|vehicle|car blocked|bike/i, label: 'parking' },
  { category: 'noise', words: /noise|loud|music|drilling|party|आवाज|गोंगाट/i, label: 'noise' },
]

export function classifyText(text: string): Classification {
  const t = text.trim()
  const escalated = isSafety(t)
  let category: Category = 'other'
  let reason = 'No clear keywords, so the help desk will review it.'
  const hit = RULES.find((r) => r.words.test(t))
  if (hit) {
    category = hit.category
    reason = `Mentions ${hit.label}, which is usually ${hit.category}.`
  }
  let urgency: Urgency = 'normal'
  if (/urgent|immediately|emergency|flood|no water|no power|not working since|तुरंत|त्वरित/i.test(t))
    urgency = 'high'
  if (/just a|minor|whenever|small/i.test(t)) urgency = 'low'
  if (escalated) {
    category = 'safety'
    urgency = 'urgent'
    reason = 'Contains a safety word (fire, gas, lift stuck or shock). Escalated to the duty manager by rule.'
  }
  return { category, urgency, reason, escalated }
}

export const SLA_HOURS: Record<Urgency, number> = { urgent: 0.5, high: 8, normal: 24, low: 72 }
