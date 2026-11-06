const KEY = 'nivaas.dev.settings'
interface Settings {
  flaky: boolean // occasionally fail reads so error states can be seen
  autoRespond: boolean // demo: waiting visitors get an automatic answer after 12 s
  offline: boolean // simulate a dropped network
}
const defaults: Settings = { flaky: true, autoRespond: true, offline: false }
let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  try {
    cache = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    cache = { ...defaults }
  }
  return cache!
}
export function setSettings(patch: Partial<Settings>) {
  cache = { ...getSettings(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l())
}
const listeners = new Set<() => void>()
export const subscribeSettings = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
