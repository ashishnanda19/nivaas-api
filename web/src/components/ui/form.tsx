import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react'
import clsx from 'clsx'

const control =
  'w-full rounded-ctl border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted transition duration-150 hover:border-line-strong disabled:opacity-50 aria-[invalid=true]:border-danger'

interface FieldProps {
  label: string
  hint?: string
  error?: string
  optionalLabel?: string
  className?: string
  children: (id: string, describedBy?: string) => ReactNode
}
export function Field({ label, hint, error, optionalLabel, className, children }: FieldProps) {
  const id = useId()
  const desc = error || hint ? `${id}-d` : undefined
  return (
    <div className={clsx('space-y-1.5', className)}>
      <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium">
        {label}
        {optionalLabel && <span className="text-xs font-normal text-muted">{optionalLabel}</span>}
      </label>
      {children(id, desc)}
      {(error || hint) && (
        <p
          id={desc}
          className={clsx('text-xs', error ? 'text-danger' : 'text-muted')}
          role={error ? 'alert' : undefined}
        >
          {error || hint}
        </p>
      )}
    </div>
  )
}

type Common = {
  label: string
  hint?: string
  error?: string
  optionalLabel?: string
  wrapperClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, optionalLabel, wrapperClassName, className, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} optionalLabel={optionalLabel} className={wrapperClassName}>
      {(id, d) => (
        <input
          ref={ref}
          id={id}
          aria-describedby={d}
          aria-invalid={!!error}
          className={clsx(control, 'min-h-[44px]', className)}
          {...rest}
        />
      )}
    </Field>
  )
})
export type InputProps = InputHTMLAttributes<HTMLInputElement> & Common

export function Select({
  label,
  hint,
  error,
  optionalLabel,
  wrapperClassName,
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & Common) {
  return (
    <Field label={label} hint={hint} error={error} optionalLabel={optionalLabel} className={wrapperClassName}>
      {(id, d) => (
        <select
          id={id}
          aria-describedby={d}
          aria-invalid={!!error}
          className={clsx(control, 'min-h-[44px]', className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  )
}

export function Textarea({
  label,
  hint,
  error,
  optionalLabel,
  wrapperClassName,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & Common) {
  return (
    <Field label={label} hint={hint} error={error} optionalLabel={optionalLabel} className={wrapperClassName}>
      {(id, d) => (
        <textarea
          id={id}
          aria-describedby={d}
          aria-invalid={!!error}
          className={clsx(control, 'min-h-[96px] py-2.5', className)}
          {...rest}
        />
      )}
    </Field>
  )
}
