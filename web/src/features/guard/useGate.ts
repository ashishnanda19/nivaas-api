import { useState } from 'react'
import { api } from '@/lib/api'

const KEY = 'nivaas.guard.gate'
export function useGate() {
  const [gate, setGate] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? api.gates()[0]
    } catch {
      return api.gates()[0]
    }
  })
  const set = (g: string) => {
    setGate(g)
    try {
      localStorage.setItem(KEY, g)
    } catch {
      /* ignore */
    }
  }
  return [gate, set] as const
}
