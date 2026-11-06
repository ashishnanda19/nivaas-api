import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { DoorOpen, Home, IndianRupee, MessageSquare, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { Skeleton } from '@/components/ui'

const TABS = [
  { to: '/app', key: 'home', icon: Home, end: true },
  { to: '/app/pay', key: 'pay', icon: IndianRupee },
  { to: '/app/complaints', key: 'complaints', icon: MessageSquare },
  { to: '/app/gate', key: 'gate', icon: DoorOpen },
  { to: '/app/more', key: 'more', icon: MoreHorizontal },
] as const

export function ResidentLayout() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  return (
    <div className="min-h-dvh bg-sunken">
      <div className="mx-auto min-h-dvh max-w-[480px] bg-bg pb-24 md:border-x md:border-line">
        <Suspense
          fallback={
            <div className="space-y-3 p-5">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-32" />
            </div>
          }
        >
          <motion.main
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="px-5 pt-6"
          >
            <Outlet />
          </motion.main>
        </Suspense>
      </div>
      <nav
        aria-label="Main"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur"
      >
        <ul className="mx-auto flex max-w-[480px]">
          {TABS.map(({ to, key, icon: Icon, ...rest }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={'end' in rest}
                className={({ isActive }) =>
                  clsx(
                    'flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors',
                    isActive ? 'text-ink' : 'text-muted',
                  )
                }
              >
                <Icon className="h-5 w-5" aria-hidden />
                {t(`nav.${key}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
