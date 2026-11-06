import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, CheckCircle2, AlertCircle } from 'lucide-react'
import { create } from 'zustand'
import clsx from 'clsx'
import { useIsDesktop } from '@/lib/hooks'

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && ref.current) {
        const els = ref.current.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
        )
        if (!els.length) return
        const first = els[0],
          last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(
      () =>
        ref.current
          ?.querySelector<HTMLElement>('input,textarea,select,button:not([data-close])')
          ?.focus({ preventScroll: true }),
      60,
    )
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open, onClose])
  return ref
}

interface OverlayProps {
  open: boolean
  onClose: () => void
  title: string
  closeLabel?: string
  children: ReactNode
  footer?: ReactNode
}

/** Bottom sheet on mobile, side drawer on desktop. */
export function Sheet({ open, onClose, title, closeLabel = 'Close', children, footer }: OverlayProps) {
  const desktop = useIsDesktop()
  const ref = useDialog(open, onClose)
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-slate-950/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={desktop ? { x: '100%' } : { y: '100%' }}
            animate={desktop ? { x: 0 } : { y: 0 }}
            exit={desktop ? { x: '100%' } : { y: '100%' }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={clsx(
              'absolute flex flex-col bg-surface shadow-float',
              desktop
                ? 'inset-y-0 right-0 w-[480px] max-w-full border-l border-line'
                : 'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl border-t border-line',
            )}
          >
            <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
              <h2 className="text-base font-semibold">{title}</h2>
              <button
                data-close
                onClick={onClose}
                aria-label={closeLabel}
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-ctl text-muted hover:bg-sunken"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <footer className="safe-bottom border-t border-line px-5 py-3">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function Modal({ open, onClose, title, closeLabel = 'Close', children, footer }: OverlayProps) {
  const ref = useDialog(open, onClose)
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-slate-950/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="relative w-full max-w-md rounded-card border border-line bg-surface shadow-float"
          >
            <header className="flex items-center justify-between px-5 pt-4">
              <h2 className="text-base font-semibold">{title}</h2>
              <button
                data-close
                onClick={onClose}
                aria-label={closeLabel}
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-ctl text-muted hover:bg-sunken"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="px-5 py-3">{children}</div>
            {footer && <footer className="flex justify-end gap-2 px-5 pb-4">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

interface ToastItem {
  id: number
  message: string
  tone: 'success' | 'danger' | 'neutral'
}
const useToasts = create<{
  items: ToastItem[]
  push: (t: Omit<ToastItem, 'id'>) => void
  drop: (id: number) => void
}>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random()
    set((s) => ({ items: [...s.items, { ...t, id }] }))
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 3800)
  },
  drop: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}))
export const toast = {
  success: (message: string) => useToasts.getState().push({ message, tone: 'success' }),
  error: (message: string) => useToasts.getState().push({ message, tone: 'danger' }),
  info: (message: string) => useToasts.getState().push({ message, tone: 'neutral' }),
}

export function Toaster() {
  const { items, drop } = useToasts()
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
      aria-live="polite"
    >
      <AnimatePresence>
        {items.map((t) => (
          <motion.button
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18 }}
            onClick={() => drop(t.id)}
            className="pointer-events-auto flex max-w-sm items-center gap-2 rounded-ctl border border-line bg-surface px-4 py-3 text-left text-sm shadow-float"
          >
            {t.tone === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
            ) : t.tone === 'danger' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
            ) : null}
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
