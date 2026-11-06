import { useEffect, useState, useSyncExternalStore } from 'react'
import { getSettings, subscribeSettings } from './api/settings'

export function useMedia(query: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return m
}
export const useIsDesktop = () => useMedia('(min-width: 768px)')

/** Real network state, or the dev-menu simulated offline switch. */
export function useOnline() {
  const [net, setNet] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setNet(true)
    const down = () => setNet(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  const simulated = useSyncExternalStore(subscribeSettings, () => getSettings().offline)
  return net && !simulated
}

export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Downscale a photo to a small JPEG data URL so it is cheap to store and fast to show. */
export function fileToSmallDataUrl(file: Blob, max = 360): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k)
      c.height = Math.round(img.height * k)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read the image'))
    }
    img.src = url
  })
}
