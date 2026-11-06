import type { ReminderKind } from '@prisma/client'

export type Lang = 'en' | 'hi' | 'mr'
export interface ReminderVars { name: string; flatId: string; period: string; amountPaise: number; dueDate: string; daysOverdue: number }

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n

/** Reminder wording in the three supported languages. No link, OTP or account detail goes in the text. */
const T: Record<Lang, Record<ReminderKind, (v: { n: string; f: string; p: string; a: string; d: string; o: number }) => string>> = {
  en: {
    BEFORE_DUE: (v) => `Hello ${v.n}, the maintenance bill for ${v.p} for flat ${v.f} (${v.a}) is due on ${v.d}. Pay in the Nivaas app before then to avoid a late fee.`,
    ON_DUE: (v) => `Hello ${v.n}, the maintenance bill for ${v.p} for flat ${v.f} (${v.a}) is due today. Pay in the Nivaas app to avoid a late fee.`,
    OVERDUE: (v) => `Hello ${v.n}, the maintenance bill for ${v.p} for flat ${v.f} is ${v.o} days overdue (${v.a} including late fee). Please pay in the Nivaas app or contact the help desk.`,
  },
  hi: {
    BEFORE_DUE: (v) => `नमस्ते ${v.n}, फ्लैट ${v.f} का ${v.p} का मेंटेनेंस बिल (${v.a}) ${v.d} को देय है। लेट फीस से बचने के लिए तब तक Nivaas ऐप में भुगतान करें।`,
    ON_DUE: (v) => `नमस्ते ${v.n}, फ्लैट ${v.f} का ${v.p} का मेंटेनेंस बिल (${v.a}) आज देय है। लेट फीस से बचने के लिए Nivaas ऐप में भुगतान करें।`,
    OVERDUE: (v) => `नमस्ते ${v.n}, फ्लैट ${v.f} का ${v.p} का मेंटेनेंस बिल ${v.o} दिन से बकाया है (लेट फीस सहित ${v.a})। कृपया Nivaas ऐप में भुगतान करें या हेल्प डेस्क से संपर्क करें।`,
  },
  mr: {
    BEFORE_DUE: (v) => `नमस्कार ${v.n}, फ्लॅट ${v.f} चे ${v.p} चे देखभाल शुल्क (${v.a}) ${v.d} रोजी देय आहे. उशीर शुल्क टाळण्यासाठी तोपर्यंत Nivaas ॲपमध्ये भरा.`,
    ON_DUE: (v) => `नमस्कार ${v.n}, फ्लॅट ${v.f} चे ${v.p} चे देखभाल शुल्क (${v.a}) आज देय आहे. उशीर शुल्क टाळण्यासाठी Nivaas ॲपमध्ये भरा.`,
    OVERDUE: (v) => `नमस्कार ${v.n}, फ्लॅट ${v.f} चे ${v.p} चे देखभाल शुल्क ${v.o} दिवस थकले आहे (उशीर शुल्कासह ${v.a}). कृपया Nivaas ॲपमध्ये भरा किंवा हेल्प डेस्कशी संपर्क साधा.`,
  },
}

export const asLang = (l: string): Lang => (l === 'hi' || l === 'mr' ? l : 'en')

export function reminderText(kind: ReminderKind, lang: string, v: ReminderVars): string {
  return T[asLang(lang)][kind]({ n: firstName(v.name), f: v.flatId, p: v.period, a: rupees(v.amountPaise), d: v.dueDate, o: v.daysOverdue })
}
