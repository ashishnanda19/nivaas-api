import { useRef } from 'react'
import { Camera, X } from 'lucide-react'
import { Button, toast } from '@/components/ui'
import { fileToSmallDataUrl } from '@/lib/hooks'

export function PhotoPicker({
  value,
  onChange,
  addLabel,
  removeLabel,
  tooBig,
}: {
  value?: string
  onChange: (v?: string) => void
  addLabel: string
  removeLabel: string
  tooBig: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const pick = async (f?: File) => {
    if (!f) return
    if (f.size > 8 * 1024 * 1024) return toast.error(tooBig)
    try {
      onChange(await fileToSmallDataUrl(f, 640))
    } catch {
      toast.error(tooBig)
    }
  }
  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {value ? (
        <div className="relative inline-block">
          <img src={value} alt="" className="h-28 w-28 rounded-card border border-line object-cover" />
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label={removeLabel}
            className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface shadow-sm"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => ref.current?.click()}>
          <Camera className="h-4 w-4" aria-hidden />
          {addLabel}
        </Button>
      )}
    </div>
  )
}
