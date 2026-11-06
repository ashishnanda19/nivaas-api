import { Suspense, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Landmark,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Search,
  Users,
} from 'lucide-react'
import clsx from 'clsx'
import { useSession } from './store'
import { Avatar, Sheet, Skeleton } from '@/components/ui'
import { useIsDesktop } from '@/lib/hooks'
import { useTranslation } from 'react-i18next'

const ALL = [
  { to: '/console/dashboard', label: 'Dashboard', icon: BarChart3, roles: ['committee'] },
  { to: '/console/complaints', label: 'Complaints', icon: MessageSquare, roles: ['helpdesk', 'committee'] },
  { to: '/console/payments', label: 'Payments', icon: Landmark, roles: ['helpdesk'] },
  { to: '/console/billing', label: 'Billing', icon: Receipt, roles: ['helpdesk', 'committee'] },
  { to: '/console/visitors', label: 'Visitors', icon: Users, roles: ['helpdesk'] },
  { to: '/console/bookings', label: 'Amenity bookings', icon: CalendarDays, roles: ['helpdesk'] },
  { to: '/console/audit', label: 'Audit log', icon: ClipboardList, roles: ['helpdesk', 'committee'] },
]

export function ConsoleLayout() {
  const { t } = useTranslation()
  const { user, logout } = useSession()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const desktop = useIsDesktop()
  const [collapsed, setCollapsed] = useState(false)
  const [menu, setMenu] = useState(false)
  const items = ALL.filter((i) => i.roles.includes(user!.role))

  const links = (compact: boolean, onNav?: () => void) => (
    <ul className="space-y-1">
      {items.map(({ to, label, icon: Icon }) => (
        <li key={to}>
          <NavLink
            to={to}
            onClick={onNav}
            title={compact ? t(`console.nav.${label}`, label) : undefined}
            className={({ isActive }) =>
              clsx(
                'flex min-h-[44px] items-center gap-3 rounded-ctl px-3 text-sm font-medium transition-colors',
                isActive ? 'bg-accent-tint text-ink' : 'text-muted hover:bg-sunken hover:text-fg',
                compact && 'justify-center px-0',
              )
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            {!compact && t(`console.nav.${label}`, label)}
          </NavLink>
        </li>
      ))}
    </ul>
  )

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim()
    if (q) nav(`/console/billing?q=${encodeURIComponent(q)}`)
  }

  return (
    <div className="flex min-h-dvh bg-bg">
      {desktop && (
        <aside
          className={clsx(
            'sticky top-0 flex h-dvh shrink-0 flex-col border-r border-line bg-surface p-3 transition-[width] duration-200',
            collapsed ? 'w-[68px]' : 'w-60',
          )}
        >
          <div
            className={clsx(
              'flex h-12 items-center px-2 text-lg font-semibold tracking-tight',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? (
              'N'
            ) : (
              <>
                Nivaas
                <span className="ml-2 rounded bg-accent-tint px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink">
                  Console
                </span>
              </>
            )}
          </div>
          <nav aria-label="Console" className="mt-4 flex-1">
            {links(collapsed)}
          </nav>
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex min-h-[44px] items-center justify-center rounded-ctl text-muted hover:bg-sunken"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            )}
          </button>
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur md:px-6">
          {!desktop && (
            <button
              onClick={() => setMenu(true)}
              aria-label="Open menu"
              className="-ml-2 flex h-11 w-11 items-center justify-center rounded-ctl hover:bg-sunken"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <form onSubmit={onSearch} role="search" className="relative max-w-md flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              name="q"
              aria-label="Search flat or resident"
              placeholder="Search flat or resident"
              className="min-h-[40px] w-full rounded-ctl border border-line bg-sunken pl-9 pr-3 text-sm placeholder:text-muted"
            />
          </form>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right text-xs leading-tight sm:block">
              <p className="font-medium">{user!.name}</p>
              <p className="text-muted">{user!.title}</p>
            </div>
            <Avatar name={user!.name} />
            <button
              onClick={() => {
                logout()
                nav('/login')
              }}
              aria-label={t('common.logout')}
              className="flex h-11 w-11 items-center justify-center rounded-ctl text-muted hover:bg-sunken"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>
        <Suspense
          fallback={
            <div className="space-y-3 p-6">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-64" />
            </div>
          }
        >
          <motion.main
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="flex-1 p-4 md:p-6"
          >
            <Outlet />
          </motion.main>
        </Suspense>
      </div>
      <Sheet open={menu && !desktop} onClose={() => setMenu(false)} title="Nivaas Console">
        {links(false, () => setMenu(false))}
      </Sheet>
    </div>
  )
}
