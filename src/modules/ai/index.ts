import { config } from '../../lib/config.js'

export function aiMode(): 'gemini+groq+rules' | 'gemini+rules' | 'groq+rules' | 'rules-only' {
  const g = !!config.GEMINI_API_KEY
  const q = !!config.GROQ_API_KEY
  if (g && q) return 'gemini+groq+rules'
  if (g) return 'gemini+rules'
  if (q) return 'groq+rules'
  return 'rules-only'
}
