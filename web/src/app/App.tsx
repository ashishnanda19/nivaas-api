import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useSession, homeFor } from './store'
import type { Role } from '@/lib/api'
import { Toaster, Skeleton } from '@/components/ui'
import { DevMenu } from '@/components/DevMenu'
import { ResidentLayout } from './ResidentLayout'
import { ConsoleLayout } from './ConsoleLayout'
import { GuardLayout } from './GuardLayout'

const Landing = lazy(() => import('@/features/public/Landing'))
const Login = lazy(() => import('@/features/auth/Login'))
const Design = lazy(() => import('@/features/public/Design'))
const Home = lazy(() => import('@/features/resident/Home'))
const Pay = lazy(() => import('@/features/resident/Pay'))
const Complaints = lazy(() => import('@/features/resident/Complaints'))
const NewComplaint = lazy(() => import('@/features/resident/NewComplaint'))
const ComplaintDetail = lazy(() => import('@/features/resident/ComplaintDetail'))
const Gate = lazy(() => import('@/features/resident/Gate'))
const Amenities = lazy(() => import('@/features/resident/Amenities'))
const Family = lazy(() => import('@/features/resident/Family'))
const More = lazy(() => import('@/features/resident/More'))
const Notices = lazy(() => import('@/features/resident/Notices'))
const Board = lazy(() => import('@/features/helpdesk/Board'))
const Matching = lazy(() => import('@/features/helpdesk/Matching'))
const Billing = lazy(() => import('@/features/helpdesk/Billing'))
const VisitorsLog = lazy(() => import('@/features/helpdesk/VisitorsLog'))
const Bookings = lazy(() => import('@/features/helpdesk/Bookings'))
const AuditLog = lazy(() => import('@/features/helpdesk/AuditLog'))
const Reminders = lazy(() => import('@/features/helpdesk/Reminders'))
const Dashboard = lazy(() => import('@/features/committee/Dashboard'))
const GuardHome = lazy(() => import('@/features/guard/GuardHome'))
const NewVisitor = lazy(() => import('@/features/guard/NewVisitor'))
const CodeEntry = lazy(() => import('@/features/guard/CodeEntry'))

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const user = useSession((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user)} replace />
  return <>{children}</>
}

function useThemeClass() {
  const theme = useSession((s) => s.theme)
  const { pathname } = useLocation()
  const guard = pathname.startsWith('/guard')
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        guard || theme === 'dark' || (theme === 'system' && mq.matches),
      )
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, guard])
}

const Fallback = () => (
  <div className="mx-auto max-w-md space-y-3 p-6" aria-busy>
    <Skeleton className="h-8 w-40" />
    <Skeleton className="h-32" />
    <Skeleton className="h-32" />
  </div>
)

export function App() {
  useThemeClass()
  return (
    <>
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/design" element={<Design />} />

          <Route
            path="/app"
            element={
              <RequireRole roles={['resident']}>
                <ResidentLayout />
              </RequireRole>
            }
          >
            <Route index element={<Home />} />
            <Route path="pay" element={<Pay />} />
            <Route path="complaints" element={<Complaints />} />
            <Route path="complaints/new" element={<NewComplaint />} />
            <Route path="complaints/:id" element={<ComplaintDetail />} />
            <Route path="gate" element={<Gate />} />
            <Route path="amenities" element={<Amenities />} />
            <Route path="family" element={<Family />} />
            <Route path="notices" element={<Notices />} />
            <Route path="more" element={<More />} />
          </Route>

          <Route
            path="/console"
            element={
              <RequireRole roles={['helpdesk', 'committee']}>
                <ConsoleLayout />
              </RequireRole>
            }
          >
            <Route index element={<Navigate to="complaints" replace />} />
            <Route path="complaints" element={<Board />} />
            <Route
              path="payments"
              element={
                <RequireRole roles={['helpdesk']}>
                  <Matching />
                </RequireRole>
              }
            />
            <Route path="billing" element={<Billing />} />
            <Route
              path="visitors"
              element={
                <RequireRole roles={['helpdesk']}>
                  <VisitorsLog />
                </RequireRole>
              }
            />
            <Route
              path="bookings"
              element={
                <RequireRole roles={['helpdesk']}>
                  <Bookings />
                </RequireRole>
              }
            />
            <Route path="reminders" element={<Reminders />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="dashboard" element={<Dashboard />} />
          </Route>

          <Route
            path="/guard"
            element={
              <RequireRole roles={['guard']}>
                <GuardLayout />
              </RequireRole>
            }
          >
            <Route index element={<GuardHome />} />
            <Route path="visitor" element={<NewVisitor />} />
            <Route path="code" element={<CodeEntry />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
      {import.meta.env.DEV && <DevMenu />}
    </>
  )
}
