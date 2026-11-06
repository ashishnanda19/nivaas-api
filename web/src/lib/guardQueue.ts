import { useEffect, useSyncExternalStore } from 'react'
import { api } from './api'
import type { Visitor } from './api'
import { useOnline } from './hooks'

/** Entries saved on the tablet while the network is down. They sync when it returns. */
export type QueueItem =
  | {
      kind: 'visitor'
      clientId: string
      createdAt: string
      input: Pick<Visitor, 'gateId' | 'flatId' | 'name' | 'phone' | 'purpose' | 'photo'>
    }
  | { kind: 'code'; clientId: string; createdAt: string; code: string; gateId: string }

const KEY = 'nivaas.guard.queue'
const listeners = new Set<() => void>()
let snapshot: QueueItem[] | null = null

function read(): QueueItem[] {
  if (snapshot) return snapshot
  try {
    snapshot = JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueueItem[]
  } catch {
    snapshot = []
  }
  return snapshot
}
function write(items: QueueItem[]) {
  snapshot = items
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* storage full: keep in memory */
  }
  listeners.forEach((l) => l())
}
export const enqueue = (item: QueueItem) => write([...read(), item])
export const useQueue = () =>
  useSyncExternalStore((l) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }, read)

let syncing = false
export async function syncQueue(): Promise<number> {
  if (syncing) return 0
  syncing = true
  let done = 0
  try {
    for (const item of read()) {
      try {
        if (item.kind === 'visitor')
          await api.createVisitor({ ...item.input, id: item.clientId, createdAt: item.createdAt })
        else await api.verifyCode(item.code, item.gateId).catch(() => undefined) // a used or wrong code is dropped, not retried forever
        write(read().filter((i) => i.clientId !== item.clientId))
        done++
      } catch {
        break // network still down: try again later
      }
    }
  } finally {
    syncing = false
  }
  return done
}

export function useGuardSync() {
  const online = useOnline()
  const count = useQueue().length
  useEffect(() => {
    if (!online || !count) return
    void syncQueue()
    const id = setInterval(() => void syncQueue(), 8000)
    return () => clearInterval(id)
  }, [online, count])
}
