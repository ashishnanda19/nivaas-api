import type { Category, Urgency } from '@prisma/client'

/**
 * Deterministic rules. Two jobs:
 *  1. Safety words. These run before any model and decide escalation. Nothing downstream can undo them.
 *  2. A keyword classifier used when no model is available, so a complaint can always be filed.
 * Lists cover English, Hindi (Devanagari and common Roman spellings) and Marathi.
 */

export type SafetyKind = 'fire' | 'gas' | 'lift_trapped' | 'electric' | 'flood' | 'collapse' | 'medical'

const SAFETY: Record<SafetyKind, RegExp[]> = {
  fire: [
    /\b(fire|on fire|caught fire|burning|smoke|smoking|blaze|explosion|exploded|blast)\b/i,
    /आग|धुआँ|धुआं|धूर|जळत|जल रहा|जल रही|धमाका|स्फोट/,
    /\b(aag|dhuan|dhua|dhamaka)\b/i,
  ],
  gas: [
    /\bgas\s*(leak|leaking|leakage|smell|smelling)|smell\s*(of|like)?\s*gas|gas\s*cylinder\s*(leak|fire)|lpg\s*leak/i,
    /गैस\s*(रिसाव|लीक|की\s*बदबू|की\s*गंध|का\s*वास|चा\s*वास|गळती|सिलेंडर)|गॅस\s*(गळती|लीक|चा\s*वास|चा\s*वास|सिलेंडर|रिसाव)|गॅसचा\s*वास|गैस\s*लीक/,
    /\bgas\s*(leak|smell|ki\s*badbu|ka\s*smell)\b/i,
  ],
  lift_trapped: [
    /\b(stuck|trapped|struck|locked|stranded)\b.{0,25}\b(lift|elevator)\b|\b(lift|elevator)\b.{0,30}\b(stuck|trapped|struck|stopped between|fell|free ?fall|door won'?t open)\b/i,
    /लिफ्ट\s*(में|मध्ये|मधे|मे)\s*(फंस|फँस|अडक|अटक)|लिफ्ट\s*(अटक|अडक|रुक|बंद)|(फंस|फँस|अडक)\w*\s*लिफ्ट/,
    /\blift\s*(mein|me|madhe)\s*(fas|fass|adak|atak)/i,
  ],
  electric: [
    /\b(electric(al)?\s*shock|electrocut\w*|got\s*a\s*shock|short[\s-]*circuit|sparking|sparks?|live wire|wire\s*(fell|hanging)|current\s*(in|leak)\w*)\b/i,
    /बिजली\s*का\s*झटका|विजेचा\s*धक्का|करंट|शॉर्ट\s*सर्किट|शॉर्टसर्किट|चिंगारी|ठिणग्या|तार\s*(गिर|तुट|तूट)/,
    /\b(bijli\s*ka\s*jhatka|current\s*laga|short\s*circuit)\b/i,
  ],
  flood: [
    /\b(flood|flooded|flooding|water\s*logging|waterlogging|water\s*(is\s*)?(entering|gushing)|pipe\s*burst|burst\s*pipe)\b/i,
    /बाढ़|बाढ|पानी\s*भर|पानी\s*घुस|पाइप\s*फट|पूर|पाणी\s*साचल|पाणी\s*शिरल|पाईप\s*फुट/,
    /\b(pani\s*bhar|baadh|paani\s*bhar)\b/i,
  ],
  collapse: [
    /\b(collapse[ds]?|collapsing|caved? in|ceiling\s*(fell|came down)|slab\s*(fell|crack)\w*|wall\s*(fell|crack(ed)?|collapsed)|balcony\s*(fell|crack\w*))\b/i,
    /ढह|गिर\s*गई?\s*(दीवार|छत)|छत\s*गिर|दीवार\s*गिर|कोसळ|भिंत\s*पडल|छत\s*कोसळ/,
  ],
  medical: [
    /\b(heart\s*attack|unconscious|not\s*breathing|collapsed\s*and|bleeding\s*heavily|ambulance|choking|seizure)\b/i,
    /बेहोश|हार्ट\s*अटैक|सांस\s*नहीं|एम्बुलेंस|ॲम्ब्युलन्स|बेशुद्ध|हृदयविकाराचा/,
  ],
}

const SAFETY_TEXT: Record<SafetyKind, string> = {
  fire: 'fire or smoke',
  gas: 'gas leak or gas smell',
  lift_trapped: 'someone stuck in a lift',
  electric: 'electric shock or short circuit',
  flood: 'flooding or a burst pipe',
  collapse: 'structural collapse',
  medical: 'a medical emergency',
}

/** Category a safety incident belongs to when the model cannot be asked. */
const SAFETY_CATEGORY: Record<SafetyKind, Category> = {
  fire: 'SECURITY', gas: 'SECURITY', lift_trapped: 'LIFT', electric: 'ELECTRICAL', flood: 'PLUMBING', collapse: 'SECURITY', medical: 'SECURITY',
}

export interface SafetyHit {
  kind: SafetyKind
  reason: string
  defaultCategory: Category
}

export function detectSafety(text: string): SafetyHit | null {
  const t = text.normalize('NFC')
  for (const kind of Object.keys(SAFETY) as SafetyKind[]) {
    if (SAFETY[kind].some((re) => re.test(t))) {
      return { kind, reason: `Safety rule: mentions ${SAFETY_TEXT[kind]}`, defaultCategory: SAFETY_CATEGORY[kind] }
    }
  }
  return null
}

const KEYWORDS: Record<Exclude<Category, 'OTHER'>, RegExp> = {
  PLUMBING: /\b(leak\w*|tap|faucet|pipe\w*|drain\w*|clog\w*|sewage|toilet|flush|seepage|overflow\w*|plumb\w*)\b|नल|पाइप|लीकेज|टपक|गळ|नळ|पाईप|नाला|ड्रेनेज/i,
  ELECTRICAL: /\b(light\w*|bulb|switch\w*|socket|fuse|mcb|power\s*(cut|out)|no\s*power|electric\w*|wiring|fan|inverter|streetlight|tripping)\b|बिजली|लाइट|बत्ती|पंखा|वीज|दिवा|पंखा|स्विच/i,
  LIFT: /\b(lift|elevator)\b|लिफ्ट/i,
  SECURITY: /\b(security|guard|theft|stolen|thief|intruder|gate|cctv|suspicious|trespass\w*|burglar\w*|visitor)\b|चोरी|गार्ड|सुरक्षा|संशयित|चोर|गेट/i,
  HOUSEKEEPING: /\b(garbage|trash|dustbin|waste|clean\w*|dirty|sweep\w*|stink|smell|housekeeping|mop\w*|cobweb|pest|cockroach\w*|mosquito\w*)\b|कचरा|सफाई|गंदगी|साफसफाई|कचरा|घाण|झाडू/i,
  PARKING: /\b(park\w*|vehicle|car\s*(blocked|stuck)|bike|two[\s-]*wheeler|slot|towing|blocking)\b|पार्किंग|गाड़ी|गाडी|वाहन/i,
  NOISE: /\b(noise|noisy|loud|music|party|drill\w*|construction\s*noise|shouting|barking|honking)\b|शोर|आवाज|गोंगाट|कोलाहल|आवाज़/i,
  WATER_SUPPLY: /\b(water\s*(supply|pressure|tank|shortage|not\s*coming|timing)|no\s*water|low\s*pressure|borewell|tanker|motor|pump)\b|पानी\s*(नहीं|कम|की\s*सप्लाई)|पाणी\s*(नाही|कमी|पुरवठा)|टैंकर|टँकर/i,
  GARDEN: /\b(garden|lawn|plants?|tree\w*|grass|park\s*area|sprinkler|landscap\w*|branch(es)?)\b|बगीचा|पेड़|बाग|झाड|उद्यान/i,
}

export interface RuleClass {
  category: Category
  urgency: Urgency
  reason: string
  language: 'en' | 'hi' | 'mr'
  matched: boolean
}

export function detectLanguage(text: string): 'en' | 'hi' | 'mr' {
  if (!/[ऀ-ॿ]/.test(text)) return 'en'
  // Marathi-leaning function words and endings
  return /\b(आहे|नाही|आहेत|झाले|झाली|मध्ये|माझ्या|कृपया|होत)\b|आहे|नाही|मध्ये/.test(text) ? 'mr' : 'hi'
}

const HIGH_WORDS = /\b(urgent|immediately|asap|emergency|no water|no power|power\s*cut|not working|broken|overflow\w*|sewage|theft|stolen|intruder)\b|तुरंत|जल्दी|तातडीने|लगेच|चोरी/i
const LOW_WORDS = /\b(suggestion|request|minor|whenever|small|when possible|please consider)\b|सुझाव|विनंती/i

export function classifyByRules(text: string): RuleClass {
  const language = detectLanguage(text)
  const scores = (Object.entries(KEYWORDS) as [Exclude<Category, 'OTHER'>, RegExp][]).map(([c, re]) => {
    const m = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))
    return { c, n: m ? m.length : 0 }
  })
  scores.sort((a, b) => b.n - a.n)
  const best = scores[0]
  const urgency: Urgency = HIGH_WORDS.test(text) ? 'HIGH' : LOW_WORDS.test(text) ? 'LOW' : 'NORMAL'
  if (!best || best.n === 0)
    return { category: 'OTHER', urgency, reason: 'No keyword matched, sent to the help desk to sort', language, matched: false }
  return { category: best.c, urgency, reason: `Keyword match for ${best.c.toLowerCase().replace('_', ' ')}`, language, matched: true }
}
