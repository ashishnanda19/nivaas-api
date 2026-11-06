import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, DoorOpen, Landmark, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, LanguageSwitcher } from '@/components/ui'

const fade = {
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.25, ease: 'easeOut' as const },
}

function PhoneMock() {
  return (
    <div
      className="mx-auto w-[260px] rounded-[36px] border border-line-strong bg-surface p-3 shadow-float"
      aria-hidden
    >
      <div className="space-y-3 rounded-[26px] bg-bg p-4">
        <p className="text-sm font-semibold">Hello, Neeraj</p>
        {[
          ['Dues', '₹5,719', 'Due in 5 days', 'text-warning'],
          ['Open complaints', '1', 'Assigned to Ramesh', 'text-ink'],
          ['Today’s visitors', '2', '1 waiting for you', 'text-success'],
        ].map(([a, b, c, tone]) => (
          <div key={a} className="rounded-xl border border-line p-3">
            <p className="text-[11px] text-muted">{a}</p>
            <p className="text-xl font-semibold tabular-nums">{b}</p>
            <p className={`text-[11px] ${tone}`}>{c}</p>
          </div>
        ))}
        <div className="rounded-lg bg-accent py-2 text-center text-xs font-medium text-white">Pay now</div>
      </div>
    </div>
  )
}

export default function Landing() {
  const { t } = useTranslation()
  const features = [
    { icon: Landmark, title: t('landing.f1t'), body: t('landing.f1b') },
    { icon: MessageSquare, title: t('landing.f2t'), body: t('landing.f2b') },
    { icon: DoorOpen, title: t('landing.f3t'), body: t('landing.f3b') },
  ]
  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">Nivaas</span>
        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          <Link to="/login">
            <Button variant="secondary">{t('landing.login')}</Button>
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 md:grid-cols-2 md:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            <h1 className="text-4xl font-semibold leading-[1.1] md:text-6xl">{t('landing.hero')}</h1>
            <p className="max-w-md text-lg text-muted">{t('landing.heroBody')}</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/login">
                <Button size="md" className="px-6">
                  {t('landing.cta')}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </Link>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <PhoneMock />
          </motion.div>
        </section>

        <section className="border-y border-line bg-sunken">
          <dl className="mx-auto grid max-w-6xl grid-cols-3 gap-4 px-6 py-10 text-center">
            {[
              ['2,400', t('landing.flats')],
              ['28', t('landing.towers')],
              ['4', t('landing.gates')],
            ].map(([n, l]) => (
              <div key={l}>
                <dt className="sr-only">{l}</dt>
                <dd className="text-3xl font-semibold tabular-nums md:text-5xl">{n}</dd>
                <dd className="text-sm text-muted">{l}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mx-auto max-w-6xl divide-y divide-line px-6">
          {features.map(({ icon: Icon, title, body }, i) => (
            <motion.div key={title} {...fade} className="grid items-center gap-6 py-14 md:grid-cols-2">
              <div className={i % 2 ? 'md:order-2' : ''}>
                <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-card bg-accent-tint text-ink">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h2 className="text-2xl font-semibold md:text-3xl">{title}</h2>
                <p className="mt-3 max-w-md text-muted">{body}</p>
              </div>
              <div className="flex min-h-[160px] items-center justify-center rounded-card border border-line bg-sunken p-6">
                <ul className="w-full max-w-xs space-y-2.5 text-sm">
                  {[1, 2, 3].map((n) => (
                    <li
                      key={n}
                      className="flex items-center gap-2.5 rounded-ctl bg-surface px-3 py-2.5 shadow-sm"
                    >
                      <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                      <span
                        className="h-2 flex-1 rounded-full bg-line"
                        style={{ maxWidth: `${90 - n * 18}%` }}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </section>
      </main>

      <footer className="border-t border-line px-6 py-8 text-center text-sm text-muted">
        {t('landing.footer')}
      </footer>
    </div>
  )
}
