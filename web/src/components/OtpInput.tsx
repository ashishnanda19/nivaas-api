import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import clsx from 'clsx'

/** Six boxes: auto-advance, backspace goes back, paste fills all. */
export function OtpInput({
  value,
  onChange,
  label,
  invalid,
  large,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  invalid?: boolean
  large?: boolean
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '')
  const set = (i: number, d: string) => {
    const next = digits.slice()
    next[i] = d
    onChange(next.join('').slice(0, 6))
  }
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      set(i - 1, '')
      refs.current[i - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus()
  }
  const onPaste = (e: ClipboardEvent) => {
    const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!t) return
    e.preventDefault()
    onChange(t)
    refs.current[Math.min(t.length, 5)]?.focus()
  }
  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2" onPaste={onPaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`${label} ${i + 1}`}
          aria-invalid={invalid}
          onChange={(e) => {
            const c = e.target.value.replace(/\D/g, '').slice(-1)
            set(i, c)
            if (c && i < 5) refs.current[i + 1]?.focus()
          }}
          onKeyDown={(e) => onKey(i, e)}
          onFocus={(e) => e.target.select()}
          className={clsx(
            'w-full rounded-ctl border bg-surface text-center font-semibold tabular-nums transition',
            large ? 'h-16 text-2xl' : 'h-14 text-xl',
            invalid ? 'border-danger' : 'border-line hover:border-line-strong',
          )}
        />
      ))}
    </div>
  )
}
