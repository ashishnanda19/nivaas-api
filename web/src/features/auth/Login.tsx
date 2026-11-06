import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { User } from '@/lib/api'
import { homeFor, useSession } from '@/app/store'
import { Button, Input, LanguageSwitcher, toast } from '@/components/ui'
import { OtpInput } from '@/components/OtpInput'

export default function Login() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { user, consent, giveConsent, login } = useSession()
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [agree, setAgree] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  if (user) return <Navigate to={homeFor(user)} replace />

  const needsConsent = !consent
  const finish = async (u: User) => {
    if (u.role === 'resident' && needsConsent && !agree && u.consent !== true) {
      setErr(t('auth.consentRequired'))
      return
    }
    // A real backend refuses every request until consent is on record.
    if (u.consent === false) await api.recordConsent()
    if (agree) giveConsent()
    login(u)
    nav(homeFor(u))
  }

  const sendOtp = () => {
    if (!/^[6-9]\d{9}$/.test(phone)) return setErr(t('auth.invalidPhone'))
    setErr('')
    setBusy(true)
    api
      .requestOtp(phone)
      .then(() => {
        setStep('otp')
        setWait(30)
        if (!import.meta.env.PROD) toast.info('Demo: your code is 123456')
      })
      .catch((e) => setErr(e instanceof Error ? e.message : t('auth.wrongOtp')))
      .finally(() => setBusy(false))
  }
  // The demo buttons sign in through the same OTP calls, so they work against a real backend too.
  const demoLogin = async (u: User) => {
    setBusy(true)
    setErr('')
    try {
      await api.requestOtp(u.phone)
      await finish(await api.verifyOtp(u.phone, '123456'))
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('auth.wrongOtp'))
    } finally {
      setBusy(false)
    }
  }
  const verify = async () => {
    setBusy(true)
    setErr('')
    try {
      const u = await api.verifyOtp(phone, otp)
      await finish(u)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('auth.wrongOtp'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-sunken">
      <div className="mx-auto flex min-h-dvh max-w-[440px] flex-col gap-8 bg-bg px-6 py-8 md:my-0 md:border-x md:border-line">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">Nivaas</span>
          <LanguageSwitcher />
        </div>

        <section className="space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold">{t('auth.title')}</h1>
            <p className="text-sm text-muted">
              {step === 'phone' ? t('auth.subtitle') : t('auth.otpSent', { phone })}
            </p>
          </div>

          {step === 'phone' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                sendOtp()
              }}
              className="space-y-4"
            >
              <Input
                label={t('auth.mobile')}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                value={phone}
                placeholder="98000 00001"
                error={err && !otp ? err : undefined}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              />
              <Button type="submit" block>
                {t('auth.getOtp')}
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (otp.length === 6) void verify()
              }}
              className="space-y-4"
            >
              <p className="text-sm font-medium">{t('auth.enterOtp')}</p>
              <OtpInput value={otp} onChange={setOtp} label={t('auth.enterOtp')} invalid={!!err} />
              {err && (
                <p role="alert" className="text-sm text-danger">
                  {err}
                </p>
              )}
              <Button type="submit" block loading={busy} disabled={otp.length < 6}>
                {t('auth.verify')}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="min-h-[44px] text-muted hover:text-fg"
                  onClick={() => {
                    setStep('phone')
                    setOtp('')
                    setErr('')
                  }}
                >
                  {t('auth.changeNumber')}
                </button>
                <button
                  type="button"
                  disabled={wait > 0}
                  className="min-h-[44px] font-medium text-ink disabled:text-muted"
                  onClick={() => {
                    setWait(30)
                    toast.info('Demo: your code is 123456')
                  }}
                >
                  {wait > 0 ? t('auth.resendIn', { s: wait }) : t('auth.resend')}
                </button>
              </div>
            </form>
          )}

          {needsConsent && (
            <label className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-muted">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => {
                  setAgree(e.target.checked)
                  setErr('')
                }}
                className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600"
              />
              {t('auth.consent')}
            </label>
          )}
          {err && step === 'phone' && needsConsent && err === t('auth.consentRequired') && (
            <p role="alert" className="text-sm text-danger">
              {err}
            </p>
          )}
        </section>

        <section className="mt-auto space-y-3">
          <div>
            <h2 className="text-sm font-semibold">{t('auth.demo')}</h2>
            <p className="text-xs text-muted">{t('auth.demoHint')}</p>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
            {api.demoUsers().map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => void demoLogin(u)}
                  className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 text-left transition hover:bg-sunken"
                >
                  <span>
                    <span className="block text-sm font-medium">{u.name}</span>
                    <span className="block text-xs text-muted">
                      {u.role === 'resident' ? `${u.memberRole}, ${u.flatId}` : u.title}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
