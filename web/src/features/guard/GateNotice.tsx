import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** The DPDP notice a visitor can read at the gate. Shown wherever the guard is about to take a photo or a phone number. */
export function GateNotice() {
  const { t } = useTranslation()
  return (
    <p className="flex items-start gap-2 text-base text-muted" role="note">
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      {t('guard.privacyNotice')}
    </p>
  )
}
