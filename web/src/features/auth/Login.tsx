import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Building2, ChevronRight, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { api } from '@/lib/api'
import type { Role, User } from '@/lib/api'
import { homeFor, useSession } from '@/app/store'
import { Button, Input, LanguageSwitcher, toast } from '@/components/ui'
import { OtpInput } from '@/components/OtpInput'

const initials = (name: string) =>
  name
    .split(' ')
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

const roleStyle: Record<Role, string> = {
  resident: 'bg-accent-tint text-ink',
  helpdesk: 'bg-amber-100 text-amber-800',
  committee: 'bg-emerald-100 text-emerald-800',
  guard: 'bg-slate-800 text-slate-100',
}

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
  // Which demo account is signing in, and whether it is taking long enough to explain why.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const [consentMissing, setConsentMissing] = useState(false)
  const consentRef = useRef<HTMLInputElement>(null)

  // Back from the sign-in screen goes to the home page, not out of the site or to whatever was open before.
  useEffect(() => {
    const home = () => nav('/', { replace: true })
    // One extra history entry, so the first Back press is caught here even when the page was opened directly.
    window.history.pushState(window.history.state, '')
    window.addEventListener('popstate', home)
    return () => window.removeEventListener('popstate', home)
  }, [nav])

  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  useEffect(() => {
    if (!busyId) return
    const id = setTimeout(() => setSlow(true), 3500)
    return () => clearTimeout(id)
  }, [busyId])

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
    if (busyId) return
    // A resident must accept the data notice first. Say so where the person is looking, and take them to the box.
    if (u.role === 'resident' && needsConsent && !agree) {
      setConsentMissing(true)
      consentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      consentRef.current?.focus({ preventScroll: true })
      return
    }
    setBusyId(u.id)
    setErr('')
    try {
      await api.requestOtp(u.phone)
      await finish(await api.verifyOtp(u.phone, '123456'))
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('auth.wrongOtp'))
    } finally {
      setBusyId(null)
      setSlow(false)
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

  const roleLabel: Record<Role, string> = {
    resident: t('auth.roleResident'),
    helpdesk: t('auth.roleHelpdesk'),
    committee: t('auth.roleCommittee'),
    guard: t('auth.roleGuard'),
  }
  const signingUser = api.demoUsers().find((u) => u.id === busyId)

  return (
    <div className="min-h-dvh bg-sunken">
      <div className="mx-auto flex min-h-dvh max-w-[440px] flex-col gap-6 bg-bg px-5 py-6 md:border-x md:border-line md:px-6 md:py-8">
        <header className="flex items-center justify-between">
          <Link to="/" aria-label="Nivaas home" className="flex min-h-[44px] items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
              <Building2 className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-lg font-semibold tracking-tight">Nivaas</span>
          </Link>
          <LanguageSwitcher />
        </header>

        <section className="rounded-card border border-line bg-surface p-5 shadow-sm">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold">{t('auth.title')}</h1>
            <p className="text-sm text-muted">
              {step === 'phone' ? t('auth.subtitle') : t('auth.otpSent', { phone })}
            </p>
          </div>

          <div className="mt-5 space-y-4">
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
                  error={err && !otp && err !== t('auth.consentRequired') ? err : undefined}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                />
                <Button type="submit" block loading={busy}>
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
              <label
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-ctl border p-3 text-xs leading-relaxed transition',
                  consentMissing && !agree
                    ? 'border-danger bg-danger/5 text-fg'
                    : 'border-line bg-sunken text-muted',
                )}
              >
                <input
                  ref={consentRef}
                  type="checkbox"
                  checked={agree}
                  onChange={(e) => {
                    setAgree(e.target.checked)
                    setConsentMissing(false)
                    setErr('')
                  }}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600"
                />
                <span>
                  {t('auth.consent')}
                  {consentMissing && !agree && (
                    <span role="alert" className="mt-1 block font-medium text-danger">
                      {t('auth.consentFirst')}
                    </span>
                  )}
                </span>
              </label>
            )}
            {err === t('auth.consentRequired') && (
              <p role="alert" className="text-sm text-danger">
                {err}
              </p>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">{t('auth.demo')}</h2>
            <p className="text-xs text-muted">{t('auth.demoHint')}</p>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-sm">
            {api.demoUsers().map((u) => {
              const mine = busyId === u.id
              return (
                <li key={u.id}>
                  <button
                    onClick={() => void demoLogin(u)}
                    disabled={!!busyId && !mine}
                    aria-busy={mine}
                    className={clsx(
                      'flex min-h-[64px] w-full items-center gap-3 px-4 text-left transition',
                      mine ? 'bg-accent-tint' : 'hover:bg-sunken active:bg-sunken',
                      !!busyId && !mine && 'opacity-50',
                    )}
                  >
                    <span
                      className={clsx(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                        roleStyle[u.role],
                      )}
                      aria-hidden
                    >
                      {initials(u.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{u.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {roleLabel[u.role]}
                        {' · '}
                        {u.role === 'resident' ? `${u.memberRole}, ${u.flatId}` : u.title}
                      </span>
                    </span>
                    {mine ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-ink" aria-hidden />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          <div aria-live="polite" className="min-h-[20px] text-xs text-muted">
            {signingUser && (
              <p className="flex items-center gap-2 font-medium text-fg">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t('auth.signingIn', { name: signingUser.name })}
              </p>
            )}
            {signingUser && slow && <p className="mt-1">{t('auth.wake')}</p>}
            {!busyId && err && err !== t('auth.consentRequired') && step === 'phone' && !phone && (
              <p role="alert" className="text-danger">
                {err}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
