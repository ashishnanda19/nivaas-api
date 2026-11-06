import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import { fileToSmallDataUrl } from '@/lib/hooks'

/** Live camera capture with a file-picker fallback (desktops, denied permission, offline kiosks). */
export function CameraCapture({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const { t } = useTranslation()
  const video = useRef<HTMLVideoElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [live, setLive] = useState(false)
  const [blocked, setBlocked] = useState(() => !navigator.mediaDevices)

  useEffect(() => {
    if (value) return
    let stream: MediaStream | undefined
    let cancelled = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: 640 }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((x) => x.stop())
        stream = s
        if (video.current) video.current.srcObject = s
        setLive(true)
      })
      .catch(() => setBlocked(true))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((x) => x.stop())
      setLive(false)
    }
  }, [value])

  const snap = () => {
    const v = video.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    const k = Math.min(1, 360 / Math.max(v.videoWidth, v.videoHeight))
    c.width = v.videoWidth * k
    c.height = v.videoHeight * k
    const ctx = c.getContext('2d')!
    try {
      ctx.filter = 'brightness(1.15) contrast(1.1)'
    } catch {
      /* unsupported: keep as is */
    } // reads better at night
    ctx.drawImage(v, 0, 0, c.width, c.height)
    onChange(c.toDataURL('image/jpeg', 0.7))
  }

  if (value)
    return (
      <div className="space-y-3">
        <img
          src={value}
          alt=""
          className="mx-auto aspect-[4/3] w-full max-w-md rounded-card border border-line object-cover"
        />
        <Button variant="secondary" size="lg" block onClick={() => onChange(undefined)}>
          {t('guard.retake')}
        </Button>
      </div>
    )
  return (
    <div className="space-y-3">
      <input
        ref={file}
        type="file"
        accept="image/*"
        capture="user"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) onChange(await fileToSmallDataUrl(f))
          e.target.value = ''
        }}
      />
      {!blocked && (
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          className="mx-auto aspect-[4/3] w-full max-w-md rounded-card border border-line bg-sunken object-cover"
        />
      )}
      {blocked && (
        <p className="rounded-card border border-line bg-sunken p-4 text-center text-sm text-muted">
          {t('guard.cameraBlocked')}
        </p>
      )}
      {live && (
        <Button size="lg" block onClick={snap}>
          <Camera className="h-6 w-6" aria-hidden />
          {t('guard.takePhoto')}
        </Button>
      )}
      {blocked && (
        <Button size="lg" block onClick={() => file.current?.click()}>
          <Camera className="h-6 w-6" aria-hidden />
          {t('guard.choosePhoto')}
        </Button>
      )}
    </div>
  )
}
